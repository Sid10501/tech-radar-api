import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "extract_post.py"
spec = importlib.util.spec_from_file_location("extract_post", SCRIPT_PATH)
extract_post = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(extract_post)


def test_extract_youtube_video_id_from_common_urls():
    assert extract_post.extract_youtube_video_id("https://www.youtube.com/watch?v=iQyg-KypKAA&t=12s") == "iQyg-KypKAA"
    assert extract_post.extract_youtube_video_id("https://youtu.be/iQyg-KypKAA") == "iQyg-KypKAA"
    assert extract_post.extract_youtube_video_id("https://example.com/video") is None


def test_extract_google_drive_file_id_from_common_urls():
    assert extract_post.extract_google_drive_file_id("https://drive.google.com/file/d/abc123/view?usp=drivesdk") == "abc123"
    assert extract_post.extract_google_drive_file_id("https://drive.google.com/open?id=abc123") == "abc123"
    assert extract_post.extract_google_drive_file_id("https://drive.google.com/uc?export=download&id=abc123") == "abc123"
    assert extract_post.extract_google_drive_file_id("https://example.com/file/d/abc123/view") is None


def test_extract_google_drive_pdf_uses_document_text_without_ytdlp(monkeypatch, tmp_path):
    pdf_path = tmp_path / "source.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n")

    def fail_ytdlp(*_args, **_kwargs):
        raise AssertionError("google drive PDFs should not route through yt-dlp")

    monkeypatch.setattr(extract_post, "run_ytdlp", fail_ytdlp)
    monkeypatch.setattr(
        extract_post,
        "download_google_drive_file",
        lambda _url, _out_dir: (pdf_path, "Simulation Trading Bot.pdf", None),
    )
    monkeypatch.setattr(
        extract_post,
        "extract_pdf_text",
        lambda _path: ("Build a simulation trading bot with Alpaca and backtesting.", None),
    )

    result = extract_post.extract(
        "https://drive.google.com/file/d/abc123/view?usp=drivesdk",
        tmp_path,
        do_transcribe=True,
        do_ocr=False,
    )

    assert result["platform"] == "google_drive"
    assert result["status"] == "ok"
    assert result["title"] == "Simulation Trading Bot.pdf"
    assert result["caption"] == "Simulation Trading Bot.pdf"
    assert result["transcript"] == "Build a simulation trading bot with Alpaca and backtesting."
    assert result["transcript_source"] == "document"
    assert result["extraction_methods"] == ["google-drive:download", "pypdf"]


def test_transcript_snippets_are_normalized_to_text():
    snippets = [
        {"text": " First line ", "start": 0.0, "duration": 1.5},
        {"text": "Second&nbsp;line", "start": 1.5, "duration": 2.0},
        {"text": "First line", "start": 3.5, "duration": 1.0},
    ]

    assert extract_post.transcript_snippets_to_text(snippets) == "First line Second line"


def test_collect_chapters_maps_ytdlp_metadata():
    info = {
        "chapters": [
            {"title": "Intro", "start_time": 0, "end_time": 12},
            {"title": "Main idea", "start_time": 12.4},
            {"title": "", "start_time": 20},
        ]
    }

    assert extract_post.collect_chapters(info) == [
        {"title": "Intro", "start_time": 0, "end_time": 12},
        {"title": "Main idea", "start_time": 12.4, "end_time": None},
    ]


def test_parse_youtube_api_comments_maps_plain_text_threads():
    payload = {
        "items": [
            {
                "snippet": {
                    "topLevelComment": {
                        "snippet": {
                            "authorDisplayName": "Viewer",
                            "textDisplay": "Helpful workflow",
                            "likeCount": 8,
                            "publishedAt": "2026-06-20T10:00:00Z",
                        }
                    }
                }
            },
            {
                "snippet": {
                    "topLevelComment": {
                        "snippet": {
                            "authorDisplayName": "Empty",
                            "textDisplay": " ",
                        }
                    }
                }
            },
        ]
    }

    assert extract_post.parse_youtube_api_comments(payload, 5) == [
        {
            "author": "Viewer",
            "text": "Helpful workflow",
            "like_count": 8,
            "timestamp": "2026-06-20T10:00:00Z",
        }
    ]


def test_classify_linked_artifacts_from_source_links():
    assert extract_post.classify_linked_artifacts([
        "https://github.com/kunchenguid/no-mistakes",
        "https://github.com/kunchenguid/lavish-axi",
        "https://github.com/kunchenguid/gnhf",
        "https://github.com/kunchenguid/treehouse",
        "https://github.com/kunchenguid/firstmate",
        "https://github.com/starmel/OpenSuperWhisper",
        "https://wezterm.org/index.html",
        "https://axi.md/",
        "https://linktr.ee/kunchenguid",
    ]) == [
        {
            "url": "https://github.com/kunchenguid/no-mistakes",
            "type": "validation_gate",
            "role": "pre-push validation gate",
        },
        {
            "url": "https://github.com/kunchenguid/lavish-axi",
            "type": "interactive_planning",
            "role": "interactive planning artifact",
        },
        {
            "url": "https://github.com/kunchenguid/gnhf",
            "type": "long_running_agent",
            "role": "long-running agent loop",
        },
        {
            "url": "https://github.com/kunchenguid/treehouse",
            "type": "worktree_orchestration",
            "role": "parallel worktree management",
        },
        {
            "url": "https://github.com/kunchenguid/firstmate",
            "type": "agent_orchestration",
            "role": "agent crew coordination",
        },
        {
            "url": "https://github.com/starmel/OpenSuperWhisper",
            "type": "voice_input",
            "role": "voice input tool",
        },
        {
            "url": "https://wezterm.org/index.html",
            "type": "terminal_tool",
            "role": "terminal cockpit",
        },
        {
            "url": "https://axi.md/",
            "type": "agent_interface",
            "role": "agent-facing CLI/interface pattern",
        },
        {
            "url": "https://linktr.ee/kunchenguid",
            "type": "profile",
            "role": "creator/profile link",
        },
    ]
