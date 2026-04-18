"""OAuth2 providers for PraisonAIUI authentication."""

from __future__ import annotations

import os
import secrets
import urllib.parse
from abc import ABC, abstractmethod
from typing import Any, Optional

import httpx
from starlette.responses import RedirectResponse


class OAuthProvider(ABC):
    """Base OAuth2 provider."""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    @abstractmethod
    def get_authorize_url(self, state: str) -> str:
        """Get the OAuth authorization URL."""
        ...

    @abstractmethod
    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        """Exchange authorization code for access token."""
        ...

    @abstractmethod
    async def get_user_info(self, token: dict[str, Any]) -> dict[str, Any]:
        """Get user info from the provider API."""
        ...

    @property
    @abstractmethod
    def scopes(self) -> list[str]:
        """Default scopes for this provider."""
        ...

    def create_authorize_response(self, state: str) -> RedirectResponse:
        """Create a redirect response to the OAuth authorization URL."""
        url = self.get_authorize_url(state)
        return RedirectResponse(url=url, status_code=302)


class GitHubProvider(OAuthProvider):
    """GitHub OAuth2 provider."""

    @property
    def scopes(self) -> list[str]:
        return ["user:email"]

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scopes),
            "state": state,
            "response_type": "code",
        }
        return f"https://github.com/login/oauth/authorize?{urllib.parse.urlencode(params)}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://github.com/login/oauth/access_token",
                data=data,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, token: dict[str, Any]) -> dict[str, Any]:
        access_token = token["access_token"]
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/user",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()


class GoogleProvider(OAuthProvider):
    """Google OAuth2 provider."""

    @property
    def scopes(self) -> list[str]:
        return ["openid", "email", "profile"]

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scopes),
            "state": state,
            "response_type": "code",
            "access_type": "offline",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data=data,
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, token: dict[str, Any]) -> dict[str, Any]:
        access_token = token["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()


class AzureADProvider(OAuthProvider):
    """Azure Active Directory OAuth2 provider."""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, tenant_id: str = "common"):
        super().__init__(client_id, client_secret, redirect_uri)
        self.tenant_id = tenant_id

    @property
    def scopes(self) -> list[str]:
        return ["openid", "profile", "email"]

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scopes),
            "state": state,
            "response_type": "code",
        }
        return f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scopes),
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token",
                data=data,
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, token: dict[str, Any]) -> dict[str, Any]:
        access_token = token["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()


class OktaProvider(OAuthProvider):
    """Okta OAuth2 provider."""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, domain: str):
        super().__init__(client_id, client_secret, redirect_uri)
        self.domain = domain.rstrip("/")

    @property
    def scopes(self) -> list[str]:
        return ["openid", "profile", "email"]

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scopes),
            "state": state,
            "response_type": "code",
        }
        return f"{self.domain}/oauth2/v1/authorize?{urllib.parse.urlencode(params)}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.domain}/oauth2/v1/token",
                data=data,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, token: dict[str, Any]) -> dict[str, Any]:
        access_token = token["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.domain}/oauth2/v1/userinfo",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()


# ── Provider Factory ────────────────────────────────────────────────────

def create_oauth_provider(
    provider_name: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    **kwargs: Any,
) -> OAuthProvider:
    """Create an OAuth provider instance from configuration.
    
    Args:
        provider_name: Name of the provider ("github", "google", "azure", "okta")
        client_id: OAuth client ID
        client_secret: OAuth client secret
        redirect_uri: OAuth redirect URI
        **kwargs: Provider-specific configuration
        
    Returns:
        OAuthProvider instance
        
    Raises:
        ValueError: If provider_name is not supported
    """
    if provider_name == "github":
        return GitHubProvider(client_id, client_secret, redirect_uri)
    elif provider_name == "google":
        return GoogleProvider(client_id, client_secret, redirect_uri)
    elif provider_name == "azure":
        tenant_id = kwargs.get("tenant_id", "common")
        return AzureADProvider(client_id, client_secret, redirect_uri, tenant_id)
    elif provider_name == "okta":
        domain = kwargs.get("domain")
        if not domain:
            raise ValueError("Okta provider requires 'domain' parameter")
        return OktaProvider(client_id, client_secret, redirect_uri, domain)
    else:
        raise ValueError(f"Unsupported OAuth provider: {provider_name}")


def get_oauth_config_from_env(provider_name: str) -> Optional[dict[str, str]]:
    """Get OAuth configuration from environment variables.
    
    Expected environment variables:
    - AIUI_OAUTH_{PROVIDER}_CLIENT_ID
    - AIUI_OAUTH_{PROVIDER}_CLIENT_SECRET
    - AIUI_OAUTH_{PROVIDER}_REDIRECT_URI (optional, defaults to auto-generated)
    
    Additional provider-specific env vars:
    - AIUI_OAUTH_AZURE_TENANT_ID (for Azure AD)
    - AIUI_OAUTH_OKTA_DOMAIN (for Okta)
    
    Args:
        provider_name: Name of the provider ("github", "google", "azure", "okta")
        
    Returns:
        Dict with OAuth config or None if not configured
    """
    provider_upper = provider_name.upper()
    client_id = os.environ.get(f"AIUI_OAUTH_{provider_upper}_CLIENT_ID")
    client_secret = os.environ.get(f"AIUI_OAUTH_{provider_upper}_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        return None
    
    config = {
        "client_id": client_id,
        "client_secret": client_secret,
    }
    
    # Optional redirect URI (auto-generated if not provided)
    redirect_uri = os.environ.get(f"AIUI_OAUTH_{provider_upper}_REDIRECT_URI")
    if redirect_uri:
        config["redirect_uri"] = redirect_uri
    
    # Provider-specific config
    if provider_name == "azure":
        tenant_id = os.environ.get("AIUI_OAUTH_AZURE_TENANT_ID", "common")
        config["tenant_id"] = tenant_id
    elif provider_name == "okta":
        domain = os.environ.get("AIUI_OAUTH_OKTA_DOMAIN")
        if domain:
            config["domain"] = domain
    
    return config


# ── OAuth State Management ──────────────────────────────────────────────

_oauth_states: dict[str, dict[str, Any]] = {}


def create_oauth_state(provider: str, return_url: str = "/") -> str:
    """Create a new OAuth state token.
    
    Args:
        provider: OAuth provider name
        return_url: URL to redirect to after successful authentication
        
    Returns:
        State token string
    """
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "provider": provider,
        "return_url": return_url,
        "created_at": os.times().system,  # Use system time for expiry
    }
    return state


def validate_oauth_state(state: str) -> Optional[dict[str, Any]]:
    """Validate and consume an OAuth state token.
    
    Args:
        state: State token to validate
        
    Returns:
        State data if valid, None if invalid/expired
    """
    if state not in _oauth_states:
        return None
    
    state_data = _oauth_states.pop(state)  # Consume state (one-time use)
    
    # Check expiry (10 minutes)
    current_time = os.times().system
    if current_time - state_data["created_at"] > 600:
        return None
    
    return state_data


def cleanup_expired_states() -> None:
    """Clean up expired OAuth states (called periodically)."""
    current_time = os.times().system
    expired_states = [
        state for state, data in _oauth_states.items()
        if current_time - data["created_at"] > 600
    ]
    for state in expired_states:
        _oauth_states.pop(state, None)