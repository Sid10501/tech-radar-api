import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/server.js';

const dirs: string[]=[];
const apps: ReturnType<typeof buildServer>[]=[];
function setup() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-topic-test-'));dirs.push(dir);
  const batch={schemaVersion:1,batchId:'fresh-25',labelSource:'model-reviewed',posts:[{id:'post-1',inputHash:'a'.repeat(64),sourceUrl:'https://www.instagram.com/p/abc/',text:'A Python library for charts.',suggestedCategory:'technology',evidence:'caption'}]};
  const file=path.join(dir,'batch.json');fs.writeFileSync(file,JSON.stringify(batch));
  vi.stubEnv('TOPIC_SUGGESTIONS_FILE',file);vi.stubEnv('RUN_STATE_DIR',dir);vi.stubEnv('AUTH_TOKEN','test-owner');vi.stubEnv('NODE_ENV','test');
  const app=buildServer();apps.push(app);return {app,dir,file,batch};
}
const headers={authorization:'Bearer test-owner'};
const feedback={batchId:'fresh-25',inputHash:'a'.repeat(64),category:'technology'};
afterEach(async()=>{await Promise.all(apps.splice(0).map(a=>a.close()));vi.unstubAllEnvs();vi.restoreAllMocks();for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
describe('topic suggestion trial',()=>{
  it('is absent unless enabled',async()=>{vi.stubEnv('TOPIC_SUGGESTIONS_FILE','');const app=buildServer();apps.push(app);expect((await app.inject('/api/topic-suggestions')).statusCode).toBe(404);});
  it('protects the batch and feedback using owner auth',async()=>{const {app}=setup();expect((await app.inject('/api/topic-suggestions')).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',payload:feedback})).statusCode).toBe(401);});
  it('saves confirmed and corrected topics across restart without changing run history',async()=>{
    const {app}=setup();const before=(await app.inject({url:'/runs',headers})).json();
    const get=await app.inject({url:'/api/topic-suggestions',headers});expect(get.statusCode).toBe(200);expect(get.headers['cache-control']).toBe('no-store, max-age=0');expect(get.json().posts[0].feedback).toBeNull();
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:feedback})).statusCode).toBe(200);
    const next=buildServer();apps.push(next);expect((await next.inject({url:'/api/topic-suggestions',headers})).json().posts[0].feedback.category).toBe('technology');
    expect((await next.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:{...feedback,category:'other'}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/topic-suggestions',headers})).json().posts[0].feedback.category).toBe('other');
    expect((await app.inject({url:'/runs',headers})).json()).toEqual(before);
  });
  it('rejects wrong batch, changed input, unknown post and invalid category',async()=>{
    const {app}=setup();for(const change of [{batchId:'old'},{inputHash:'b'.repeat(64)}])expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:{...feedback,...change}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/nope/feedback',headers,payload:feedback})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:{...feedback,category:'publish'}})).statusCode).toBe(400);
  });
  it('rejects cross-origin feedback without mutating state',async()=>{const {app}=setup();expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers:{...headers,origin:'https://other.example'},payload:feedback})).statusCode).toBe(403);});
  it('accepts the same HTTPS origin behind a TLS proxy and keeps simultaneous updates',async()=>{
    const {app,file,batch}=setup();batch.posts.push({...batch.posts[0],id:'post-2',inputHash:'b'.repeat(64)});fs.writeFileSync(file,JSON.stringify(batch));
    const next=buildServer();apps.push(next);
    const responses=await Promise.all(['post-1','post-2'].map((id,i)=>next.inject({method:'POST',url:'/api/topic-suggestions/'+id+'/feedback',headers:{...headers,host:'radar.example',origin:'https://radar.example'},payload:{...feedback,inputHash:(i?'b':'a').repeat(64)}})));
    expect(responses.map(r=>r.statusCode)).toEqual([200,200]);
    expect((await next.inject({url:'/api/topic-suggestions',headers})).json().posts.map((p:any)=>p.feedback.category)).toEqual(['technology','technology']);
  });
  it('does not report success when feedback cannot be written',async()=>{
    const {app,dir}=setup();fs.mkdirSync(path.join(dir,'topic-suggestion-feedback.jsonl'));
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:feedback})).statusCode).toBe(503);
  });
  it('finishes a short write and rolls back a failed append without losing earlier feedback',async()=>{
    const {app}=setup();
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:feedback})).statusCode).toBe(200);
    const original=fs.writeSync.bind(fs);
    const short=vi.spyOn(fs,'writeSync').mockImplementation(((fd:number,data:any,...args:any[])=>{
      const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
      const offset=typeof args[0]==='number'?args[0]:0;
      return original(fd,bytes,offset,Math.min(20,bytes.length-offset));
    }) as typeof fs.writeSync);
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:{...feedback,category:'other'}})).statusCode).toBe(200);
    const saved=await app.inject({url:'/api/topic-suggestions',headers});expect(saved.statusCode).toBe(200);expect(saved.json().posts[0].feedback.category).toBe('other');
    short.mockRestore();let calls=0;
    const failed=vi.spyOn(fs,'writeSync').mockImplementation(((fd:number,data:any,...args:any[])=>{
      if(calls++)throw new Error('disk full');
      const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);return original(fd,bytes,0,20);
    }) as typeof fs.writeSync);
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:feedback})).statusCode).toBe(503);
    failed.mockRestore();
    expect((await app.inject({url:'/api/topic-suggestions',headers})).json().posts[0].feedback.category).toBe('other');
  });
  it('local trial mode blocks processing routes even with owner credentials',async()=>{
    setup();const {buildTopicTrialServer}=await import('../src/topicTrialLocal.js');const app=buildTopicTrialServer();apps.push(app);
    expect((await app.inject({method:'POST',url:'/runs',headers,payload:{url:'https://example.com/post'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/admin/enrich-weak',headers,payload:{limit:1}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/topic-suggestions/post-1/feedback',headers,payload:feedback})).statusCode).toBe(200);
  });
  it('fails closed on unsafe URLs and duplicate post IDs',()=>{
    const {file,batch}=setup();batch.posts[0].sourceUrl='javascript:alert(1)';fs.writeFileSync(file,JSON.stringify(batch));expect(()=>buildServer()).toThrow();
    batch.posts[0].sourceUrl='https://example.com';batch.posts.push({...batch.posts[0]});fs.writeFileSync(file,JSON.stringify(batch));expect(()=>buildServer()).toThrow();
  });
});
