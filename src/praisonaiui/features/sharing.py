"""Thread sharing functionality for PraisonAIUI."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

from praisonaiui.auth import User


class OnSharedThreadViewProtocol(Protocol):
    """Protocol for shared thread view callback."""

    async def __call__(self, thread_id: str, viewer: Optional[User]) -> bool:
        """Check if thread can be viewed by the visitor.
        
        Args:
            thread_id: Thread/session ID being accessed
            viewer: User instance if authenticated, None if anonymous
            
        Returns:
            True to allow access, False to deny
        """
        ...


# Global registry for sharing callback (lazy-loaded)
_on_shared_thread_view_callback: Optional[OnSharedThreadViewProtocol] = None

# In-memory storage for share tokens (should be replaced with database in production)
_share_tokens: dict[str, dict[str, Any]] = {}


def on_shared_thread_view(func: OnSharedThreadViewProtocol) -> OnSharedThreadViewProtocol:
    """Register a callback for shared thread view access control.
    
    Example:
        @aiui.on_shared_thread_view
        async def on_share_view(thread_id, viewer):
            # Return True to allow view, False to deny
            # Receives None for viewer if anonymous
            return True  # Or check your ACL
    """
    global _on_shared_thread_view_callback
    _on_shared_thread_view_callback = func
    return func


def create_share_token(thread_id: str, created_by: str) -> str:
    """Create a share token for a thread.
    
    Args:
        thread_id: Thread/session ID to share
        created_by: User ID who created the share token
        
    Returns:
        Opaque share token (32-byte URL-safe)
    """
    # Generate collision-resistant token
    token = secrets.token_urlsafe(32)

    _share_tokens[token] = {
        "thread_id": thread_id,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    return token


def get_thread_by_share_token(token: str) -> Optional[str]:
    """Get thread ID from share token.
    
    Args:
        token: Share token
        
    Returns:
        Thread ID if token exists, None otherwise
    """
    token_data = _share_tokens.get(token)
    return token_data["thread_id"] if token_data else None


def revoke_share_token(thread_id: str, user_id: str) -> bool:
    """Revoke share token(s) for a thread.
    
    Args:
        thread_id: Thread ID
        user_id: User who wants to revoke (must be creator)
        
    Returns:
        True if token(s) were revoked, False if none found or not authorized
    """
    revoked = False
    tokens_to_remove = []

    for token, data in _share_tokens.items():
        if data["thread_id"] == thread_id and data["created_by"] == user_id:
            tokens_to_remove.append(token)

    for token in tokens_to_remove:
        del _share_tokens[token]
        revoked = True

    return revoked


def list_share_tokens(user_id: str) -> list[dict[str, Any]]:
    """List share tokens created by a user.
    
    Args:
        user_id: User ID
        
    Returns:
        List of share token data
    """
    return [
        {
            "token": token,
            "thread_id": data["thread_id"],
            "created_at": data["created_at"],
        }
        for token, data in _share_tokens.items()
        if data["created_by"] == user_id
    ]


async def check_shared_thread_access(thread_id: str, viewer: Optional[User] = None) -> bool:
    """Check if a thread can be viewed via sharing.
    
    Args:
        thread_id: Thread ID
        viewer: User instance if authenticated, None if anonymous
        
    Returns:
        True if access allowed, False if denied
    """
    # Default to deny if no handler is registered (safe default)
    if not _on_shared_thread_view_callback:
        return False

    try:
        return await _on_shared_thread_view_callback(thread_id, viewer)
    except Exception:
        # Fail safely on callback errors
        return False


def get_share_url(token: str, base_url: str = "") -> str:
    """Generate the full share URL for a token.
    
    Args:
        token: Share token
        base_url: Base URL (e.g., "https://example.com")
        
    Returns:
        Full share URL
    """
    base_url = base_url.rstrip("/")
    return f"{base_url}/shared/{token}"
