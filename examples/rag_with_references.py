"""
Example: RAG with References

This example demonstrates how to emit references (RAG citations)
from a custom provider to show source chunks in the UI.
"""

import asyncio

import praisonaiui as aiui


class RAGProvider(aiui.BaseProvider):
    """A simple RAG provider that emits references."""

    def __init__(self):
        # Simulate a simple knowledge base
        self.knowledge_base = {
            "machine_learning": [
                {
                    "source": "ML_Textbook_Chapter_1.pdf",
                    "content": "Machine learning is a method of data analysis that automates analytical model building. It is a branch of artificial intelligence based on the idea that systems can learn from data, identify patterns and make decisions with minimal human intervention.",
                    "chunk_id": 0,
                    "chunk_size": 280,
                },
                {
                    "source": "AI_Research_Paper_2024.pdf",
                    "content": "Modern machine learning algorithms can be categorized into three main types: supervised learning, unsupervised learning, and reinforcement learning. Each type has distinct characteristics and applications in real-world scenarios.",
                    "chunk_id": 1,
                    "chunk_size": 245,
                },
                {
                    "source": "Data_Science_Guide.md",
                    "content": "The machine learning pipeline typically involves data collection, data preprocessing, feature engineering, model selection, training, evaluation, and deployment. Each step is crucial for building effective ML systems.",
                    "chunk_id": 0,
                    "chunk_size": 223,
                },
            ],
            "python": [
                {
                    "source": "Python_Programming_Guide.pdf",
                    "content": "Python is a high-level, interpreted programming language known for its simplicity and readability. It supports multiple programming paradigms including procedural, object-oriented, and functional programming.",
                    "chunk_id": 0,
                    "chunk_size": 210,
                },
                {
                    "source": "Python_Best_Practices.md",
                    "content": "Python follows the philosophy of 'Pythonic' code - code that is clean, readable, and follows Python's idioms. The Zen of Python emphasizes principles like 'Simple is better than complex' and 'Readability counts'.",
                    "chunk_id": 1,
                    "chunk_size": 234,
                },
            ],
        }

    def retrieve_documents(self, query: str) -> list[dict]:
        """Simulate vector similarity search."""
        query_lower = query.lower()

        # Simple keyword matching for this example
        if "machine learning" in query_lower or "ml" in query_lower:
            return self.knowledge_base["machine_learning"]
        elif "python" in query_lower:
            return self.knowledge_base["python"]
        else:
            # Return some general results
            return self.knowledge_base["machine_learning"][:2]

    async def run(self, message: str, **kwargs) -> aiui.RunEvent:
        """Run the RAG pipeline with reference emission."""

        yield aiui.RunEvent(type=aiui.RunEventType.RUN_STARTED)

        # Step 1: Retrieve relevant documents
        yield aiui.RunEvent(
            type=aiui.RunEventType.REASONING_STEP,
            step="Searching knowledge base for relevant information..."
        )

        # Simulate retrieval latency
        await asyncio.sleep(0.1)

        retrieved_docs = self.retrieve_documents(message)

        # Step 2: Emit references
        references = [
            aiui.Reference(
                name=doc["source"],
                content=doc["content"],
                chunk=doc["chunk_id"],
                chunk_size=doc["chunk_size"]
            )
            for doc in retrieved_docs
        ]

        ref_event = await self.emit_references(
            query=message,
            references=references,
            time_ms=100.0 + len(retrieved_docs) * 20  # Simulate retrieval time
        )
        yield ref_event

        # Step 3: Generate response based on retrieved documents
        yield aiui.RunEvent(
            type=aiui.RunEventType.REASONING_STEP,
            step="Generating response based on retrieved sources..."
        )

        # Simulate response generation
        await asyncio.sleep(0.2)

        # Stream the response
        response_parts = [
            "Based on the retrieved documents, here's what I found:\n\n",
            f"From {len(references)} source(s), ",
            "I can provide you with comprehensive information. ",
            "The retrieved chunks contain relevant details that directly address your question.\n\n",
            "The sources include academic papers, textbooks, and guides that provide ",
            "authoritative information on this topic. You can expand the 'Sources' section ",
            "below to see the exact chunks that were used to generate this response."
        ]

        for part in response_parts:
            yield aiui.RunEvent(type=aiui.RunEventType.RUN_CONTENT, token=part)
            await asyncio.sleep(0.05)  # Simulate streaming

        # Complete with full response
        full_response = "".join(response_parts)
        yield aiui.RunEvent(type=aiui.RunEventType.RUN_COMPLETED, content=full_response)


if __name__ == "__main__":
    # Configure the RAG provider
    aiui.set_provider(RAGProvider())

    # Configure chat settings
    aiui.set_chat_features(
        streaming=True,
        reasoning=True,
    )

    # Set up the UI
    aiui.set_style("chat")
    aiui.set_chat_mode("embedded")

    # Add some starter messages that demonstrate the RAG functionality
    aiui.starters([
        aiui.ChatStarter("What is machine learning?", "🤖"),
        aiui.ChatStarter("Tell me about Python programming", "🐍"),
        aiui.ChatStarter("Explain the ML pipeline", "⚙️"),
    ])

    print("🚀 RAG with References Example")
    print("=" * 50)
    print("This example demonstrates:")
    print("• Custom RAG provider with document retrieval")
    print("• Reference emission with source citations")
    print("• Interactive references panel in the UI")
    print("• Multiple document sources with chunk metadata")
    print()
    print("Try asking about machine learning or Python!")
    print("You'll see retrieved source chunks in the 'Sources' section.")
    print()
    print("Starting server at http://localhost:8000")
    print("=" * 50)

    # Start the server
    aiui.run(
        host="0.0.0.0",
        port=8000,
        title="RAG with References - PraisonAIUI",
        description="Example demonstrating RAG citations and source references"
    )
