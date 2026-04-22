"""Test references (RAG citations) protocol and helper functions."""

from dataclasses import asdict

from praisonaiui.provider import RunEventType


def test_reference_dataclass():
    """Test Reference dataclass schema and serialization."""
    from praisonaiui.provider import Reference

    # Create with all fields
    ref = Reference(
        name="example.txt",
        content="This is sample content from a document.",
        chunk=1,
        chunk_size=500
    )

    assert ref.name == "example.txt"
    assert ref.content == "This is sample content from a document."
    assert ref.chunk == 1
    assert ref.chunk_size == 500

    # Test serialization
    ref_dict = asdict(ref)
    assert ref_dict == {
        "name": "example.txt",
        "content": "This is sample content from a document.",
        "chunk": 1,
        "chunk_size": 500
    }


def test_reference_dataclass_defaults():
    """Test Reference dataclass with default values."""
    from praisonaiui.provider import Reference

    # Create with minimal fields, test defaults
    ref = Reference(
        name="doc.pdf",
        content="Some content"
    )

    assert ref.name == "doc.pdf"
    assert ref.content == "Some content"
    assert ref.chunk == 0
    assert ref.chunk_size == 0


def test_reference_data_dataclass():
    """Test ReferenceData dataclass schema and serialization."""
    from praisonaiui.provider import Reference, ReferenceData

    refs = [
        Reference("file1.txt", "First chunk content", chunk=0, chunk_size=300),
        Reference("file2.txt", "Second chunk content", chunk=1, chunk_size=400)
    ]

    ref_data = ReferenceData(
        query="What is machine learning?",
        references=refs,
        time_ms=150.5
    )

    assert ref_data.query == "What is machine learning?"
    assert len(ref_data.references) == 2
    assert ref_data.time_ms == 150.5

    # Test serialization
    ref_data_dict = asdict(ref_data)
    assert ref_data_dict["query"] == "What is machine learning?"
    assert len(ref_data_dict["references"]) == 2
    assert ref_data_dict["time_ms"] == 150.5


def test_reference_data_dataclass_defaults():
    """Test ReferenceData dataclass with default time_ms."""
    from praisonaiui.provider import Reference, ReferenceData

    refs = [Reference("test.txt", "Test content")]
    ref_data = ReferenceData(
        query="test query",
        references=refs
    )

    assert ref_data.query == "test query"
    assert len(ref_data.references) == 1
    assert ref_data.time_ms is None


def test_references_event_type():
    """Test that REFERENCES is added to RunEventType enum."""
    assert hasattr(RunEventType, "REFERENCES")
    assert RunEventType.REFERENCES == "references"


def test_emit_references_helper():
    """Test emit_references helper method on BaseProvider."""
    from praisonaiui.provider import BaseProvider, Reference

    class TestProvider(BaseProvider):
        async def run(self, message, **kwargs):
            yield  # pragma: no cover

    provider = TestProvider()

    # Test that emit_references method exists
    assert hasattr(provider, "emit_references")

    # Test emit_references returns proper RunEvent
    refs = [Reference("test.txt", "Test content", chunk=0, chunk_size=100)]

    import asyncio
    async def test_emit():
        event = await provider.emit_references(
            query="test query",
            references=refs,
            time_ms=123.4
        )

        assert event.type == RunEventType.REFERENCES
        assert event.extra_data is not None
        assert event.extra_data["query"] == "test query"
        assert len(event.extra_data["references"]) == 1
        assert event.extra_data["time_ms"] == 123.4

        # Check reference serialization in event
        ref_dict = event.extra_data["references"][0]
        assert ref_dict["name"] == "test.txt"
        assert ref_dict["content"] == "Test content"
        assert ref_dict["chunk"] == 0
        assert ref_dict["chunk_size"] == 100

    asyncio.run(test_emit())


def test_emit_references_without_time():
    """Test emit_references helper method without time_ms."""
    from praisonaiui.provider import BaseProvider, Reference

    class TestProvider(BaseProvider):
        async def run(self, message, **kwargs):
            yield  # pragma: no cover

    provider = TestProvider()
    refs = [Reference("doc.txt", "Document content")]

    import asyncio
    async def test_emit():
        event = await provider.emit_references(
            query="another query",
            references=refs
        )

        assert event.type == RunEventType.REFERENCES
        assert event.extra_data["query"] == "another query"
        assert event.extra_data["time_ms"] is None

    asyncio.run(test_emit())
