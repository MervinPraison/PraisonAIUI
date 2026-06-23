"""Health status utilities for consistent health checking across AIUI."""

from typing import Optional

SUCCESS_STATUSES = frozenset({"ok", "healthy"})

def is_success_status(status: Optional[str]) -> bool:
    """Check if a health status indicates success.

    Args:
        status: The health status string to check

    Returns:
        True if status is 'ok' or 'healthy', False otherwise
    """
    return (status or "") in SUCCESS_STATUSES
