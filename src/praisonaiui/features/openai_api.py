"""OpenAI-Compatible API feature for PraisonAIUI.

Provides /v1/* routes that are compatible with OpenAI SDK clients.
Wraps praisonai.capabilities functions as HTTP endpoints.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# Lazy import capabilities
_capabilities = None


def _get_capabilities():
    """Lazy load praisonai.capabilities."""
    global _capabilities
    if _capabilities is None:
        try:
            from praisonai import capabilities
            _capabilities = capabilities
        except ImportError:
            _capabilities = None
    return _capabilities


def _result_to_dict(result) -> Dict[str, Any]:
    """Convert a dataclass result to dict."""
    if hasattr(result, '__dataclass_fields__'):
        return asdict(result)
    return result if isinstance(result, dict) else {"result": str(result)}


class PraisonAIOpenAIAPI(BaseFeatureProtocol):
    """OpenAI-compatible API endpoints at /v1/*."""

    feature_name = "openai_api"
    feature_description = "OpenAI-compatible API endpoints"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            # Chat completions
            Route("/v1/chat/completions", self._chat_completions, methods=["POST"]),
            # Completions (legacy)
            Route("/v1/completions", self._completions, methods=["POST"]),
            # Embeddings
            Route("/v1/embeddings", self._embeddings, methods=["POST"]),
            # Images
            Route("/v1/images/generations", self._image_generate, methods=["POST"]),
            # Audio
            Route("/v1/audio/transcriptions", self._transcribe, methods=["POST"]),
            Route("/v1/audio/speech", self._speech, methods=["POST"]),
            # Moderations
            Route("/v1/moderations", self._moderations, methods=["POST"]),
            # Models
            Route("/v1/models", self._list_models, methods=["GET"]),
            Route("/v1/models/{model_id}", self._get_model, methods=["GET"]),
            # Responses (OpenAI Responses API)
            Route("/v1/responses", self._responses, methods=["POST"]),
            # Files
            Route("/v1/files", self._list_files, methods=["GET"]),
            Route("/v1/files", self._upload_file, methods=["POST"]),
            Route("/v1/files/{file_id}", self._get_file, methods=["GET"]),
            Route("/v1/files/{file_id}", self._delete_file, methods=["DELETE"]),
            # Assistants
            Route("/v1/assistants", self._list_assistants, methods=["GET"]),
            Route("/v1/assistants", self._create_assistant, methods=["POST"]),
            # API info
            Route("/v1", self._api_info, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "openai-api",
            "help": "OpenAI-compatible API management",
            "commands": {
                "info": {"help": "Show API info", "handler": self._cli_info},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        caps = _get_capabilities()
        return {
            "status": "ok" if caps else "degraded",
            "feature": self.name,
            "capabilities_available": caps is not None,
            **gateway_health(),
        }

    # ── Core endpoints ───────────────────────────────────────────────

    async def _chat_completions(self, request: Request) -> JSONResponse:
        """POST /v1/chat/completions — OpenAI-compatible chat completions."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        messages = body.get("messages", [])
        model = body.get("model", "gpt-4o-mini")
        temperature = body.get("temperature", 1.0)
        max_tokens = body.get("max_tokens")
        tools = body.get("tools")
        tool_choice = body.get("tool_choice")
        stream = body.get("stream", False)
        
        try:
            if stream:
                return await self._stream_chat_completion(caps, body)
            
            result = await caps.achat_completion(
                messages=messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                tool_choice=tool_choice,
            )
            
            # Format as OpenAI response
            response = {
                "id": result.id or f"chatcmpl-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": result.model or model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": result.role,
                        "content": result.content,
                    },
                    "finish_reason": result.finish_reason or "stop",
                }],
                "usage": result.usage or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            }
            
            if result.tool_calls:
                response["choices"][0]["message"]["tool_calls"] = result.tool_calls
            
            return JSONResponse(response)
            
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _stream_chat_completion(self, caps, body) -> StreamingResponse:
        """Stream chat completion response."""
        import json
        
        async def generate():
            try:
                result = await caps.achat_completion(
                    messages=body.get("messages", []),
                    model=body.get("model", "gpt-4o-mini"),
                    temperature=body.get("temperature", 1.0),
                    max_tokens=body.get("max_tokens"),
                    stream=False,  # We simulate streaming
                )
                
                chunk_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
                
                # Send content in chunks
                content = result.content or ""
                for i in range(0, len(content), 20):
                    chunk = {
                        "id": chunk_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": result.model,
                        "choices": [{
                            "index": 0,
                            "delta": {"content": content[i:i+20]},
                            "finish_reason": None,
                        }],
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"
                
                # Send final chunk
                final = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": result.model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(final)}\n\n"
                yield "data: [DONE]\n\n"
                
            except Exception as e:
                yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    async def _completions(self, request: Request) -> JSONResponse:
        """POST /v1/completions — Legacy text completions."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        prompt = body.get("prompt", "")
        model = body.get("model", "gpt-3.5-turbo-instruct")
        
        try:
            result = await caps.atext_completion(
                prompt=prompt,
                model=model,
                temperature=body.get("temperature", 1.0),
                max_tokens=body.get("max_tokens"),
            )
            
            return JSONResponse({
                "id": result.id or f"cmpl-{uuid.uuid4().hex[:8]}",
                "object": "text_completion",
                "created": int(time.time()),
                "model": result.model or model,
                "choices": [{
                    "text": result.content or "",
                    "index": 0,
                    "finish_reason": result.finish_reason or "stop",
                }],
                "usage": result.usage or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _embeddings(self, request: Request) -> JSONResponse:
        """POST /v1/embeddings — Create embeddings."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        input_text = body.get("input", "")
        model = body.get("model", "text-embedding-3-small")
        
        try:
            result = await caps.aembed(
                input=input_text,
                model=model,
            )
            
            data = _result_to_dict(result)
            return JSONResponse({
                "object": "list",
                "data": [{"object": "embedding", "index": 0, "embedding": data.get("embedding", [])}],
                "model": model,
                "usage": data.get("usage", {"prompt_tokens": 0, "total_tokens": 0}),
            })
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _image_generate(self, request: Request) -> JSONResponse:
        """POST /v1/images/generations — Generate images."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        prompt = body.get("prompt", "")
        model = body.get("model", "dall-e-3")
        
        try:
            result = await caps.aimage_generate(
                prompt=prompt,
                model=model,
                n=body.get("n", 1),
                size=body.get("size", "1024x1024"),
            )
            
            data = _result_to_dict(result)
            return JSONResponse({
                "created": int(time.time()),
                "data": data.get("images", [{"url": data.get("url", "")}]),
            })
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _transcribe(self, request: Request) -> JSONResponse:
        """POST /v1/audio/transcriptions — Transcribe audio."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        # Handle multipart form data
        form = await request.form()
        file = form.get("file")
        model = form.get("model", "whisper-1")
        
        try:
            result = await caps.atranscribe(
                file=file,
                model=model,
            )
            
            data = _result_to_dict(result)
            return JSONResponse({"text": data.get("text", "")})
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _speech(self, request: Request) -> JSONResponse:
        """POST /v1/audio/speech — Text to speech."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        
        try:
            result = await caps.aspeech(
                input=body.get("input", ""),
                model=body.get("model", "tts-1"),
                voice=body.get("voice", "alloy"),
            )
            
            data = _result_to_dict(result)
            return JSONResponse(data)
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _moderations(self, request: Request) -> JSONResponse:
        """POST /v1/moderations — Content moderation."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        
        try:
            result = await caps.amoderate(
                input=body.get("input", ""),
                model=body.get("model", "text-moderation-latest"),
            )
            
            data = _result_to_dict(result)
            return JSONResponse({
                "id": f"modr-{uuid.uuid4().hex[:8]}",
                "model": body.get("model", "text-moderation-latest"),
                "results": data.get("results", []),
            })
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _responses(self, request: Request) -> JSONResponse:
        """POST /v1/responses — OpenAI Responses API."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        
        try:
            result = await caps.aresponses_create(
                input=body.get("input", ""),
                model=body.get("model", "gpt-4o-mini"),
                instructions=body.get("instructions"),
            )
            
            return JSONResponse(_result_to_dict(result))
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    # ── Models ───────────────────────────────────────────────────────

    async def _list_models(self, request: Request) -> JSONResponse:
        """GET /v1/models — List available models."""
        models = [
            {"id": "gpt-4o", "object": "model", "owned_by": "openai"},
            {"id": "gpt-4o-mini", "object": "model", "owned_by": "openai"},
            {"id": "gpt-4-turbo", "object": "model", "owned_by": "openai"},
            {"id": "gpt-3.5-turbo", "object": "model", "owned_by": "openai"},
            {"id": "claude-3-5-sonnet-20241022", "object": "model", "owned_by": "anthropic"},
            {"id": "claude-3-5-haiku-20241022", "object": "model", "owned_by": "anthropic"},
            {"id": "gemini-2.0-flash", "object": "model", "owned_by": "google"},
            {"id": "gemini-1.5-pro", "object": "model", "owned_by": "google"},
            {"id": "text-embedding-3-small", "object": "model", "owned_by": "openai"},
            {"id": "text-embedding-3-large", "object": "model", "owned_by": "openai"},
            {"id": "dall-e-3", "object": "model", "owned_by": "openai"},
            {"id": "whisper-1", "object": "model", "owned_by": "openai"},
            {"id": "tts-1", "object": "model", "owned_by": "openai"},
        ]
        return JSONResponse({"object": "list", "data": models})

    async def _get_model(self, request: Request) -> JSONResponse:
        """GET /v1/models/{model_id} — Get model info."""
        model_id = request.path_params["model_id"]
        return JSONResponse({
            "id": model_id,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "praisonai",
        })

    # ── Files ────────────────────────────────────────────────────────

    async def _list_files(self, request: Request) -> JSONResponse:
        """GET /v1/files — List files."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse({"object": "list", "data": []})
        
        try:
            result = await caps.afile_list()
            return JSONResponse({"object": "list", "data": _result_to_dict(result).get("files", [])})
        except Exception:
            return JSONResponse({"object": "list", "data": []})

    async def _upload_file(self, request: Request) -> JSONResponse:
        """POST /v1/files — Upload a file."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        form = await request.form()
        file = form.get("file")
        purpose = form.get("purpose", "assistants")
        
        try:
            result = await caps.afile_create(file=file, purpose=purpose)
            return JSONResponse(_result_to_dict(result))
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _get_file(self, request: Request) -> JSONResponse:
        """GET /v1/files/{file_id} — Get file info."""
        caps = _get_capabilities()
        file_id = request.path_params["file_id"]
        
        if not caps:
            return JSONResponse(
                {"error": {"message": "File not found", "type": "not_found"}},
                status_code=404
            )
        
        try:
            result = await caps.afile_retrieve(file_id=file_id)
            return JSONResponse(_result_to_dict(result))
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    async def _delete_file(self, request: Request) -> JSONResponse:
        """DELETE /v1/files/{file_id} — Delete a file."""
        caps = _get_capabilities()
        file_id = request.path_params["file_id"]
        
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        try:
            await caps.afile_delete(file_id=file_id)
            return JSONResponse({"id": file_id, "object": "file", "deleted": True})
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    # ── Assistants ───────────────────────────────────────────────────

    async def _list_assistants(self, request: Request) -> JSONResponse:
        """GET /v1/assistants — List assistants."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse({"object": "list", "data": []})
        
        try:
            result = await caps.aassistant_list()
            return JSONResponse({"object": "list", "data": _result_to_dict(result).get("assistants", [])})
        except Exception:
            return JSONResponse({"object": "list", "data": []})

    async def _create_assistant(self, request: Request) -> JSONResponse:
        """POST /v1/assistants — Create an assistant."""
        caps = _get_capabilities()
        if not caps:
            return JSONResponse(
                {"error": {"message": "Capabilities not available", "type": "server_error"}},
                status_code=503
            )
        
        body = await request.json()
        
        try:
            result = await caps.aassistant_create(
                name=body.get("name", "Assistant"),
                model=body.get("model", "gpt-4o-mini"),
                instructions=body.get("instructions"),
                tools=body.get("tools", []),
            )
            return JSONResponse(_result_to_dict(result))
        except Exception as e:
            return JSONResponse(
                {"error": {"message": str(e), "type": "api_error"}},
                status_code=500
            )

    # ── API Info ─────────────────────────────────────────────────────

    async def _api_info(self, request: Request) -> JSONResponse:
        """GET /v1 — API information."""
        caps = _get_capabilities()
        return JSONResponse({
            "name": "PraisonAI OpenAI-Compatible API",
            "version": "1.0.0",
            "capabilities_available": caps is not None,
            "endpoints": [
                {"path": "/v1/chat/completions", "method": "POST", "description": "Chat completions"},
                {"path": "/v1/completions", "method": "POST", "description": "Text completions"},
                {"path": "/v1/embeddings", "method": "POST", "description": "Create embeddings"},
                {"path": "/v1/images/generations", "method": "POST", "description": "Generate images"},
                {"path": "/v1/audio/transcriptions", "method": "POST", "description": "Transcribe audio"},
                {"path": "/v1/audio/speech", "method": "POST", "description": "Text to speech"},
                {"path": "/v1/moderations", "method": "POST", "description": "Content moderation"},
                {"path": "/v1/models", "method": "GET", "description": "List models"},
                {"path": "/v1/responses", "method": "POST", "description": "Responses API"},
                {"path": "/v1/files", "method": "GET/POST", "description": "File management"},
                {"path": "/v1/assistants", "method": "GET/POST", "description": "Assistants API"},
            ],
        })

    # ── CLI ──────────────────────────────────────────────────────────

    def _cli_info(self) -> str:
        caps = _get_capabilities()
        status = "✓ Available" if caps else "✗ Not available"
        return f"OpenAI-Compatible API: {status}\nBase URL: /v1/"
