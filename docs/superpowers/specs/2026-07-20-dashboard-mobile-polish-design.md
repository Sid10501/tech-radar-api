# Dashboard mobile polish design

**Date:** 2026-07-20
**Status:** Approved for implementation
**Scope:** Tech Radar dashboard operator ergonomics only

## Context

The production dashboard is functionally complete on mobile, but its list controls consume too much of the viewport. At 390 × 844, the first finding begins about 424 pixels from the top. The latest-batch block is 143 pixels tall, and the filter rail is 638 pixels wide publicly and 801 pixels wide in Sid view inside a 390-pixel viewport. Both rails hide their scrollbars and provide no clear overflow cue.

The mobile detail and release-notes views fit without horizontal overflow. Their in-page back buttons work, but opening either view does not create an application history entry. Browser Back therefore leaves the dashboard rather than returning to the findings list.

## Goals

- Put substantially more of the findings list above the fold on mobile.
- Keep the four common quality filters immediately available.
- Preserve every existing secondary filter and its count.
- Make finding and release-note drill-in obey browser Back while preserving list state and scroll position.
- Remove semantically duplicated reason chips without changing quality, triage, enrichment, or recommendation decisions.
- Preserve the current desktop split explorer and all API contracts.

## Non-goals

- No broad dashboard redesign, framework migration, API change, or triage-logic change.
- No changes to finding files, audit calculations, authentication, or private-field boundaries.
- No new deep-linking contract for finding details.
- No production icon, caching, or unrelated polish; those belong to the next PR.

## Approaches considered

### 1. Progressive disclosure — selected

Keep `All`, `Strong`, `Review`, and `Weak` visible, place the remaining filters behind `More`, and reduce batch health to one expandable summary. This keeps the frequent triage path one tap away while reclaiming the most vertical space.

### 2. Retain horizontal rails with overflow affordances

Add gradients, scrollbars, or arrows to the existing rails. This is the smallest visual change, but it leaves important controls off-screen and does not materially reduce the top-of-list footprint.

### 3. Put every filter in one menu

This is the most compact option, but it slows the primary Strong/Review/Weak workflow and hides useful state. It is too aggressive for an operational dashboard.

## Selected interaction design

### Compact list controls

At viewport widths up to 980 pixels:

- Render `All`, `Strong`, `Review`, and `Weak` as a fixed primary row.
- Hide their inline counts on mobile because the queue header already shows total and quality counts.
- Add a compact `More` button beside the primary controls.
- `More` toggles a secondary filter tray containing `Repo/docs`, `Needs enrichment`, `OCR`, and—only in Sid view—`Project fit` and `Skip`, each with its existing count.
- Selecting a secondary filter applies the existing filter logic and closes the tray. `More` remains visually active and exposes an accessible label naming the selected secondary filter.
- Reopening the tray shows the selected filter. Selecting a primary filter clears the secondary active state.
- The tray uses a wrapping grid rather than horizontal scrolling and is absent from layout while closed.
- The public/Sid mode note becomes one concise single-line mobile status. Desktop wording remains unchanged.

Desktop retains the current wrapped filter layout with every permitted filter visible.

### Expandable batch health

Replace the mobile chip rail with a native disclosure control:

- The collapsed summary reads `Latest {total} · Repo/docs {count} · Enrich {count}` using the existing audit payload.
- The expanded body shows Transcript plus non-zero enrichment-reason counts in a wrapping grid.
- Zero-value reasons are omitted from the expanded mobile body. If no reasons are non-zero, show `No flagged reasons`.
- The control uses `aria-expanded`/native disclosure semantics and remains keyboard operable.
- Desktop keeps the current batch-health presentation.

### History-backed drill-in

History behavior applies only when the mobile one-screen layout is active:

1. On startup, replace the current history entry with an application-owned `findings` state without changing the URL or query string.
2. Before opening a finding or release notes, save the list scroll position in the current history entry.
3. Push a new application-owned state for the destination, then render the existing detail pane.
4. A workflow link from one finding to another pushes another finding state, so Back returns to the parent detail before returning to the list.
5. `popstate` restores the represented view. Returning to findings restores the prior filter, search query, selected finding, and list scroll position.
6. The in-page `Findings`/`Back to findings` controls call browser history when the current entry was pushed by the dashboard; otherwise they fall back to closing the pane locally.

If a restored finding no longer exists or its detail request fails, return to the list and use the existing toast/error treatment. Do not expose auth tokens or add them to new URLs.

Desktop selection remains local to the split explorer and does not add history entries.

### Reason-chip normalization

Keep the existing priority order and three-chip cap. Before rendering:

- Normalize comparison keys case-insensitively.
- Treat a `triage ` prefix as presentation metadata, not a distinct reason.
- Deduplicate equivalent triage and quality reasons while preserving the first, highest-priority label.
- Do not alter stored reasons, scores, triage retryability, filters, or detail diagnostics.

## Implementation boundaries

The change remains inside the current server-rendered dashboard:

- `src/dashboard.ts`: markup, responsive CSS, disclosure rendering, reason normalization, and mobile history state.
- `test/dashboard.test.ts`: deterministic HTML/behavior hooks and regression assertions.
- Browser verification: real interaction and layout checks against a local production build.

No new runtime dependency or frontend framework is introduced.

## Verification

### Automated

- Add focused assertions for primary versus secondary filter markup and mobile layout hooks.
- Assert the batch summary and non-zero reason rendering hooks.
- Assert semantic reason deduplication while retaining the priority cap.
- Assert history initialization, push, `popstate`, scroll preservation, and release-note/finding back paths.
- Run the full test suite, TypeScript build, production dependency audit, and `git diff --check`.

### Browser matrix

Verify at 320 × 568, 390 × 844, 430 × 932, 980 × 900, and a desktop viewport:

- Public list, Sid list, primary filters, secondary tray, active secondary filter, search, and empty results.
- Public detail, Sid detail, workflow-linked detail, release notes, in-page back, and browser Back/Forward.
- Add URL prompt opens and dismisses without mutation.
- No horizontal page overflow, control overlap, clipped labels, console errors, or console warnings.
- Desktop split explorer, all desktop filters, detail selection, and release notes remain functional.

### Measurable acceptance criteria

- At 390 × 844 with disclosures closed, the first finding begins no lower than 325 pixels from the top, down from about 424 pixels.
- The collapsed mobile filter and batch-health controls have no horizontal overflow.
- All secondary filters remain reachable in at most one tap from the list.
- Browser Back from the first mobile detail or release-notes view returns to the same list state and scroll position instead of leaving the dashboard.
- Quality, triage, audit, enrichment, recommendation, authentication, and desktop behavior remain unchanged.
