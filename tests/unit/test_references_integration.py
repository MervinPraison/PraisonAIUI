"""Integration tests for references (RAG citations) end-to-end flow."""

import asyncio
import json

from praisonaiui.provider import BaseProvider, Reference, RunEvent, RunEventType


class MockReferencesProvider(BaseProvider):
    """Test provider that emits references."""

    async def run(self, message, **kwargs):
        # Simulate RAG retrieval and citation
        yield RunEvent(type=RunEventType.RUN_STARTED)

        # Emit some content
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="Based on the retrieved documents:\n\n")

        # Emit references
        refs = [
            Reference("doc1.txt", "This is the first relevant chunk.", chunk=0, chunk_size=250),
            Reference("doc2.pdf", "This is another relevant piece of information.", chunk=2, chunk_size=300),
        ]

        ref_event = await self.emit_references(
            query="What is the answer?",
            references=refs,
            time_ms=150.5
        )
        yield ref_event

        # Continue with content
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="The answer is based on multiple sources.")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Based on the retrieved documents:\n\nThe answer is based on multiple sources.")


def test_mock_provider_emits_references():
    """Test that the mock provider can emit references events."""
    provider = MockReferencesProvider()

    async def run_test():
        events = []
        async for event in provider.run("test message"):
            events.append(event)

        # Should have: RUN_STARTED, RUN_CONTENT (1), REFERENCES, RUN_CONTENT (2), RUN_COMPLETED
        assert len(events) == 5

        # Check references event
        ref_event = events[2]
        assert ref_event.type == RunEventType.REFERENCES
        assert ref_event.extra_data is not None
        assert ref_event.extra_data["query"] == "What is the answer?"
        assert len(ref_event.extra_data["references"]) == 2
        assert ref_event.extra_data["time_ms"] == 150.5

        # Check reference data
        ref1 = ref_event.extra_data["references"][0]
        assert ref1["name"] == "doc1.txt"
        assert ref1["content"] == "This is the first relevant chunk."
        assert ref1["chunk"] == 0
        assert ref1["chunk_size"] == 250

        ref2 = ref_event.extra_data["references"][1]
        assert ref2["name"] == "doc2.pdf"
        assert ref2["content"] == "This is another relevant piece of information."
        assert ref2["chunk"] == 2
        assert ref2["chunk_size"] == 300

    asyncio.run(run_test())


def test_references_event_serialization():
    """Test that references events serialize correctly for SSE."""
    provider = MockReferencesProvider()

    async def run_test():
        async for event in provider.run("test"):
            if event.type == RunEventType.REFERENCES:
                # Test to_dict() serialization
                event_dict = event.to_dict()

                assert event_dict["type"] == "references"
                assert "extra_data" in event_dict
                assert event_dict["extra_data"]["query"] == "What is the answer?"
                assert len(event_dict["extra_data"]["references"]) == 2
                assert event_dict["extra_data"]["time_ms"] == 150.5

                # Test JSON serialization (what happens in SSE)
                json_str = json.dumps(event_dict)
                parsed = json.loads(json_str)

                assert parsed["type"] == "references"
                assert parsed["extra_data"]["query"] == "What is the answer?"
                break

    asyncio.run(run_test())


def test_multiple_reference_queries():
    """Test handling multiple reference queries in a single run."""

    class MultiQueryProvider(BaseProvider):
        async def run(self, message, **kwargs):
            yield RunEvent(type=RunEventType.RUN_STARTED)

            # First query
            refs1 = [Reference("file1.txt", "First chunk", chunk=0, chunk_size=100)]
            event1 = await self.emit_references("query 1", refs1, 50.0)
            yield event1

            yield RunEvent(type=RunEventType.RUN_CONTENT, token="Based on query 1... ")

            # Second query
            refs2 = [Reference("file2.txt", "Second chunk", chunk=1, chunk_size=200)]
            event2 = await self.emit_references("query 2", refs2, 75.0)
            yield event2

            yield RunEvent(type=RunEventType.RUN_CONTENT, token="and query 2.")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Based on query 1... and query 2.")

    provider = MultiQueryProvider()

    async def run_test():
        reference_events = []
        async for event in provider.run("test"):
            if event.type == RunEventType.REFERENCES:
                reference_events.append(event)

        assert len(reference_events) == 2

        # Check first references event
        assert reference_events[0].extra_data["query"] == "query 1"
        assert reference_events[0].extra_data["time_ms"] == 50.0
        assert len(reference_events[0].extra_data["references"]) == 1

        # Check second references event
        assert reference_events[1].extra_data["query"] == "query 2"
        assert reference_events[1].extra_data["time_ms"] == 75.0
        assert len(reference_events[1].extra_data["references"]) == 1

    asyncio.run(run_test())


def test_references_without_time():
    """Test references emission without time_ms."""

    class SimpleRefsProvider(BaseProvider):
        async def run(self, message, **kwargs):
            refs = [Reference("simple.txt", "Simple content")]
            event = await self.emit_references("simple query", refs)
            yield event

    provider = SimpleRefsProvider()

    async def run_test():
        async for event in provider.run("test"):
            if event.type == RunEventType.REFERENCES:
                assert event.extra_data["query"] == "simple query"
                assert event.extra_data["time_ms"] is None
                assert len(event.extra_data["references"]) == 1
                break

    asyncio.run(run_test())


def test_server_sse_forwarding_simulation():
    """Test that references events would be forwarded correctly by the server."""
    provider = MockReferencesProvider()

    async def run_test():
        # Simulate what the server does: collect events and format as SSE
        sse_events = []
        async for event in provider.run("test message"):
            # This mimics lines 2015-2016 in server.py
            event_dict = event.to_dict()
            sse_line = f"data: {json.dumps(event_dict)}\n\n"
            sse_events.append((event.type, sse_line))

        # Find the references SSE event
        ref_sse = None
        for event_type, sse_line in sse_events:
            if event_type == RunEventType.REFERENCES:
                ref_sse = sse_line
                break

        assert ref_sse is not None
        assert "data: " in ref_sse

        # Parse the SSE data
        data_part = ref_sse.replace("data: ", "").strip()
        parsed = json.loads(data_part)

        assert parsed["type"] == "references"
        assert parsed["extra_data"]["query"] == "What is the answer?"
        assert len(parsed["extra_data"]["references"]) == 2
        assert parsed["extra_data"]["time_ms"] == 150.5

        # Verify reference structure matches TypeScript interface
        ref = parsed["extra_data"]["references"][0]
        assert "name" in ref
        assert "content" in ref
        assert "chunk" in ref
        assert "chunk_size" in ref

    asyncio.run(run_test())
