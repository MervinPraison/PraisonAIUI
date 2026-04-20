"""Tests for OAuth authentication functionality."""

import os
from unittest.mock import AsyncMock, Mock, patch
import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.auth import User, oauth_callback, _oauth_callbacks
from praisonaiui.oauth_providers import (
    GitHubProvider,
    GoogleProvider,
    AzureADProvider,
    OktaProvider,
    create_oauth_provider,
    get_oauth_config_from_env,
    create_oauth_state,
    validate_oauth_state,
)


class TestOAuthProviders:
    """Test OAuth provider implementations."""

    def test_github_provider(self):
        """Test GitHub provider URLs and configuration."""
        provider = GitHubProvider(
            client_id="test_client_id",
            client_secret="test_secret",
            redirect_uri="http://localhost:8000/auth/callback"
        )
        
        assert provider.scopes == ["user:email"]
        
        state = "test_state_123"
        auth_url = provider.get_authorize_url(state)
        
        assert "github.com/login/oauth/authorize" in auth_url
        assert "client_id=test_client_id" in auth_url
        assert f"state={state}" in auth_url
        assert "scope=user%3Aemail" in auth_url

    def test_google_provider(self):
        """Test Google provider URLs and configuration."""
        provider = GoogleProvider(
            client_id="test_client_id",
            client_secret="test_secret", 
            redirect_uri="http://localhost:8000/auth/callback"
        )
        
        assert provider.scopes == ["openid", "email", "profile"]
        
        state = "test_state_456"
        auth_url = provider.get_authorize_url(state)
        
        assert "accounts.google.com/o/oauth2/v2/auth" in auth_url
        assert "client_id=test_client_id" in auth_url
        assert f"state={state}" in auth_url

    def test_azure_provider(self):
        """Test Azure AD provider URLs and configuration."""
        provider = AzureADProvider(
            client_id="test_client_id",
            client_secret="test_secret",
            redirect_uri="http://localhost:8000/auth/callback",
            tenant_id="common"
        )
        
        assert provider.scopes == ["openid", "profile", "email"]
        
        state = "test_state_789"
        auth_url = provider.get_authorize_url(state)
        
        assert "login.microsoftonline.com/common/oauth2/v2.0/authorize" in auth_url
        assert "client_id=test_client_id" in auth_url
        assert f"state={state}" in auth_url

    def test_okta_provider(self):
        """Test Okta provider URLs and configuration."""
        provider = OktaProvider(
            client_id="test_client_id",
            client_secret="test_secret",
            redirect_uri="http://localhost:8000/auth/callback",
            domain="https://dev-123456.okta.com"
        )
        
        assert provider.scopes == ["openid", "profile", "email"]
        
        state = "test_state_okta"
        auth_url = provider.get_authorize_url(state)
        
        assert "dev-123456.okta.com/oauth2/v1/authorize" in auth_url
        assert "client_id=test_client_id" in auth_url
        assert f"state={state}" in auth_url

    def test_provider_factory(self):
        """Test OAuth provider factory."""
        # Test GitHub
        provider = create_oauth_provider(
            "github", "client_id", "secret", "redirect_uri"
        )
        assert isinstance(provider, GitHubProvider)
        
        # Test Google
        provider = create_oauth_provider(
            "google", "client_id", "secret", "redirect_uri" 
        )
        assert isinstance(provider, GoogleProvider)
        
        # Test Azure
        provider = create_oauth_provider(
            "azure", "client_id", "secret", "redirect_uri", tenant_id="test"
        )
        assert isinstance(provider, AzureADProvider)
        
        # Test Okta
        provider = create_oauth_provider(
            "okta", "client_id", "secret", "redirect_uri", domain="https://test.okta.com"
        )
        assert isinstance(provider, OktaProvider)
        
        # Test unknown provider
        with pytest.raises(ValueError, match="Unsupported OAuth provider"):
            create_oauth_provider("unknown", "client_id", "secret", "redirect_uri")


class TestOAuthEnvironmentConfig:
    """Test OAuth configuration from environment variables."""

    def test_get_github_config_from_env(self):
        """Test GitHub configuration from environment."""
        with patch.dict(os.environ, {
            "AIUI_OAUTH_GITHUB_CLIENT_ID": "gh_client_123",
            "AIUI_OAUTH_GITHUB_CLIENT_SECRET": "gh_secret_456",
            "AIUI_OAUTH_GITHUB_REDIRECT_URI": "http://localhost:8000/callback"
        }):
            config = get_oauth_config_from_env("github")
            assert config == {
                "client_id": "gh_client_123", 
                "client_secret": "gh_secret_456",
                "redirect_uri": "http://localhost:8000/callback"
            }

    def test_get_azure_config_from_env(self):
        """Test Azure configuration from environment."""
        with patch.dict(os.environ, {
            "AIUI_OAUTH_AZURE_CLIENT_ID": "az_client_123",
            "AIUI_OAUTH_AZURE_CLIENT_SECRET": "az_secret_456",
            "AIUI_OAUTH_AZURE_TENANT_ID": "my-tenant"
        }):
            config = get_oauth_config_from_env("azure")
            assert config == {
                "client_id": "az_client_123",
                "client_secret": "az_secret_456",
                "tenant_id": "my-tenant"
            }

    def test_get_missing_config_from_env(self):
        """Test behavior when OAuth config is missing."""
        with patch.dict(os.environ, {}, clear=True):
            config = get_oauth_config_from_env("github")
            assert config is None


