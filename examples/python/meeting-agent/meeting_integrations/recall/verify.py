"""Verify incoming Recall webhook and callback requests."""

from __future__ import annotations

import base64
import hmac
import hashlib


class VerificationError(ValueError):
    """Signature verification failed."""


def verify_request_from_recall(
    *,
    secret: str,
    headers: dict[str, str],
    payload: str | None,
) -> None:
    """Verify Recall/Svix-style webhook signatures on the raw request body."""
    if not secret or not secret.startswith("whsec_"):
        raise VerificationError("Verification secret is missing or invalid")

    lowered = {k.lower(): v for k, v in headers.items()}
    msg_id = lowered.get("webhook-id") or lowered.get("svix-id")
    msg_timestamp = lowered.get("webhook-timestamp") or lowered.get("svix-timestamp")
    msg_signature = lowered.get("webhook-signature") or lowered.get("svix-signature")

    if not msg_id or not msg_timestamp or not msg_signature:
        raise VerificationError("Missing webhook id, timestamp, or signature")

    key = base64.b64decode(secret.removeprefix("whsec_"))
    payload_str = payload or ""
    to_sign = f"{msg_id}.{msg_timestamp}.{payload_str}"
    expected_sig = base64.b64encode(
        hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii")

    for versioned_sig in msg_signature.split(" "):
        if "," not in versioned_sig:
            continue
        version, signature = versioned_sig.split(",", 1)
        if version != "v1":
            continue
        if hmac.compare_digest(signature, expected_sig):
            return

    raise VerificationError("No matching signature found")
