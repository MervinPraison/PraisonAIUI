"""Lightweight in-process gateway — no praisonai wrapper needed.

When the ``praisonai`` wrapper package is not importable (e.g. Python
version mismatch), this provides a minimal gateway object that satisfies
the same API surface as ``WebSocketGateway``:

    gw.register_agent(agent, agent_id=None) -> str
    gw.unregister_agent(agent_id)
    gw.list_agents() -> list[str]
    gw.get_agent(agent_id) -> agent | None
    gw.health() -> dict
    gw._create_bot(platform, token, agent, bot_config, ch_cfg) -> bot | None
        (the WebSocketGateway signature ``channels.py`` calls; the older
        ``_create_bot(platform, config, agent)`` form still works)

This allows cron, channels, agents, and other features to work without
the full WebSocketGateway from the praisonai wrapper.
"""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# Pluggable bot factory registry
_bot_factories: Dict[str, Callable] = {}


def register_bot_factory(platform: str, factory: Callable) -> None:
    """Register a custom bot factory for a platform.

    Args:
        platform: Platform name (e.g., "telegram", "discord")
        factory: Callable(agent, **config) -> bot instance
    """
    _bot_factories[platform] = factory


class StandaloneGateway:
    """Minimal gateway that stores agents in-process."""

    def __init__(self) -> None:
        self._agents: Dict[str, Any] = {}
        self._channel_bots: Dict[str, Any] = {}
        self._lock = threading.Lock()

    # -- Agent registry --------------------------------------------------

    def register_agent(
        self,
        agent: Any,
        agent_id: Optional[str] = None,
        **kwargs,
    ) -> str:
        """Register an agent. Matches WebSocketGateway.register_agent API."""
        aid = agent_id or getattr(agent, "name", None) or str(uuid.uuid4())
        with self._lock:
            self._agents[aid] = agent
            logger.debug("StandaloneGateway: registered agent '%s'", aid)
        return aid

    def unregister_agent(self, agent_id: str) -> None:
        with self._lock:
            self._agents.pop(agent_id, None)

    def list_agents(self) -> List[str]:
        with self._lock:
            return list(self._agents.keys())

    def get_agent(self, agent_id: str) -> Optional[Any]:
        with self._lock:
            return self._agents.get(agent_id)

    # -- Health -----------------------------------------------------------

    def health(self) -> dict:
        return {
            "type": "StandaloneGateway",
            "agents": len(self._agents),
            "bots": len(self._channel_bots),
        }

    # -- Bot creation (channel feature) -----------------------------------

    def _create_bot(self, platform: str, *args: Any) -> Optional[Any]:
        """Try to create a platform bot using pluggable registry or fallback imports.

        Accepts the ``WebSocketGateway`` signature that ``channels.py`` uses,
        ``(platform, token, agent, bot_config, ch_cfg)``, and the older
        ``(platform, config, agent)`` form. Both become one keyword set for the
        bot constructor: ``token=``, ``agent=``, ``config=`` (when a bot config
        is given) plus the channel's extra keys (``app_token``, ...).
        """
        if len(args) == 4:
            token, agent, bot_config, ch_cfg = args
            config: Dict[str, Any] = {
                k: v for k, v in dict(ch_cfg or {}).items() if k != "token"
            }
            config["token"] = token
            if bot_config is not None:
                config["config"] = bot_config
        elif len(args) == 2:
            config, agent = args
            config = dict(config or {})
        else:
            raise TypeError(
                "_create_bot() takes (platform, token, agent, bot_config, ch_cfg) "
                f"or (platform, config, agent); got {1 + len(args)} arguments"
            )
        bot = None

        # Strategy 0: Check pluggable registry first
        if platform in _bot_factories:
            try:
                bot = _bot_factories[platform](agent=agent, **config)
            except Exception:
                pass

        # Strategy 1: praisonai wrapper (has TelegramBot, DiscordBot, etc.)
        if bot is None:
            try:
                mod = __import__(
                    f"praisonai.bots.{platform}",
                    fromlist=[f"{platform.title()}Bot"],
                )
                bot_cls = getattr(mod, f"{platform.title()}Bot", None)
                if bot_cls:
                    bot = bot_cls(agent=agent, **config)
            except (ImportError, Exception):
                pass

        # Strategy 2: praisonaiagents bots
        if bot is None:
            try:
                mod = __import__(
                    f"praisonaiagents.bots.{platform}",
                    fromlist=[f"{platform.title()}Bot"],
                )
                bot_cls = getattr(mod, f"{platform.title()}Bot", None)
                if bot_cls:
                    bot = bot_cls(agent=agent, **config)
            except (ImportError, Exception):
                pass

        if bot is not None:
            with self._lock:
                self._channel_bots[f"{platform}_{id(bot)}"] = bot

        return bot
