"""Tests for the in-rail session search in the chat view (issue #324).

The chat sidebar must expose a search input that filters the already
fetched session list client-side, without refetching from the API.
"""

from pathlib import Path

CHAT = Path("src/praisonaiui/templates/frontend/plugins/views/chat.js")


class TestChatSessionRailSearch:
    def test_search_input_rendered_in_rail(self):
        src = CHAT.read_text()
        assert 'id="chat-session-search"' in src
        assert src.index('id="chat-session-search"') < src.index('id="chat-sessions-list"')

    def test_input_wired_to_client_side_render(self):
        src = CHAT.read_text()
        assert "sessionSearch.addEventListener('input', renderSessionList)" in src

    def test_load_sessions_caches_and_delegates_render(self):
        src = CHAT.read_text()
        assert "allSessions = data.sessions || data || [];" in src
        body = src.split("async function loadSessions()", 1)[1].split("\n}\n", 1)[0]
        assert "renderSessionList();" in body

    def test_filter_matches_title_and_id_fields(self):
        src = CHAT.read_text()
        assert "function _sessionMatches(s, q)" in src
        assert "No matching sessions" in src
