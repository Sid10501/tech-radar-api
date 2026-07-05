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

  it("keeps the desktop split explorer hooks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('class="workspace"');
    expect(html).toContain('class="queue"');
    expect(html).toContain('id="detail" class="content"');
    expect(html).toContain("grid-template-columns: minmax(300px, 390px) minmax(0, 1fr)");
  });

  it("defines mobile drill-in hooks without changing frameworks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain('id="mobile-back"');
    expect(html).toContain("mobile-detail-open");
    expect(html).toContain("isMobileViewport");
    expect(html).toContain("setMobileDetailOpen");
    expect(html).toContain("data-mobile-primary");
    expect(html).not.toContain("react");
    expect(html).not.toContain("next/");
  });

  it("renders mobile triage affordance hooks", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("evidence-chip");
    expect(html).toContain("mobile-detail-bar");
    expect(html).toContain("mobile-back");
  });

  it("uses a one-screen mobile queue and detail layout", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("height: 100dvh");
    expect(html).toContain("grid-template-rows: auto auto auto auto minmax(0, 1fr)");
    expect(html).toContain("position: sticky");
    expect(html).toContain("top: 0");
  });

  it("does not link public users to raw unsanitized markdown", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).not.toContain("Open markdown");
    expect(html).not.toContain("github.com/Sid10501/ai-memory/blob/master");
  });

  it("renders enrichment reason count hooks from audit data", () => {
    const html = DASHBOARD_HTML([]);

    expect(html).toContain("enrichmentReasons");
    expect(html).toContain("Missing links");
    expect(html).toContain("Source uncertainty");
  });
});
