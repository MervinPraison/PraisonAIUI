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
        enable_realtime_transcription: bool = True,
    ) -> dict[str, Any]:
        """Schedule a Recall bot; attach local meeting_id in metadata for webhook routing."""
        body: dict[str, Any] = {
            "meeting_url": meeting_url,
            "bot_name": self._settings.bot_name,
            "metadata": {"meeting_id": meeting_id, "title": title},
        }
        if join_at:
            body["join_at"] = join_at
        if enable_realtime_transcription:
            recording_config = self._settings.realtime_recording_config()
            if recording_config:
                body["recording_config"] = recording_config
                logger.info(
                    "Live transcript enabled for meeting_id=%s → %s",
                    meeting_id,
                    self._settings.webhook_url,
                )
            else:
                logger.warning(
                    "Live transcript skipped for meeting_id=%s — set PUBLIC_API_BASE_URL",
                    meeting_id,
                )
        logger.info(
            "Creating Recall bot for meeting_id=%s (url redacted)",
            meeting_id,
        )
        return self._request("POST", "/api/v1/bot/", json_body=body)

    def build_bot_config(
        self,
        *,
        meeting_id: str,
        title: str,
        enable_realtime_transcription: bool = True,
    ) -> dict[str, Any]:
        """Bot config payload for Calendar V2 schedule-bot requests."""
        config: dict[str, Any] = {
            "bot_name": self._settings.bot_name,
            "metadata": {"meeting_id": meeting_id, "title": title},
        }
        if enable_realtime_transcription:
            recording_config = self._settings.realtime_recording_config()
            if recording_config:
                config["recording_config"] = recording_config
        return config

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

    def list_calendars(self, *, status: str | None = "connected") -> list[dict[str, Any]]:
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            query = dict(params)
            if cursor:
                query["cursor"] = cursor
            path = "/api/v2/calendars/"
            if query:
                from urllib.parse import urlencode

                path = f"{path}?{urlencode(query)}"
            page = self._request("GET", path)
            batch = page.get("results") or []
            if isinstance(batch, list):
                results.extend(item for item in batch if isinstance(item, dict))
            cursor = page.get("next")
            if not cursor:
                break
        return results

    def list_calendar_events(
        self,
        *,
        calendar_id: str | None = None,
        updated_at_gte: str | None = None,
        is_deleted: bool | None = False,
    ) -> list[dict[str, Any]]:
        from urllib.parse import urlencode

        params: dict[str, str] = {}
        if calendar_id:
            params["calendar_id"] = calendar_id
        if updated_at_gte:
            params["updated_at__gte"] = updated_at_gte
        if is_deleted is not None:
            params["is_deleted"] = "true" if is_deleted else "false"

        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            query = dict(params)
            if cursor:
                query["cursor"] = cursor
            path = f"/api/v2/calendar-events/?{urlencode(query)}" if query else "/api/v2/calendar-events/"
            page = self._request("GET", path)
            batch = page.get("results") or []
            if isinstance(batch, list):
                results.extend(item for item in batch if isinstance(item, dict))
            cursor = page.get("next")
            if not cursor:
                break
        return results

    def schedule_bot_for_calendar_event(
        self,
        event_id: str,
        *,
        deduplication_key: str,
        bot_config: dict[str, Any],
    ) -> dict[str, Any]:
        body = {
            "deduplication_key": deduplication_key,
            "bot_config": bot_config,
        }
        return self._request(
            "POST",
            f"/api/v2/calendar-events/{event_id}/bot/",
            json_body=body,
        )

    def remove_bot_from_calendar_event(self, event_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/api/v2/calendar-events/{event_id}/bot/")
