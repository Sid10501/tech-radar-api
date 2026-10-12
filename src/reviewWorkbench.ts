// Runs inside the radar dashboard's inline script, alongside its existing state and helpers.
export const SID_REVIEW_SCRIPT = String.raw`
const reviewState = { byId: new Map(), drafts: new Map(), requestSeq: 0 };
function reviewDraft(id) {
  let draft = reviewState.drafts.get(id);
  if (!draft) {
    const review = reviewState.byId.get(id)?.review;
    draft = { decision: review?.decision || '', rationale: review?.rationale || '', projectSlug: review?.projectSlug || '',
      question: '', successCriteria: '', reviewGeneration: 0, experimentGeneration: 0,
      reviewDirty: false, experimentDirty: false, savingReview: false, creatingExperiment: false, message: '' };
    reviewState.drafts.set(id, draft);
  }
  return draft;
}
function reviewPanel(f) {
  if (!state.privateUnlocked) return '';
  const record = reviewState.byId.get(f.id);
  if (!record) return '<div class="panel" id="sid-review-panel"><div class="panel-head">Owner review</div><div class="panel-body"><p>Loading saved review…</p></div></div>';
  const review = record.review || null;
  const brief = record.brief || null;
  const draft = reviewDraft(f.id);
  const options = ['Try', 'Bookmark', 'Dismiss'].map(value => '<option value="' + value + '"' + (draft.decision === value ? ' selected' : '') + '>' + value + '</option>').join('');
  const linked = brief ? '<div class="hint">Experiment: ' + escapeHtml(brief.experiment.status) + (brief.experiment.result ? ' · ' + escapeHtml(brief.experiment.result) : '') + ' · <a href="/lab?brief=' + encodeURIComponent(brief.id) + '">Open in Community Lab</a> · <button type="button" class="inline-action" data-review-refresh>Refresh status</button></div>' : '';
  const experiment = draft.decision === 'Try' && (!brief || draft.experimentDirty) ?
    '<fieldset><legend>Private experiment</legend><p class="hint">' + (brief ? 'Newer text is not in the saved experiment. Open Community Lab to update it.' : 'Enter a real question and success criteria. Creating a draft does not run an experiment or publish it.') + '</p>' +
    '<label>Question<textarea data-review-question required>' + escapeHtml(draft.question) + '</textarea></label><label>Success criteria<textarea data-review-success required>' + escapeHtml(draft.successCriteria) + '</textarea></label>' +
    (brief ? '' : '<button type="button" data-review-create' + (draft.creatingExperiment ? ' disabled' : '') + '>Create private experiment</button>') + '</fieldset>' : '';
  const status = draft.message || (draft.reviewDirty || draft.experimentDirty ? 'Unsaved changes' : review ? 'Saved ' + review.decision + ' · ' + new Date(review.updatedAt).toLocaleString() : 'No saved decision.');
  return '<div class="panel" id="sid-review-panel"><div class="panel-head">Owner review</div><div class="panel-body">' +
    '<label>Decision<select data-review-decision><option value="">Choose a decision</option>' + options + '</select></label>' +
    '<label>Rationale<textarea data-review-rationale maxlength="8000">' + escapeHtml(draft.rationale) + '</textarea></label>' +
    '<label>Project slug (optional)<input data-review-project maxlength="100" pattern="[a-z0-9][a-z0-9-]{0,99}" value="' + escapeHtml(draft.projectSlug) + '"></label>' +
    '<button type="button" data-review-save' + (record.unavailable || draft.savingReview ? ' disabled' : '') + '>Save review</button><p data-review-status class="hint" role="status">' + escapeHtml(status) + '</p>' + linked + experiment + '</div></div>';
}
function bindReviewPanel(f) {
  const panel = document.getElementById('sid-review-panel');
  if (!panel || !reviewState.byId.has(f.id)) return;
  const pick = selector => panel.querySelector(selector);
  const decision = pick('[data-review-decision]');
  const rationale = pick('[data-review-rationale]');
  const project = pick('[data-review-project]');
  const status = pick('[data-review-status]');
  const draft = reviewDraft(f.id);
  for (const field of [decision, rationale, project]) field.addEventListener('input', () => {
    draft.decision = decision.value; draft.rationale = rationale.value; draft.projectSlug = project.value;
    draft.reviewGeneration++; draft.reviewDirty = true; draft.message = '';
    status.textContent = 'Unsaved changes';
  });
  for (const [selector, key] of [['[data-review-question]', 'question'], ['[data-review-success]', 'successCriteria']]) {
    const field = pick(selector);
    if (field) field.addEventListener('input', () => {
      draft[key] = field.value; draft.experimentGeneration++; draft.experimentDirty = true; draft.message = '';
      status.textContent = 'Unsaved changes';
    });
  }
  pick('[data-review-save]').addEventListener('click', async () => {
    if (draft.savingReview) return;
    const selectedId = f.id;
    const previous = reviewState.byId.get(selectedId)?.review;
    const button = pick('[data-review-save]'); button.disabled = true; draft.savingReview = true;
    draft.decision = decision.value; draft.rationale = rationale.value; draft.projectSlug = project.value;
    const sentGeneration = draft.reviewGeneration;
    try {
      const response = await fetch('/api/lab/reviews/' + encodeURIComponent(selectedId), { method: 'PUT', credentials: 'same-origin', headers: { ...requestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: draft.decision, rationale: draft.rationale, projectSlug: draft.projectSlug.trim() || null, expectedUpdatedAt: previous?.updatedAt || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'Review changed elsewhere. Reload the finding before saving.' : data.error || 'Save failed');
      reviewState.byId.set(selectedId, { ...reviewState.byId.get(selectedId), review: data.review });
      if (draft.reviewGeneration === sentGeneration) {
        draft.decision = data.review.decision; draft.rationale = data.review.rationale; draft.projectSlug = data.review.projectSlug || '';
        draft.reviewDirty = false;
      }
      draft.message = '';
    } catch (error) {
      draft.message = error.message + ' Your edits remain here.';
      if (state.selectedId === selectedId) status.textContent = draft.message;
    } finally { draft.savingReview = false; button.disabled = false; if (state.selectedId === selectedId) renderDetail(); }
  });
  const refresh = pick('[data-review-refresh]');
  if (refresh) refresh.addEventListener('click', () => loadReview(f.id));
  const create = pick('[data-review-create]');
  if (create) create.addEventListener('click', async () => {
    if (draft.creatingExperiment) return;
    const selectedId = f.id;
    const question = pick('[data-review-question]').value.trim();
    const successCriteria = pick('[data-review-success]').value.trim();
    if (!question || !successCriteria) { status.textContent = 'Question and success criteria are required.'; return; }
    draft.question = question; draft.successCriteria = successCriteria;
    const sentGeneration = draft.experimentGeneration;
    create.disabled = true; draft.creatingExperiment = true;
    try {
      const response = await fetch('/api/lab/reviews/' + encodeURIComponent(selectedId) + '/experiment', { method: 'POST', credentials: 'same-origin', headers: { ...requestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ question, successCriteria }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Experiment save failed');
      reviewState.byId.set(selectedId, { ...reviewState.byId.get(selectedId), brief: data.brief });
      if (draft.experimentGeneration === sentGeneration) draft.experimentDirty = false;
      draft.message = '';
      if (state.selectedId === selectedId) await loadReview(selectedId);
    } catch (error) {
      draft.message = error.message;
      if (state.selectedId === selectedId) status.textContent = draft.message;
    } finally { draft.creatingExperiment = false; create.disabled = false; if (state.selectedId === selectedId) renderDetail(); }
  });
}
async function loadReview(id) {
  if (!state.privateUnlocked) return;
  const requestId = ++reviewState.requestSeq;
  if (state.selectedId === id && !reviewState.byId.has(id)) renderDetail();
  try {
    const response = await fetch('/api/lab/reviews/' + encodeURIComponent(id), { credentials: 'same-origin', headers: requestHeaders() });
    const data = await response.json();
    if (requestId !== reviewState.requestSeq || state.selectedId !== id) return;
    if (!response.ok) throw new Error(data.error || 'Could not load review');
    const current = reviewState.byId.get(id);
    if (current?.review && data.review && current.review.updatedAt > data.review.updatedAt) data.review = current.review;
    reviewState.byId.set(id, data);
    const draft = reviewDraft(id);
    if (!draft.reviewDirty && data.review) {
      draft.decision = data.review.decision; draft.rationale = data.review.rationale; draft.projectSlug = data.review.projectSlug || '';
    }
    draft.message = '';
    renderDetail();
  } catch (error) {
    if (requestId !== reviewState.requestSeq || state.selectedId !== id) return;
    const current = reviewState.byId.get(id);
    reviewState.byId.set(id, current ? { ...current, unavailable: true } : { review: null, brief: null, unavailable: true });
    const draft = reviewDraft(id);
    draft.message = error.message + '. Reload before editing.';
    renderDetail();
  }
}
`;
