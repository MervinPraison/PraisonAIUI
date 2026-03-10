"""Integration tests for PDF attachment upload → chat with content extraction.

Tests the full flow:
  1. Upload a PDF via AttachmentManager
  2. Call _run_and_broadcast with attachment_ids
  3. Verify PDF text is extracted and prepended to the user message
  4. Verify the provider receives the enriched content

Run with:
    PYTHONPATH=src python3 -m pytest tests/integration/test_pdf_attachments.py -v -o "addopts=" --timeout=30
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Helper: create a minimal valid PDF with extractable text ─────────

def _make_test_pdf(text: str = "Hello from test PDF") -> bytes:
    """Return raw bytes of a minimal PDF containing *text*."""
    stream = f"BT /F1 12 Tf 100 700 Td ({text}) Tj ET"
    stream_len = len(stream)
    return (
        f"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length {stream_len} >>
stream
{stream}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF"""
    ).encode()


def _mock_run_event(content="Done"):
    """Create a mock RunEvent for run_completed."""
    event = MagicMock()
    event.type = MagicMock()
    event.type.value = "run_completed"
    event.content = content
    event.token = None
    event.error = None
    event.name = None
    event.args = None
    event.result = None
    event.step = None
    event.agent_name = None
    event.extra_data = None
    return event


def _make_mock_provider(captured_content: dict):
    """Return a mock provider that captures content sent to it."""
    async def mock_run(content, **kwargs):
        captured_content["content"] = content
        yield _mock_run_event()

    mock_provider = MagicMock()
    mock_provider.run = mock_run
    return mock_provider


# ═══════════════════════════════════════════════════════════════════
# Unit: AttachmentManager PDF round-trip
# ═══════════════════════════════════════════════════════════════════

class TestAttachmentManagerPDF:
    """Verify PDF upload stores file and metadata for later retrieval."""

    def test_upload_pdf_and_retrieve(self):
        from praisonaiui.features.attachments import AttachmentManager

        mgr = AttachmentManager()
        pdf_data = _make_test_pdf("Integration test content")
        meta = mgr.upload(
            data=pdf_data,
            filename="report.pdf",
            content_type="application/pdf",
            session_id="s-pdf-1",
        )

        assert meta["id"]
        assert meta["content_type"] == "application/pdf"
        assert meta["filename"] == "report.pdf"
        assert os.path.isfile(meta["path"])

        # Retrieve by ID
        retrieved = mgr.get(meta["id"])
        assert retrieved is not None
        assert retrieved["path"] == meta["path"]

        # Cleanup
        mgr.delete(meta["id"])

    def test_pdf_text_extraction(self):
        """Verify pypdf can extract text from our test PDF."""
        pytest.importorskip("pypdf")
        from pypdf import PdfReader
        import io

        pdf_data = _make_test_pdf("Extractable text here")
        reader = PdfReader(io.BytesIO(pdf_data))
        text = reader.pages[0].extract_text()
        assert "Extractable text here" in text


# ═══════════════════════════════════════════════════════════════════
# Integration: _run_and_broadcast with PDF attachment
# ═══════════════════════════════════════════════════════════════════

