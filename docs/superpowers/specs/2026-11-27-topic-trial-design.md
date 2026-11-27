# Topic suggestion trial

User-approved scope: a simple suggestion-only trial inside Tech Radar and a fresh real-post batch; continue fixing issues without another design round.

Add an optional owner review queue at `/suggestions`. Load a validated batch from `TOPIC_SUGGESTIONS_FILE`; store confirmed or corrected categories in `RUN_STATE_DIR/topic-suggestion-feedback.json`. Confirmation records feedback only: never invoke the pipeline, publish, skip, or dispatch to StockBot. Show source text and the original link, plus a clear insufficient-information state. Persist corrections by batch, post and input hash. Reject stale requests. Use existing owner authentication and no-store headers; disable the feature when no batch is configured. No dependencies or browser API keys.

Approach: a file-backed batch trial keeps costs bounded and makes the reviewed inputs reproducible. Live per-intake calls would need a durable spend limit and further evaluation. A detached report would not exercise the Radar workflow. The implementation choice is a local batch queue integrated into Radar, not deployment of a new default router.

Fresh evaluation: newest 25 unique social-post URLs from the intake log excluding the previous batch, regardless of prior status. Freeze exact source inputs and existing Jev questions before inference; Codex labels remain model judgments. Include capture failures in the results and never replace original text with generated research notes. Use the existing total $5 budget. Production deployment is a separate final step after review.
