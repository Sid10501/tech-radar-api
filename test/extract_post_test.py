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
    monkeypatch.setattr(extract_post, "resolves_to_public_address", lambda host: True)
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


def test_extract_rejects_unsafe_primary_urls_before_ytdlp(monkeypatch, tmp_path):
    def fail_ytdlp(*_args, **_kwargs):
        raise AssertionError("unsafe primary URLs should not reach yt-dlp")

    monkeypatch.setattr(extract_post, "run_ytdlp", fail_ytdlp)

    result = extract_post.extract(
        "http://169.254.169.254/latest/meta-data",
        tmp_path,
        do_transcribe=True,
        do_ocr=True,
    )

    assert result["status"] == "failed"
    assert "unsafe URL" in result["error"]


def test_run_ytdlp_reports_timeout(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_post, "resolves_to_public_address", lambda host: True)
    class FakeYoutubeDL:
        def __init__(self, _opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, *_args, **_kwargs):
            raise TimeoutError("timed out")

    monkeypatch.setitem(__import__("sys").modules, "yt_dlp", type("FakeModule", (), {"YoutubeDL": FakeYoutubeDL}))

    info, audio_path, video_path, error = extract_post.run_ytdlp(
        "https://example.com/video",
        tmp_path,
        want_audio=True,
        want_video=False,
        want_subtitles=False,
        max_comments=0,
    )

    assert info is None
    assert audio_path is None
    assert video_path is None
    assert error and "timeout" in error.lower()


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


def test_instagram_children_keep_ocr_and_positions(monkeypatch, tmp_path):
    url = "https://www.instagram.com/p/example/?img_index=3"
    info = {"description": "Three tools", "entries": [
        {"thumbnail": "https://example.com/one.jpg"}, None,
        {"thumbnail": "https://example.com/three.jpg"}]}
    monkeypatch.setattr(extract_post, "run_ytdlp", lambda *a, **kw: (None, None, None, "No video formats"))
    monkeypatch.setattr(extract_post, "run_ytdlp_json_cli", lambda *a: (info, None))
    monkeypatch.setattr(extract_post, "_http_get_bytes", lambda url, timeout: url.encode())
    monkeypatch.setattr(extract_post, "extract_image_text", lambda paths: (paths[0].read_text().split("/")[-1], None))
    monkeypatch.setattr(extract_post, "is_allowed_fetch_url", lambda url: True)
    result = extract_post.extract(url, tmp_path, do_transcribe=False, do_ocr=True)
    slides = result["instagram_capture"]["slides"]
    assert [slide["text"] for slide in slides] == ["one.jpg", None, "three.jpg"]
    assert [asset["ocr_text"] for asset in result["media_assets"] if asset["type"] == "image"] == ["one.jpg", "three.jpg"]
    assert slides[1]["status"] == "unavailable"


def test_heif_url_uses_returned_image_format(monkeypatch, tmp_path):
    urls = extract_post.collect_image_urls({"entries": [
        {"thumbnail": "https://example.com/one.HEIC?signed=one"},
        {"ext": "heif", "url": "https://example.com/two.heif"},
        {"thumbnail": "https://example.com/three.heic"},
    ]})
    assert len(urls) == 3
    bodies = dict(zip(urls, [b"\xff\xd8\xff\xe0jpeg", b"\0\0\0\x18ftypheic", b"RIFF1234WEBPbytes"]))
    monkeypatch.setattr(extract_post, "_http_get_bytes", lambda url, timeout: bodies[url])
    paths, assets, warnings = extract_post.download_image_assets(urls, tmp_path)
    assert [p.name for p in paths] == ["image-001.jpg", "image-003.webp"]
    assert [p.read_bytes() for p in paths] == [bodies[urls[0]], bodies[urls[2]]]
    assert [asset["url"] for asset in assets] == [urls[0], urls[2]]
    assert len(warnings) == 1 and "unsupported image format" in warnings[0]


def test_jpeg_thumbnail_remains_preferred_when_heif_also_exists():
    alias = "https://example.com/full.heic"
    jpeg = "https://example.com/fallback.jpg"
    assert extract_post.collect_image_urls({"thumbnail": alias, "thumbnails": [{"url": jpeg}]}) == [jpeg, alias]


