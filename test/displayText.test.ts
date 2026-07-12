import { describe, expect, it } from "vitest";
import { decodeEntities, deriveDisplaySummary, deriveDisplayTitle, parseDisplayHeader } from "../src/displayText.js";
import { parseFindingMarkdown } from "../src/findings.js";

describe("parseDisplayHeader()", () => {
  it("parses a Display header line with an em dash separator", () => {
    const markdown = [
      "# Raw scraped title",
      "",
      "**Source:** instagram · [unknown](https://example.com/p/1)",
      "**Saved:** 2026-07-06",
      "**Tags:** instagram",
      "**Display:** Claude Code plugin arsenal — Five open-source Claude Code plugins covering tokens, memory, design, writing, and marketing.",
      "",
      "## TL;DR",
      "",
      "Body.",
    ].join("\n");

    expect(parseDisplayHeader(markdown)).toEqual({
      title: "Claude Code plugin arsenal",
      summary: "Five open-source Claude Code plugins covering tokens, memory, design, writing, and marketing.",
    });
  });

  it("tolerates a hyphen separator and decodes entities", () => {
    const markdown = "# T\n\n**Display:** Jun Yuh&#x2019;s launch framework - A three-phase &quot;build in public&quot; launch cycle.\n";

    expect(parseDisplayHeader(markdown)).toEqual({
      title: "Jun Yuh’s launch framework",
      summary: "A three-phase \"build in public\" launch cycle.",
    });
  });

  it("returns an empty summary when the header has no separator", () => {
    expect(parseDisplayHeader("# T\n\n**Display:** OpenSuperWhisper\n")).toEqual({
      title: "OpenSuperWhisper",
      summary: "",
    });
  });

  it("returns null when there is no Display header", () => {
    expect(parseDisplayHeader("# T\n\n**Source:** instagram\n\n## TL;DR\n\nBody.")).toBeNull();
  });
});

