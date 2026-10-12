# One-source video sampling and OCR comparison

This is an exploratory, offline comparison on one **raw, silent 40.53-second screen recording**, not a provider or scraper benchmark. The source is `creative-media/buildwithsid/public/project-demos/radar-capture.mp4` (SHA-256 `c2592b3e8aa653c937f8211da79298323c7fd5daa1b2137fcfc7e777eb016d12`). The sibling repository's `creative-media/buildwithsid/content/project-demos/tech-radar-source.json` manifest identifies it as a capture of an existing public Radar finding and explicitly limits what it demonstrates. The measured [JSON report](real-video-2026-10-07.json) retains all three attempts, per-frame OCR, matched identifiers, warnings, and timing; its source path has been made workspace relative.

The original six identifiers were recorded before extraction on October 7. The original label file and benchmark script were lost with temporary files; [this reference](real-video-reference-2026-10-07.json) reconstructs their identifiers and approximate visibility from the saved record. The historical label SHA-256 in the measured report identifies the lost original serialization. It **does not** authenticate this reconstructed JSON. Jitter and Rive remain visible through the capture, `.riv` appears after the transition near 16 seconds, and the two URLs and `StatusSM` appear in the lower page near 28 seconds. The index-to-finding transition and scrolling times are approximate, so there is no frame-accurate event or timestamp-error score.

Both arms sampled at most eight 960-pixel-wide frames from the same local file, then ran Tesseract `--psm 6`. The baseline used the former `fps=1/max(0.5,min(10,duration/8))` filter with an eight-frame cap. The current arm used `sample_video_frames` from `scripts/extract_post.py`, seeking to eight duration-wide midpoints and recording decoded presentation timestamps. The baseline did not record decoded PTS; its nominal interval midpoints are estimates, not measured source timestamps. For each identifier, matching casefolded text, removed whitespace, and looked for the resulting literal substring anywhere in the OCR output. This measures six-item **identifier recall** only, with no precision, semantic accuracy, or event-recall assessment.

| Measured result, three runs | Baseline | Current |
| --- | ---: | ---: |
| Frames and warnings in every run | 8, none | 8, none |
| Identifiers found in every run | 5/6 | 5/6 |
| Median frame-sampling time | 0.1574 s | 0.7080 s |
| Median OCR time | 7.2674 s | 7.2076 s |

Both missed `StatusSM`: OCR rendered it as `statussh`. The matching five identifiers and equal recall establish no semantic advantage on this recording. Current sampling took longer here; OCR times were similar. The current frame records include decoded PTS at 2.533, 7.600, 12.667, 17.733, 22.800, 27.867, 32.933, and 38.000 seconds. This single short source does not exercise the late-coverage issue shown by the separate [synthetic benchmark](video-sampling.md), and fixed baseline-then-current run order plus local cache effects limit performance interpretation.

To make a **new**, comparable local run from the repository parent, with Python, ffmpeg, ffprobe, and Tesseract installed:

```sh
cd tech-radar-api
shasum -a 256 ../creative-media/buildwithsid/public/project-demos/radar-capture.mp4
python3 scripts/benchmark_real_video.py \
  --source ../creative-media/buildwithsid/public/project-demos/radar-capture.mp4 \
  --labels docs/benchmarks/real-video-reference-2026-10-07.json \
  --output /tmp/radar-real-video-repeat.json
```

The script accepts arbitrary local `--source`, `--labels`, and `--output` paths, writes no source or labels absolute paths into its report, and makes no network or paid API calls. Compare the output's source hash, controls, frame counts, warnings, per-frame OCR, and matches. Timing and OCR can vary with machine, cache, and tool versions. Because the original script and exact labels file are unavailable, this command is a **method reproduction**, not a byte-for-byte replay of the historical result. Save new output separately; do not overwrite the retained measurement. The existing `yt-dlp` and Tesseract extraction route remains in place. This evaluation does not compare AgentReach, `claude-video`, twelve sources, acquisition success, transcript quality, or paid vision providers.
