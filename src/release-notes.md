# Release Notes

## 2026-07-06 - Public Feed: RSS, Applied Mapping, Scoped CORS

Made the public findings feed consumable by external sites like the portfolio radar section.

- Added an RSS 2.0 feed at `/api/public/findings/rss` with the 20 newest public findings.
- Added an `applied` field to public findings so adopted research links back to real work via `tech-radar/applied.json`.
- Scoped CORS to `/api/public/*` with an exact-origin allowlist and no wildcard.
- Locked in a leak regression test keeping private sections out of every public response.

## 2026-07-06 - Audit Completion Ops Polish

Closed the audit-completion polish pass with user-visible diagnostics, clearer triage signals, and an operator-ready verification path.

- Fixed mobile release notes navigation so notes open in the visible mobile detail pane and return cleanly to the findings list.
- Added duplicate diagnostics and retry history surfacing so repeated source retries do not create duplicate active findings without explanation.
- Improved triage explainability with quality reason chips, extraction warnings, and enrichment reason counts in the dashboard.
- Completed security and ops hardening around public/private data boundaries, browser-compatible response headers, conservative cache policy, and repeatable smoke checks.

## 2026-07-05 - Ever-Improving Product Loop

Turned the radar into a more visible improvement loop with explicit release notes, verification gates, and deterministic quality fixes.

- Added a public release notes endpoint.
- Added release notes visibility in the dashboard.
- Documented the Superpowers, TDD, review, Ponytail, and verification workflow in the project plan.
- Stabilized the current YouTube and Google Drive intake branch before adding product changes.

## 2026-07-03 - Design and Video Elevation Audit

Captured the latest design, video, website, and agent-tool radar work in ai-memory so future sessions can continue from a concrete backlog.

- Ranked video generation, Remotion, animation, and website design tools for follow-up.
- Recorded failing-link patterns and retry targets for extraction improvement.
- Preserved the audit in ai-memory handoff documentation.

## 2026-06-30 - YouTube Learning Intake

Expanded intake beyond short social clips so long-form technical videos produce useful radar evidence.

- Added YouTube metadata, transcript, subtitle, chapter, source-link, and comment evidence paths.
- Added richer composed markdown sections for learning-oriented findings.
- Added tests for extraction-to-LLM context and composed finding output.
