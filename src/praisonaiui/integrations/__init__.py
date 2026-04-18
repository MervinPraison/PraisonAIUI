"""PraisonAIUI framework integrations with lazy loading.

This module provides integrations with popular Python agent frameworks:
- LangChain (sync and async callback handlers)
- LlamaIndex (callback handler)
- Semantic Kernel (function invocation filter)

All integrations are lazily loaded to avoid importing heavy dependencies
unless explicitly used.
"""

def __getattr__(name: str):
    """Lazy import for framework integrations."""
    if name in ("AiuiLangChainCallbackHandler", "AsyncAiuiLangChainCallbackHandler"):
        from praisonaiui.integrations.langchain import (
            AiuiLangChainCallbackHandler,
            AsyncAiuiLangChainCallbackHandler,
        )
        if name == "AiuiLangChainCallbackHandler":
            return AiuiLangChainCallbackHandler
        else:
            return AsyncAiuiLangChainCallbackHandler

    elif name == "AiuiLlamaIndexCallbackHandler":
        from praisonaiui.integrations.llama_index import AiuiLlamaIndexCallbackHandler
        return AiuiLlamaIndexCallbackHandler

    elif name == "AiuiSemanticKernelFilter":
        from praisonaiui.integrations.semantic_kernel import AiuiSemanticKernelFilter
        return AiuiSemanticKernelFilter

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "AiuiLangChainCallbackHandler",
    "AsyncAiuiLangChainCallbackHandler",
    "AiuiLlamaIndexCallbackHandler",
    "AiuiSemanticKernelFilter",
]