class TestOAuthStateManagement:
    """Test OAuth state token management."""

    def test_create_and_validate_state(self):
        """Test state creation and validation."""
        state = create_oauth_state("github", "/dashboard")
        assert len(state) > 0
        
        state_data = validate_oauth_state(state)
        assert state_data is not None
        assert state_data["provider"] == "github"
        assert state_data["return_url"] == "/dashboard"
        
        # State should be consumed after validation
        state_data_again = validate_oauth_state(state)
        assert state_data_again is None

    def test_validate_invalid_state(self):
        """Test validation of invalid state."""
        invalid_state = "invalid_state_token"
        state_data = validate_oauth_state(invalid_state)
        assert state_data is None


class TestOAuthCallbacks:
    """Test OAuth callback functionality."""

    def test_oauth_callback_decorator(self):
        """Test OAuth callback decorator registration."""
        # Clear existing callbacks
        _oauth_callbacks.clear()
        
        @oauth_callback("github")
        async def handle_github_oauth(provider, token, raw_user, default_user):
            return User(
                identifier=f"github:{raw_user['login']}",
                display_name=raw_user["name"],
                metadata={"login": raw_user["login"]}
            )
        
        assert "github" in _oauth_callbacks
        assert _oauth_callbacks["github"] == handle_github_oauth

    def test_oauth_callback_deny(self):
        """Test OAuth callback that denies authentication."""
        # Clear existing callbacks
        _oauth_callbacks.clear()
        
        @oauth_callback("google")
        async def handle_google_oauth(provider, token, raw_user, default_user):
            # Deny authentication for test
            return None
        
        assert "google" in _oauth_callbacks
        callback = _oauth_callbacks["google"]
        
        # Mock data
        token_data = {"access_token": "test_token"}
        user_info = {"id": "123", "email": "test@example.com"}
        default_user = User(identifier="google:123", display_name="Test User")
        
        # Test that callback returns None (denies auth)
        import asyncio
        result = asyncio.run(callback("google", token_data, user_info, default_user))
        assert result is None


@pytest.mark.asyncio
class TestOAuthIntegration:
    """Test OAuth integration with server routes."""

    @patch('praisonaiui.oauth_providers.get_http_client')
    async def test_github_oauth_round_trip(self, mock_get_client):
        """Test complete GitHub OAuth flow."""
        from praisonaiui.server import create_app
        
        # Clear existing callbacks to avoid interference from other tests
        _oauth_callbacks.clear()
        
        # Register a mock OAuth callback for this test
        @oauth_callback("github")
        async def test_github_callback(provider, token, raw_user, default_user):
            return User(
                identifier=f"github:{raw_user['login']}",
                display_name=raw_user["name"],
                metadata={"login": raw_user["login"]}
            )
        
        # Mock OAuth provider responses
        mock_response = Mock()
        mock_response.json.return_value = {"access_token": "github_token_123"}
        mock_response.raise_for_status.return_value = None
        
        mock_user_response = Mock()
        mock_user_response.json.return_value = {
            "login": "testuser",
            "name": "Test User",
            "avatar_url": "https://github.com/testuser.png"
        }
        mock_user_response.raise_for_status.return_value = None
        
        mock_client_instance = AsyncMock()
        mock_client_instance.post.return_value = mock_response
        mock_client_instance.get.return_value = mock_user_response
        mock_get_client.return_value = mock_client_instance
        
        # Set up OAuth config
        with patch.dict(os.environ, {
            "AIUI_OAUTH_GITHUB_CLIENT_ID": "test_client",
            "AIUI_OAUTH_GITHUB_CLIENT_SECRET": "test_secret"
        }):
            app = create_app()
            client = TestClient(app)
            
            # Test authorization redirect
            response = client.get("/api/auth/oauth/github", follow_redirects=False)
            assert response.status_code == 302
            assert "github.com/login/oauth/authorize" in response.headers["location"]
            
            # Extract state from redirect URL
            location = response.headers["location"]
            state = location.split("state=")[1].split("&")[0] if "state=" in location else "test_state"
            
            # Test callback
            with patch('praisonaiui.oauth_providers.validate_oauth_state') as mock_validate:
                mock_validate.return_value = {"provider": "github", "return_url": "/"}
                
                callback_response = client.get(
                    f"/api/auth/oauth/github/callback?code=test_code&state={state}",
                    headers={"Accept": "application/json"}
                )
                
                if callback_response.status_code != 200:
                    print(f"Callback error: {callback_response.status_code}")
                    print(f"Callback response: {callback_response.content}")
                
                assert callback_response.status_code == 200
                data = callback_response.json()
                assert "user" in data
                assert "token" in data
                assert data["user"]["identifier"] == "github:testuser"

    async def test_oauth_callback_with_custom_handler(self):
        """Test OAuth callback with custom user handler."""
        # Clear existing callbacks
        _oauth_callbacks.clear()
        
        @oauth_callback("github")
        async def custom_github_handler(provider, token, raw_user, default_user):
            # Custom logic - only allow specific users
            if raw_user["login"] == "allowed_user":
                return User(
                    identifier=f"custom:{raw_user['login']}",
                    display_name=f"Custom {raw_user['name']}",
                    metadata={"custom": True}
                )
            return None  # Deny other users
        
        # Test allowed user
        token_data = {"access_token": "test"}
        user_info = {"login": "allowed_user", "name": "Allowed User"}
        default_user = User(identifier="github:allowed_user", display_name="Allowed User")
        
        result = await custom_github_handler("github", token_data, user_info, default_user)
        assert result is not None
        assert result.identifier == "custom:allowed_user"
        assert result.display_name == "Custom Allowed User"
        assert result.metadata["custom"] is True
        
        # Test denied user
        user_info = {"login": "denied_user", "name": "Denied User"}
        default_user = User(identifier="github:denied_user", display_name="Denied User")
        
        result = await custom_github_handler("github", token_data, user_info, default_user)
        assert result is None