def test_tiktok_photo_shortlink_retains_missing_child_and_bounds_media(monkeypatch, tmp_path):
    import json
    source = "https://vt.tiktok.com/example"
    post_id = "7677607825593355533"
    short_target = f"https://www.tiktok.com/@/photo/{post_id}?tracking=omit"
    body = {"itemInfo": {"itemStruct": {
        "id": post_id, "desc": "Three tools #workflow", "author": {"uniqueId": "creator"},
        "imagePost": {"images": [{"imageURL": {"urlList": [url]}} for url in [
            "https://p16.tiktokcdn.com/one.jpeg?token=one",
            "https://p16.tiktokcdn.com.invalid/two.jpeg",
            "https://p16.tiktokcdn.com/three.jpeg"]]},
    }}, "statusCode": 0}
    requests = []
    def fetch(url, *, media, max_bytes):
        requests.append((url, media, max_bytes))
        if url == source:
            return short_target, b""
        if not media:
            assert url == f"https://www.tiktok.com/@/video/{post_id}"
            state = json.dumps({"__DEFAULT_SCOPE__": {"webapp.video-detail": body}})
            return url, f'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{state}</script>'.encode()
        return url, b"image"
    monkeypatch.setenv("OCR_MAX_IMAGES", "2")
    monkeypatch.setattr(extract_post, "is_allowed_fetch_url", lambda url: True)
    monkeypatch.setattr(extract_post, "fetch_tiktok_asset", fetch)
    monkeypatch.setattr(extract_post, "run_ytdlp", lambda *a, **kw: (None, None, None, None))
    monkeypatch.setattr(extract_post, "extract_image_text", lambda paths: ("First item", None))
    result = extract_post.extract(source, tmp_path, do_transcribe=False, do_ocr=True)
    assert result["creator"] == "creator" and result["caption"] == "Three tools #workflow"
    assert [s["status"] for s in result["photo_capture"]["slides"]] == ["ocr", "unavailable", "skipped"]
    assert [s["index"] for s in result["photo_capture"]["slides"]] == [1, 2, 3]
    assert result["media_assets"][0]["url"] is None
    assert len(requests) == 3 and requests[2][2] > 0
    body["itemInfo"]["itemStruct"]["id"] = "9999999999999999999"
    assert extract_post.tiktok_photo_manifest(source)["entries"] == []


def test_tiktok_photo_scope_rejects_foreign_hosts_and_credentials():
    for url in ["https://example.com/video/123", "http://www.tiktok.com/",
                "https://www.tiktok.com:8443/", "https://user@example.com/",
                "https://user@www.tiktok.com/"]:
        assert not extract_post.tiktok_url_allowed(url)
    assert not extract_post.tiktok_url_allowed("https://www.tiktok.com/", media=True)


def test_social_description_survives_title_and_meta_attribute_order(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_post, "is_allowed_fetch_url", lambda url: True)
    monkeypatch.setattr(extract_post, "run_ytdlp", lambda *a, **kw: ({"title": "Post by Sid"}, None, None, None))
    monkeypatch.setattr(extract_post, "_http_get", lambda *a, **kw: """<meta content="Here's the demo &amp; its docs https://example.com/docs #demo" property="og:description">""")
    result = extract_post.extract("https://www.instagram.com/p/example/", tmp_path, False, False)
    assert result["caption"] == "Here's the demo & its docs https://example.com/docs #demo"
    assert result["hashtags"] == ["demo"]
    assert "https://example.com/docs" in result["source_links"]
    assert "html-meta:description" in result["extraction_methods"]


def test_social_title_alone_is_not_a_caption(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_post, "is_allowed_fetch_url", lambda url: True)
    monkeypatch.setattr(extract_post, "run_ytdlp", lambda *a, **kw: (None, None, None, None))
    monkeypatch.setattr(extract_post, "run_ytdlp_json_cli", lambda *a: (None, None))
    monkeypatch.setattr(extract_post, "try_oembed", lambda *a: {"title": "Post by Sid"})
    monkeypatch.setattr(extract_post, "try_html_meta", lambda *a: {})
    result = extract_post.extract("https://www.instagram.com/p/example/", tmp_path, False, False)
    assert result["title"] == "Post by Sid"
    assert result["caption"] is None


def test_tiktok_oembed_preserves_creator_description(monkeypatch, tmp_path):
    monkeypatch.setattr(extract_post, "is_allowed_fetch_url", lambda url: True)
    monkeypatch.setattr(extract_post, "run_ytdlp", lambda *a, **kw: (None, None, None, None))
    monkeypatch.setattr(extract_post, "tiktok_photo_manifest", lambda *a: None)
    monkeypatch.setattr(extract_post, "try_html_meta", lambda *a: {})
    monkeypatch.setattr(extract_post, "try_oembed", lambda *a: {"title": "Try this #demo https://example.com/demo"})
    result = extract_post.extract("https://www.tiktok.com/@creator/video/1234567890123456789", tmp_path, False, False)
    assert result["caption"] == "Try this #demo https://example.com/demo"
    assert result["hashtags"] == ["demo"]
    assert "tiktok:oembed-title" in result["extraction_methods"]
