# Implementation plan

1. Compare the public Instagram page, embed and media responses for DfPK0_smzNh. Record whether slide 1 and slide 7 produce distinct source images.
2. Update scripts/extract_post.py to prefer ordered child metadata, OCR each image independently, label preview-only evidence and decode HTML metadata before deriving tags. Exercise bounded acquisition and failed children.
3. Carry coverage through src/extract.ts and src/compose.ts. Keep canonical slide links and public evidence in the finding. Treat incomplete source capture as a reason for review.
4. Extend the implementation agent with a separate private build proposal. Include research evidence in the prompt and use the existing owner experiment workflow for promotion.
5. Expose capture coverage in the portfolio detail view and retain compatibility with its committed snapshot. Exercise the Python tests, TypeScript build and Vitest suite.
6. Backfill older findings only with evidence that can be attributed to the original post. Preserve the historical disposition. Benchmark alternate acquisition methods before deploying dependencies.

## Measured on November 26

Ordinary HTML and the image endpoint returned the same cover for indices 1 and 7. The public embed did not supply a child manifest. gallery-dl 1.32.21 received HTTP 401. yt-dlp 2026.11.23 in metadata-only mode with missing video formats permitted returned eight ordered children. The production extractor with the patch and local Tesseract recovered all six named skills on slides 2–7.

The ten historical Instagram findings carrying “No video formats found” yielded 58 listed items and 57 nonempty OCR outputs with the carousel budget of 20. A nonempty output measures OCR availability only. The two November collections were checked against the resulting text for named items. No model generation, production dispatch or application adoption was included in this benchmark.