describe("deriveDisplayTitle()", () => {
  it("extracts the caption's first sentence from an Instagram account-with-niche title", () => {
    const raw =
      "Sebastian Hardy | AI Marketing on Instagram: &quot;The 5 Claude Code plugins I&#x2019;m actually running this month.";

    expect(deriveDisplayTitle(raw)).toBe("The 5 Claude Code plugins I’m actually running this month");
  });

  it("extracts the caption from a plain Instagram title and strips the closing quote", () => {
    const raw = "Builders Central on Instagram: &quot;A Goldmine For Startup Founders&quot;";

    expect(deriveDisplayTitle(raw)).toBe("A Goldmine For Startup Founders");
  });

  it("stops the Instagram caption at the first sentence terminator", () => {
    const raw =
      "Wassim | AI Expert on Instagram: &quot;Comment &#x201c;agent&#x201d; I&#x2019;ll send it over! &#x1f680; the prompt master legit gives u better outcome on tasks because of prompts&quot;";

    expect(deriveDisplayTitle(raw)).toBe("Comment “agent” I’ll send it over");
  });

  it("caps long Instagram captions at a word boundary with an ellipsis", () => {
    const raw =
      "Harry on Instagram: &quot;Someone built Udeler a cross-platform downloader for course videos that runs on Windows macOS and Linux without limits&quot;";

    const title = deriveDisplayTitle(raw);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(71);
    expect(title.startsWith("Someone built Udeler")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it("turns GitHub titles into repo — first description clause", () => {
    const raw =
      "GitHub - richkuo/go-trader: Crypto trading bot — backtesting, paper trading, live trading with risk management";

    expect(deriveDisplayTitle(raw)).toBe("go-trader — Crypto trading bot");
  });

  it("stops the GitHub description at the first sentence", () => {
    const raw =
      "GitHub - DietrichGebert/ponytail: Makes your AI agent think like the laziest senior dev in the room. The best code is the code you never wrote.";

    expect(deriveDisplayTitle(raw)).toBe("ponytail — Makes your AI agent think like the laziest senior dev in the room");
  });

  it("keeps short GitHub descriptions intact", () => {
    expect(deriveDisplayTitle("GitHub - Starmel/OpenSuperWhisper: macOS dictation app")).toBe(
      "OpenSuperWhisper — macOS dictation app",
    );
  });

  it("returns just the repo name for a bare GitHub title", () => {
    expect(deriveDisplayTitle("GitHub - richkuo/go-trader")).toBe("go-trader");
  });

  it("keeps Video by / Post by titles unchanged", () => {
    expect(deriveDisplayTitle("Video by jun_yuh")).toBe("Video by jun_yuh");
    expect(deriveDisplayTitle("Post by datasciencebrain")).toBe("Post by datasciencebrain");
  });

  it("falls back to the decoded raw title capped at a word boundary", () => {
    expect(deriveDisplayTitle("How I Use Claude Code + My Best Tips")).toBe("How I Use Claude Code + My Best Tips");

    const long =
      "Get access to 1500 APIs to use in your app and projects for free with this one open-source directory that developers keep recommending";
    const capped = deriveDisplayTitle(long);
    expect(capped.endsWith("…")).toBe(true);
    expect(capped.length).toBeLessThanOrEqual(91);
    expect(capped.startsWith("Get access to 1500 APIs")).toBe(true);
  });
});

describe("deriveDisplaySummary()", () => {
  it("keeps a short first sentence of the TL;DR as-is", () => {
    const tldr =
      "A curated set of five open-source plugins for Anthropic's Claude Code AI assistant, covering token optimization, persistent memory, design, writing, and marketing workflows. The two named tools are 'caveman' and 'claude-mem'.";

    expect(deriveDisplaySummary(tldr)).toBe(
      "A curated set of five open-source plugins for Anthropic's Claude Code AI assistant, covering token optimization, persistent memory, design, writing, and marketing workflows.",
    );
  });

  it("caps an over-long first sentence at a word boundary with an ellipsis", () => {
    const tldr =
      "A three-phase product launch framework ('Build in Public → Launch Week → Post-Launch Sequence') taught by content creator Jun Yuh, designed to turn a product launch into a self-compounding sales cycle rather than a single announcement event. It is a content strategy methodology.";

    const summary = deriveDisplaySummary(tldr);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.startsWith("A three-phase product launch framework")).toBe(true);
  });

  it("decodes entities before extracting the sentence", () => {
    expect(deriveDisplaySummary("Anthropic&#x2019;s &quot;skills&quot; system explained. More detail.")).toBe(
      "Anthropic’s \"skills\" system explained.",
    );
  });
});

describe("display fields on parsed findings", () => {
  const RAW_FINDING = [
    "# Sebastian Hardy | AI Marketing on Instagram: &quot;The 5 Claude Code plugins I&#x2019;m actually running this month.",
    "",
    "**Source:** instagram · [unknown](https://www.instagram.com/p/DZSYkKwDAFn/)",
    "**Saved:** 2026-07-06",
    "**Tags:** instagram, claudeai",
    "",
    "## TL;DR",
    "",
    "A curated set of five open-source plugins for Anthropic's Claude Code AI assistant, covering token optimization, persistent memory, design, writing, and marketing workflows. The named tools are 'caveman' and 'claude-mem'.",
  ].join("\n");

  it("derives displayTitle and displaySummary when no Display header exists", () => {
    const finding = parseFindingMarkdown("2026-07-06-sebastian-hardy.md", RAW_FINDING);

    expect(finding.displayTitle).toBe("The 5 Claude Code plugins I’m actually running this month");
    expect(finding.displaySummary).toBe(
      "A curated set of five open-source plugins for Anthropic's Claude Code AI assistant, covering token optimization, persistent memory, design, writing, and marketing workflows.",
    );
    expect(finding.title).toContain("on Instagram:");
  });

  it("prefers the Display header over derivation", () => {
    const withHeader = RAW_FINDING.replace(
      "**Tags:** instagram, claudeai",
      "**Tags:** instagram, claudeai\n**Display:** Claude Code plugin arsenal — Five open-source Claude Code plugins for tokens, memory, design, writing, and marketing.",
    );

    const finding = parseFindingMarkdown("2026-07-06-sebastian-hardy.md", withHeader);

    expect(finding.displayTitle).toBe("Claude Code plugin arsenal");
    expect(finding.displaySummary).toBe(
      "Five open-source Claude Code plugins for tokens, memory, design, writing, and marketing.",
    );
  });

  it("never leaves display fields empty", () => {
    const finding = parseFindingMarkdown("2026-07-06-empty.md", "# Video by jun_yuh\n\n**Saved:** 2026-07-06\n");

    expect(finding.displayTitle).toBe("Video by jun_yuh");
    expect(finding.displaySummary).toBe(finding.summary);
    expect(finding.displaySummary.length).toBeGreaterThan(0);
  });
});

it("never throws on malformed or out-of-range entities", () => {
  expect(decodeEntities("&#abc; stays literal")).toBe("&#abc; stays literal");
  expect(decodeEntities("&#xffffff; stays literal")).toBe("&#xffffff; stays literal");
  expect(decodeEntities("&#8217;")).toBe("’");
});
