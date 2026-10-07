# Video sampling comparison

The full-duration sampler fixes a demonstrated temporal coverage gap. Semantic recall, identifier accuracy, source access success, and paid-provider quality remain unmeasured. The twelve-source evaluation below is a template, not a completed benchmark.

## Locally tested synthetic comparison — September 12, 2026

Run from `tech-radar-api`:

```sh
python3 scripts/benchmark_video_sampling.py --output /tmp/video-sampling.json
npm test -- test/extractPostScript.test.ts test/extract.test.ts test/runner.socialVideo.test.ts test/socialVideoEvidence.test.ts
```

The script generates blue 2-fps clips with a red event near the final fifth, aligned to an existing source frame. It compares the old `fps=1/min(10,duration/8)` filter (with its existing 0.5-second floor and eight-frame cap, baseline `d4d8075`) against the actual current sampler. Both use a 960-pixel output width and at most eight frames. Color decoding establishes whether a selected image contains the event. It invokes no network, transcription, OCR, vision, or paid API. Temporary media is removed; JSON records hashes, source sizes, versions, timestamps, warnings, and all three timing runs. Frame-generation timing excludes clip creation and color scoring.

Observed results in [the retained JSON report](video-sampling-2026-09-12.json):

| Clip duration | Old/current frame count | Old/current red frames | Old/current median cached sampling time |
| --- | --- | --- | --- |
| 2 seconds | 4 / 3 | 1 / 1 | 0.035 / 0.154 seconds |
| 24 seconds | 8 / 8 | 2 / 2 | 0.038 / 0.309 seconds |
| 300 seconds | 8 / 8 | 0 / 2 | 0.039 / 0.320 seconds |
| 1,800 seconds | 8 / 8 | 0 / 2 | 0.041 / 0.316 seconds |

All three repetitions had the same frame counts and event detections. The five-minute clip now has source presentation timestamps from 19.0 through 281.5 seconds; the thirty-minute clip spans 112.5 through 1,687.5 seconds. Old assets had no source timestamps. The real ffmpeg regression independently checks the first and last five-minute timestamps.

These simple cached clips show improved late-event coverage, with higher sampling overhead from separate seeks. They do not show a speedup or establish performance on real codecs, remote downloads, OCR, small text, or scene transitions. Fixed old-then-current execution order and this machine's cache state also limit timing conclusions. On the 2-second, 2-fps fixture the last requested midpoint has no later decodable frame, so the new method returns three frames. Frame count is an upper bound, and midpoints can miss brief content anywhere in a video. No deduplication or scene detector has been added.

## Acquisition and evidence behavior

YouTube remains caption-first by default. After deciding that captions are insufficient, opt into bounded video acquisition for a specific extraction:

```ts
await extract(url, { youtubeVisuals: true });
```

For a direct extractor invocation:

```sh
YOUTUBE_VISUAL_ENABLED=1 python3 scripts/extract_post.py 'https://www.youtube.com/watch?v=VIDEO_ID' --out-dir /tmp/radar-visual-review
```

`youtubeVisuals: false` disables the process-level setting for that subprocess; an omitted option inherits the environment. OCR must be enabled. No automatic transcript-sufficiency classifier or public request option is introduced. An enabled visual pass still tries subtitles first for transcription, reuses downloaded video audio if needed, and reports download failures even if metadata succeeds.

The existing 30-minute duration limit, download-byte setting, network controls, yt-dlp timeout, 1–20 frame setting (default eight), tesseract timeout, and typed evidence budgets remain. All frame seeks share the existing ffmpeg timeout, rather than multiplying it per frame. `OCR_FRAME_INTERVAL_SEC` now sets minimum spacing; a long clip increases spacing to fit the frame budget across its duration. Unknown duration retains bounded early fallback sampling and emits a coverage warning.

Local `ocr-frames/index.json` associates each screenshot with OCR text and decoded `timestamp_ms`. ffmpeg's first decoded presentation timestamp is recorded relative to stream start; unavailable times remain null. The aggregate `visual_text` remains compatible with existing consumers. Typed `visualTexts` retains per-frame OCR/timestamps, bounds each text and the aggregate, and excludes local paths. Aggregate vision output remains untimed because the current provider returns combined text. Vision selects frames across the available sequence when applying its existing four/eight-image cap. Historical extraction assets without a manifest remain readable with unknown timestamps.

The research prompt also receives bounded, untrusted OCR excerpts with their frame times. Each observation is capped separately so the last frame survives the prompt budget; these excerpts carry no local file paths and are explicitly labelled as observations, not verified claims.

## Twelve-source manual A/B protocol

Copy [the manifest template](video-ab-manifest.template.json). Populate all twelve slots: four short reels with fleeting identifiers, four tutorials with relevant material after eighty seconds, two captioned YouTube videos, and two local screen recordings with small text changes. No slot is currently sourced, labelled, or scored.

1. Record the real URL or local path, retrieval date, exact input hash, duration, and tool/model versions. Pin baseline `d4d8075` and the eventual candidate commit. Keep local files and private results outside public findings.
2. Before inspecting extractor output, watch each input and label relevant repository/package names and visual events with start/end times. Record which identifiers are visual-only versus spoken/captioned. Use a second reviewer for ambiguous names and timings; retain unresolved labels explicitly. Save a reference transcript or verify the cached transcript by listening.
3. Run both samplers on identical cached media and identical cached captions/transcript. Hold maximum frame count (eight), actual image count where possible, width (960), OCR/vision/transcription providers, models, prompts, and provider settings constant. A missing frame is an extraction failure/limitation to record, not an image to silently replace. Use separate output directories so files cannot contaminate the other arm.
4. Run complete URL acquisition separately from cached sampling, with the same download/time limits. Record blocked sources and partial downloads as failures without dropping them from the denominator. Test YouTube caption-only versus explicit visuals as a separate acquisition comparison; it changes input availability and must not be presented as an isolated sampling improvement.
5. Randomize A/B order per input and repeat cold URL timing and cached extraction timing at least three times. Record downloaded bytes, wall time, CPU/memory if available, actual frame counts, provider calls/tokens/cost, and warnings. Set `cost_ceiling` before invoking paid providers. Test larger image budgets in a separate arm.
6. Score identifier precision (`correct extracted / all extracted`) and recall (`correct extracted / all relevant labels`), plus event recall for labels after eighty seconds. Score timestamp error against the labelled interval (zero inside it, distance to the nearest bound outside it); report missing timestamps separately. Count unsupported assertions and false identifiers directly. Report per-source results and pooled counts, including failures; do not turn a twelve-item convenience sample into a population claim.
7. Compare transcript quality separately and investigate every added false identifier. The proposed decision gate is at least a ten-percentage-point relevant visual recall improvement, no added false identifiers, unchanged transcript quality/resource limits, and cost within the recorded ceiling. This gate is untested. If it fails, retain the measured limitations and revisit sampling instead of claiming successful validation.

`identifiers` and `visual_events` in the template are intentionally empty. The example label shapes are placeholders, not source evidence. Set each row's `label_status` and `metrics` only after the corresponding work is completed.
