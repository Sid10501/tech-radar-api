import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAgentOutput } from "../../src/lib/validateAgentOutput.js";

const DemoSchema = z.object({ title: z.string().max(200) });

describe("parseAgentOutput", () => {
  it("parses valid JSON", () => {
    const r = parseAgentOutput('{"title":"ok"}', DemoSchema, "demo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.title).toBe("ok");
  });

  it("rejects invalid shape", () => {
    const r = parseAgentOutput('{"title":999}', DemoSchema, "demo");
    expect(r.ok).toBe(false);
  });

  it("rejects non-JSON", () => {
    const r = parseAgentOutput("not json", DemoSchema, "demo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not valid JSON");
  });
});