class TestPDFContentPrepend:
    """Verify _run_and_broadcast extracts PDF text and prepends it."""

    @pytest.mark.asyncio
    async def test_pdf_text_prepended_to_provider_content(self):
        """Upload a PDF, then call _run_and_broadcast and verify
        the provider receives content with the PDF text prepended."""
        pytest.importorskip("pypdf")

        from praisonaiui.features.attachments import get_attachment_manager

        # Upload a PDF to the singleton manager
        mgr = get_attachment_manager()
        pdf_data = _make_test_pdf("SECRET_PDF_CONTENT_12345")
        meta = mgr.upload(
            data=pdf_data,
            filename="secret.pdf",
            content_type="application/pdf",
            session_id="s-test",
        )
        att_id = meta["id"]

        captured = {}
        mock_provider = _make_mock_provider(captured)
        mock_datastore = AsyncMock()
        mock_datastore.add_message = AsyncMock()

        with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
             patch("praisonaiui.server._datastore", mock_datastore):

            from praisonaiui.features.chat import _run_and_broadcast
            await _run_and_broadcast(
                content="What does the PDF say?",
                session_id="s-test",
                agent_name=None,
                attachment_ids=[att_id],
            )

        # Verify the content sent to provider includes the PDF text
        assert "content" in captured, "Provider was never called"
        sent = captured["content"]
        assert "SECRET_PDF_CONTENT_12345" in sent, (
            f"PDF text not found in content sent to provider: {sent[:200]}"
        )
        assert "--- Attached PDF: secret.pdf ---" in sent
        assert "--- End of secret.pdf ---" in sent
        assert "User message: What does the PDF say?" in sent

        mgr.delete(att_id)

    @pytest.mark.asyncio
    async def test_no_attachments_passes_content_unchanged(self):
        """When no attachment_ids, content goes to provider unchanged."""
        captured = {}
        mock_provider = _make_mock_provider(captured)
        mock_datastore = AsyncMock()
        mock_datastore.add_message = AsyncMock()

        with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
             patch("praisonaiui.server._datastore", mock_datastore):

            from praisonaiui.features.chat import _run_and_broadcast
            await _run_and_broadcast(
                content="Hello world",
                session_id="s-no-att",
                agent_name=None,
                attachment_ids=None,
            )

        assert captured["content"] == "Hello world"

    @pytest.mark.asyncio
    async def test_missing_attachment_id_skipped(self):
        """If attachment_id not found in registry, it's silently skipped."""
        captured = {}
        mock_provider = _make_mock_provider(captured)
        mock_datastore = AsyncMock()
        mock_datastore.add_message = AsyncMock()

        with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
             patch("praisonaiui.server._datastore", mock_datastore):

            from praisonaiui.features.chat import _run_and_broadcast
            await _run_and_broadcast(
                content="Hello",
                session_id="s-bad-id",
                agent_name=None,
                attachment_ids=["nonexistent-id-12345"],
            )

        # Content should be unchanged since the attachment was not found
        assert captured["content"] == "Hello"


# ═══════════════════════════════════════════════════════════════════
# Integration: HTTP API upload + send with attachment_ids
# ═══════════════════════════════════════════════════════════════════

class TestHTTPAttachmentFlow:
    """Verify the HTTP API endpoints correctly wire attachment_ids."""

    def test_upload_pdf_via_api(self):
        """POST /api/chat/attachments returns valid metadata."""
        from praisonaiui.server import create_app
        from starlette.testclient import TestClient

        app = create_app()
        client = TestClient(app)

        pdf_data = _make_test_pdf("API upload test")
        resp = client.post(
            "/api/chat/attachments",
            files={"file": ("test.pdf", pdf_data, "application/pdf")},
            data={"session_id": "api-test"},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert body["content_type"] == "application/pdf"
        assert body["filename"] == "test.pdf"

    def test_chat_send_accepts_attachment_ids(self):
        """POST /api/chat/send accepts attachment_ids field."""
        from praisonaiui.server import create_app
        from starlette.testclient import TestClient

        app = create_app()
        client = TestClient(app)

        # Upload first
        pdf_data = _make_test_pdf("Send test")
        upload_resp = client.post(
            "/api/chat/attachments",
            files={"file": ("doc.pdf", pdf_data, "application/pdf")},
            data={"session_id": "send-test"},
        )
        att_id = upload_resp.json()["id"]

        # Send chat with attachment_ids
        resp = client.post(
            "/api/chat/send",
            json={
                "content": "Summarize the PDF",
                "session_id": "send-test",
                "attachment_ids": [att_id],
            },
        )

        assert resp.status_code == 200
        body = resp.json()
        assert "message_id" in body
        assert body["session_id"] == "send-test"

    @pytest.mark.asyncio
    async def test_text_file_attachment_extraction(self):
        """Verify non-PDF text files are also extracted and prepended."""
        from praisonaiui.features.attachments import get_attachment_manager

        mgr = get_attachment_manager()
        text_data = b"This is plain text content for testing."
        meta = mgr.upload(
            data=text_data,
            filename="notes.txt",
            content_type="text/plain",
            session_id="s-txt",
        )

        captured = {}
        mock_provider = _make_mock_provider(captured)
        mock_datastore = AsyncMock()
        mock_datastore.add_message = AsyncMock()

        with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
             patch("praisonaiui.server._datastore", mock_datastore):

            from praisonaiui.features.chat import _run_and_broadcast
            await _run_and_broadcast(
                content="What's in the file?",
                session_id="s-txt",
                agent_name=None,
                attachment_ids=[meta["id"]],
            )

        assert "This is plain text content for testing." in captured["content"]
        assert "--- Attached File: notes.txt ---" in captured["content"]

        mgr.delete(meta["id"])
