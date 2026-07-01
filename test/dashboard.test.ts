import { describe, expect, it } from "vitest";

import { DASHBOARD_HTML } from "../src/dashboard.js";

describe("dashboard HTML", () => {
  it("renders audit count hooks without tabs", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('data-filter="enrich"');
    expect(html).toContain('data-filter="skip"');
    expect(html).toContain('data-count-for="repo"');
    expect(html).toContain("batch-health");
    expect(html).not.toContain('class="tabs"');
  });
});
