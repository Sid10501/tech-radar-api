# Tech Radar Dashboard Finder Layout Design

**Date:** 2026-08-03
**Status:** Approved direction, awaiting implementation plan

## Problem

The desktop dashboard gives too much permanent space to sidebar metrics and filter chips. On a 2048px-wide screen, the finding list begins far below the fold because the sidebar reserves vertical space for quality counts, public/private copy, latest batch health, enrichment reason counts, and filter chips. This makes the main workflow, scanning findings and opening one quickly, feel cramped even though the page has plenty of horizontal room.

The user does not need all audit numbers visible all the time. They are useful operationally, but should become contextual tools rather than the dominant sidebar content.

## Goals

- Make the left column primarily a scrollable findings navigator.
- Move filters into a compact finder-style toolbar that is easy to scan and does not consume list height.
- Hide detailed audit/health metrics by default behind an explicit `Audit` disclosure.
- Keep triage labels and evidence chips visible on finding cards.
- Preserve the current mobile drill-in model and improve it only where the desktop redesign naturally shares controls.
- Avoid a broad visual rebrand, framework change, or new dependencies.

## Non-Goals

- No new data model or API behavior.
- No redesign of the portfolio site.
- No change to enrichment, triage, or audit calculations.
- No complex persistent user preferences in this pass.

## Recommended Layout

Use a finder-style desktop layout:

- Top bar remains the global app bar with brand, search, release notes, refresh, unlock, and add URL.
- The workspace remains two columns, but the left queue column is optimized for navigation.
- The left queue column contains only:
  - a compact header with `Findings`, visible count, and the active filter label
  - a small quality summary row or single compact status line
  - the scrollable finding list
- The detailed filters move to a horizontal toolbar above the detail pane, visually attached to the main content area.
- The toolbar includes the primary action filters first: `All`, `Strong`, `Review`, `Weak`, `Needs enrichment`, `Repo/docs`, and `OCR`.
- Private-only filters (`Project fit`, `Skip`) appear in the toolbar only after unlock.
- Detailed latest-batch health and reason counts move into an `Audit` button/disclosure near the toolbar. The disclosure opens an unintrusive panel with the same numbers currently shown in the sidebar.

## Sidebar Behavior

The left sidebar should feel like a mailbox or finder source list:

- It should start showing findings within roughly the first 160px of vertical space on desktop.
- It should not render the full latest-batch health grid by default.
- It should not render the public/private explanatory paragraph as a full row on desktop. Replace it with compact copy such as `Public view` or `Sid view`.
- It should keep selected-row highlighting and evidence/triage chips.
- The list must remain independently scrollable.

## Toolbar Behavior

The toolbar is the main filter surface:

- It sits at the top of the detail content area.
- It wraps gracefully on narrower desktop widths without pushing the detail hero far down.
- It shows the selected filter state clearly.
- Count badges stay visible for quick orientation, but the toolbar should use compact chip sizing.
- `Audit` is a button or disclosure summary, not a permanent metrics grid.
- Opening `Audit` shows latest batch health and enrichment reason counts in a compact panel. Closing it restores vertical focus to the detail.

## Detail Behavior

The detail pane should start higher and feel less boxed in:

- Keep the current selected finding hero and body panels.
- Reduce top padding now that the toolbar occupies the first row.
- The detail hero should remain readable and not be squeezed by the filter controls.
- The source/triage side cards remain available on desktop.

## Mobile Behavior

Mobile should keep the current list/detail drill-in model:

- The existing mobile top bar and back behavior stay intact.
- The current compact mobile `More` filters can remain, but labels should align with the new finder toolbar vocabulary.
- The expandable mobile batch health pattern remains the default for audit details.
- The redesign must not reintroduce horizontal overflow.

## Accessibility

- The toolbar must retain `aria-label="Filter findings"` or equivalent.
- The `Audit` disclosure must expose `aria-expanded`/`aria-controls` or use native `details`.
- Disabled zero-count filters should remain disabled.
- Keyboard focus order should move from search to global actions to filters to list to detail.

## Testing

Add focused tests in `test/dashboard.test.ts`:

- The desktop sidebar no longer contains the full batch health grid as permanent navigation chrome.
- The dashboard renders a main-content filter toolbar with the expected filters.
- The dashboard renders an `Audit` disclosure/control for latest batch metrics.
- The finding list remains a dedicated scrollable region.
- Mobile still renders the existing compact `More` filters and mobile batch health disclosure.

Run:

- `npm test -- test/dashboard.test.ts --no-file-parallelism --testTimeout=30000`
- `npm test`
- `npm run build`
- Browser smoke at desktop and mobile widths checking no horizontal overflow, visible finding list, working filters, and no console errors.

## Rollout

Ship as one focused PR. Do not deploy until tests and browser smoke are clean. After merge, deploy through Railway and smoke the production dashboard.
