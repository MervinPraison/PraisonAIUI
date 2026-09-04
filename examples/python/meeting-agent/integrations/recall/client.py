"""Minimal Recall.ai REST client (EU region, v1.11)."""

from __future__ import annotations

import json
import logging
import random
import time
from typing import Any

import httpx

from integrations.recall.config import RecallSettings

logger = logging.getLogger(__name__)


class RecallAPIError(RuntimeError):
    """Recall API returned a non-success response."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class RecallClient:
    """HTTP client for Recall Meeting Bots and async transcription."""

    def __init__(self, settings: RecallSettings):
        self._settings = settings
        self._base = settings.api_base.rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": self._settings.api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        max_attempts: int = 4,
    ) -> dict[str, Any]:
        url = f"{self._base}{path}"
        last_error: Exception | None = None
        for attempt in range(max_attempts):
            try:
                with httpx.Client(timeout=30.0) as client:
                    response = client.request(
                        method,
                        url,
                        headers=self._headers(),
                        json=json_body,
                    )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt + 1 >= max_attempts:
                    raise RecallAPIError(0, str(exc)) from exc
                time.sleep(min(2**attempt + random.random(), 8))
                continue

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else min(2**attempt, 30)
                time.sleep(delay + random.random())
                continue

            if response.status_code in {503, 507} and attempt + 1 < max_attempts:
                time.sleep(min(2**attempt + random.random(), 8))
                continue

            if response.status_code >= 400:
                detail = response.text[:500] or response.reason_phrase
                raise RecallAPIError(response.status_code, detail)

            if not response.content:
                return {}
            return response.json()

        raise RecallAPIError(0, str(last_error or "request failed"))

    def create_bot(
        self,
        *,
        meeting_url: str,
        meeting_id: str,
        title: str,
        join_at: str | None = None,
    ) -> dict[str, Any]:
        """Schedule a Recall bot; attach local meeting_id in metadata for webhook routing."""
        body: dict[str, Any] = {
            "meeting_url": meeting_url,
            "bot_name": self._settings.bot_name,
            "metadata": {"meeting_id": meeting_id, "title": title},
        }
        if join_at:
            body["join_at"] = join_at
        logger.info(
            "Creating Recall bot for meeting_id=%s (url redacted)",
            meeting_id,
        )
        return self._request("POST", "/api/v1/bot/", json_body=body)

    def get_bot(self, bot_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/bot/{bot_id}/")

    def cancel_bot(self, bot_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/bot/{bot_id}/leave_call/")

    def create_async_transcript(self, recording_id: str) -> dict[str, Any]:
        body = {
            "provider": {"recallai_async": {"language_code": "auto"}},
            "diarization": {"use_separate_streams_when_available": True},
        }
        return self._request(
            "POST",
            f"/api/v1/recording/{recording_id}/create_transcript/",
            json_body=body,
        )

    def get_transcript(self, transcript_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/transcript/{transcript_id}/")

    @staticmethod
    def extract_recording_id(payload: dict[str, Any]) -> str | None:
        data = payload.get("data") or {}
        if isinstance(data, dict):
            recording = data.get("recording") or {}
            if isinstance(recording, dict) and recording.get("id"):
                return str(recording["id"])
            inner = data.get("data") or {}
            if isinstance(inner, dict):
                rec = inner.get("recording") or {}
                if isinstance(rec, dict) and rec.get("id"):
                    return str(rec["id"])
        return None

    @staticmethod
    def extract_transcript_id(payload: dict[str, Any]) -> str | None:
        data = payload.get("data") or {}
        if isinstance(data, dict):
            transcript = data.get("transcript") or {}
            if isinstance(transcript, dict) and transcript.get("id"):
                return str(transcript["id"])
        return None

    @staticmethod
    def extract_bot_id(payload: dict[str, Any]) -> str | None:
        data = payload.get("data") or {}
        if isinstance(data, dict):
            bot = data.get("bot") or {}
            if isinstance(bot, dict) and bot.get("id"):
                return str(bot["id"])
        return None

    @staticmethod
    def extract_meeting_id_from_bot_metadata(payload: dict[str, Any]) -> str | None:
        data = payload.get("data") or {}
        if not isinstance(data, dict):
            return None
        bot = data.get("bot") or {}
        if not isinstance(bot, dict):
            return None
        metadata = bot.get("metadata") or {}
        if isinstance(metadata, dict):
            mid = metadata.get("meeting_id")
            return str(mid) if mid else None
        return None

    @staticmethod
    def download_json(url: str) -> Any:
        with httpx.Client(timeout=60.0) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.json()
