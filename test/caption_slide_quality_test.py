import importlib.util
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


spec = importlib.util.spec_from_file_location("extract_post_quality", Path(__file__).resolve().parents[1] / "scripts" / "extract_post.py")
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


@pytest.mark.parametrize("initial,sparse,expected,modes", [
    (("Clean text already present", 94, 20), None, "Clean text already present", [6]),
    (("", 0, 0), ("Named project", 87, 12), "Named project", [6, 11]),
    (("Some imperfect content", 65, 18), ("One", 99, 3), "Some imperfect content", [6, 11]),
    (("Some imperfect content", 65, 18), None, "Some imperfect content", [6, 11]),
])
def test_still_ocr_budget_and_choice(tmp_path, monkeypatch, initial, sparse, expected, modes):
    img = tmp_path / "slide.png"
    img.touch()
    calls = []

    def ocr(path, mode, timeout):
        assert 0 < timeout <= 20
        calls.append(mode)
        if mode == 11 and sparse is None:
            raise subprocess.TimeoutExpired("tesseract", timeout)
        return initial if mode == 6 else sparse

    monkeypatch.setattr(extractor.shutil, "which", lambda name: name)
    monkeypatch.setattr(extractor, "ocr_still_image", ocr)
    assert extractor.extract_image_text([img]) == (expected, None)
    assert calls == modes


def test_youtube_capture_keeps_original_manual_track_and_times(tmp_path, monkeypatch):
    info = {"id": "abcdefghijk", "language": "fr-CA", "description": "Source caption"}
    def track(code, generated):
        return SimpleNamespace(language_code=code, is_generated=generated, fetch=lambda: SimpleNamespace(
            to_raw_data=lambda: [{"text": "Bonjour", "start": 1.25, "duration": 0.5}]))
    tracks = [track("en", False), track("fr", True), track("fr", False)]
    api = SimpleNamespace(YouTubeTranscriptApi=lambda: SimpleNamespace(list=lambda _: tracks))
    monkeypatch.setitem(sys.modules, "youtube_transcript_api", api)
    monkeypatch.setattr(extractor, "is_allowed_fetch_url", lambda _: True)
    monkeypatch.setattr(extractor, "run_ytdlp", lambda *a, **kw: (info, None, None, None))
    result = extractor.extract("https://www.youtube.com/watch?v=abcdefghijk", tmp_path, do_transcribe=True, do_ocr=False)
    assert result["transcript_track"] == {"language": "fr", "kind": "manual"}
    assert result["transcript_segments"] == [{"start_ms": 1250, "end_ms": 1750, "text": "Bonjour"}]
    assert "captions:manual:fr" in result["extraction_methods"]


def test_youtube_cli_preserves_generated_track_and_ignores_translations(tmp_path, monkeypatch):
    info = {"id": "abcdefghijk", "language": "fr", "description": "Source caption",
            "subtitles": {"en": [{"url": "https://example.com/sub"}]},
            "automatic_captions": {"fr-orig": [{"url": "https://example.com/asr"}],
                                   "de": [{"url": "https://example.com/sub?tlang=de"}]}}
    def fallback(url, folder, code, kind):
        assert (code, kind) == ("fr-orig", "generated")
        (folder / "abcdefghijk.fr-orig.vtt").write_text("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n")
    monkeypatch.setattr(extractor, "is_allowed_fetch_url", lambda _: True)
    monkeypatch.setattr(extractor, "fetch_youtube_transcript_api", lambda *a: (None, [], None, "unavailable"))
    monkeypatch.setattr(extractor, "run_ytdlp", lambda *a, **kw: (info, None, None, None))
    monkeypatch.setattr(extractor, "download_subtitles_cli", fallback)
    result = extractor.extract("https://www.youtube.com/watch?v=abcdefghijk", tmp_path, do_transcribe=True, do_ocr=False)
    assert result["transcript"] == "Bonjour"
    assert result["transcript_track"]["kind"] == "generated"
    assert result["transcript_source"] == "subs"
    assert result["transcript_track"]["language"] == "fr"


def test_original_caption_language_is_inferred_only_when_unambiguous():
    info = {"automatic_captions": {"fr-orig": [], "de": []}}
    assert extractor.youtube_source_language(info) == "fr"
    info["automatic_captions"]["de-orig"] = []
    assert extractor.youtube_source_language(info) is None
    info["language"] = "de-DE"
    assert extractor.youtube_source_language(info) == "de-DE"
