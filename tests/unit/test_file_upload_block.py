"""Tests for aiui.file_upload() block and safe attachment lifecycle."""

from __future__ import annotations

import os
import time

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui.features import attachments as att_mod


def test_file_upload_builder_defaults_and_options():
    basic = aiui.file_upload("Upload CSV")
    assert basic == {
        "type": "file_upload",
        "label": "Upload CSV",
        "name": "files",
        "multiple": False,
        "max_size_mb": 10,
    }

    custom = aiui.file_upload(
        "Documents",
        name="docs",
        accept=[".pdf", ".csv"],
        multiple=True,
        max_size_mb=5,
        help_text="Drop PDF or CSV files",
        auto_submit=True,
    )
    assert custom == {
        "type": "file_upload",
        "label": "Documents",
        "name": "docs",
        "multiple": True,
        "max_size_mb": 5,
        "accept": ".pdf,.csv",
        "help_text": "Drop PDF or CSV files",
        "auto_submit": True,
    }


@pytest.mark.parametrize("bad_size", [0, -1, True, "5"])
def test_file_upload_rejects_invalid_max_size(bad_size):
    with pytest.raises(ValueError, match="max_size_mb"):
        aiui.file_upload("Bad", max_size_mb=bad_size)


def test_get_uploaded_file_resolves_uuid_and_blocks_traversal(tmp_path, monkeypatch):
    mgr = att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))
    monkeypatch.setattr(att_mod, "_attachment_manager", mgr)

    meta = mgr.upload(b"a,b\n1,2\n", "data.csv", "text/csv")

    resolved_by_id = aiui.get_uploaded_file(meta["id"])
    assert resolved_by_id is not None
    assert resolved_by_id["filename"] == "data.csv"
    assert os.path.isfile(resolved_by_id["path"])

    resolved_by_handle = aiui.get_uploaded_file({"id": meta["id"], "filename": "data.csv"})
    assert resolved_by_handle is not None
    assert resolved_by_handle["path"] == meta["path"]

    # Path traversal and non-UUID strings must never resolve.
    assert aiui.get_uploaded_file("../etc/passwd") is None
    assert aiui.get_uploaded_file({"id": "../../secret.txt"}) is None
    assert aiui.get_uploaded_file("") is None
    assert aiui.get_uploaded_file(None) is None


def test_attachment_manager_evicts_expired_and_over_capacity_files(tmp_path):
    mgr = att_mod.AttachmentManager(
        storage_dir=str(tmp_path / "att"),
        ttl_seconds=1.0,
        max_entries=2,
    )
    m1 = mgr.upload(b"one", "1.txt", "text/plain")
    m2 = mgr.upload(b"two", "2.txt", "text/plain")
    m3 = mgr.upload(b"three", "3.txt", "text/plain")

    # Max capacity 2 evicts oldest (m1) and unlinks its file.
    assert mgr.get(m1["id"]) is None
    assert not os.path.exists(m1["path"])
    assert mgr.get(m2["id"]) is not None
    assert mgr.get(m3["id"]) is not None

    # Force expiry via monotonic clock offset.
    mgr._created_at[m2["id"]] = time.monotonic() - 10.0
    assert mgr.get(m2["id"]) is None
    assert not os.path.exists(m2["path"])


def test_attachment_mime_allowlist_permits_audio_office_and_blocks_xss(tmp_path):
    mgr = att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))

    assert mgr.upload(b"ID3", "clip.mp3", "audio/mpeg")["filename"] == "clip.mp3"
    assert (
        mgr.upload(
            b"PK\x03\x04",
            "sheet.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )["filename"]
        == "sheet.xlsx"
    )

    for dangerous in ("text/html", "image/svg+xml", "application/javascript"):
        with pytest.raises(ValueError, match="Type not allowed"):
            mgr.upload(b"<script>alert(1)</script>", "bad.file", dangerous)


def test_upload_endpoint_requires_auth_when_token_auth_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "secret-upload-token")
    mgr = att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))
    monkeypatch.setattr(att_mod, "_attachment_manager", mgr)

    from praisonaiui.server import create_app

    app = create_app()
    with TestClient(app) as client:
        unauth = client.post(
            "/api/chat/attachments",
            headers={"Content-Type": "text/plain", "X-Filename": "hello.txt"},
            content=b"hello",
        )
        assert unauth.status_code == 401

        authed = client.post(
            "/api/chat/attachments",
            headers={
                "Authorization": "Bearer secret-upload-token",
                "Content-Type": "text/plain",
                "X-Filename": "hello.txt",
            },
            content=b"hello",
        )
        assert authed.status_code == 200, authed.text
        body = authed.json()
        assert body["filename"] == "hello.txt"
        assert aiui.get_uploaded_file(body)["filename"] == "hello.txt"

        # Also verify JSON base64 upload works without python-multipart.
        import base64

        json_up = client.post(
            "/api/chat/attachments",
            headers={"Authorization": "Bearer secret-upload-token"},
            json={
                "filename": "notes.md",
                "content_type": "text/markdown",
                "data_base64": base64.b64encode(b"# Hi").decode(),
            },
        )
        assert json_up.status_code == 200, json_up.text
        assert aiui.get_uploaded_file(json_up.json())["filename"] == "notes.md"
