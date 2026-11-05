# Knowledge Embedding Model Configuration

Knowledge / RAG search uses vector **embeddings**. The default embedding model is
`text-embedding-3-small`. Many OpenAI keys or projects do not have access to that
model (organization tier, model allowlist, or regional restrictions), which caused
knowledge search to silently degrade to local substring matching.

PraisonAIUI now makes this failure mode configurable and observable.

## Configure the embedding model

Set an accessible model via environment variable:

```bash
export AIUI_EMBEDDING_MODEL=text-embedding-ada-002
```

`OPENAI_EMBEDDING_MODEL` is also honoured as a fallback if `AIUI_EMBEDDING_MODEL`
is not set.

## Fallback chain

The OpenAI-compatible `/v1/embeddings` endpoint tries the requested (or default)
model first, then each model in the fallback chain if the primary returns a
`model_not_found` / 403 access error:

```bash
export AIUI_EMBEDDING_FALLBACK_MODELS="text-embedding-ada-002,text-embedding-3-small"
```

If every candidate is inaccessible, the endpoint returns `503` with an actionable
`model_not_found` error instead of a generic `500`.

## Observing degraded search

`GET /api/knowledge/status` reports embedding availability:

```json
{
  "total": 12,
  "backend": "SDKKnowledgeManager",
  "status": "degraded",
  "embedding": {"available": false, "error": "Project does not have access to model `text-embedding-3-small`"},
  "warnings": ["Embedding model unavailable; knowledge search degraded to local text matching. Set AIUI_EMBEDDING_MODEL to an accessible model."]
}
```

`POST /api/knowledge/search` indicates whether results came from vector search or a
degraded local fallback:

```json
{
  "results": [],
  "count": 0,
  "search_mode": "fallback",
  "warning": "Vector search unavailable: Project does not have access to model text-embedding-3-small. Set AIUI_EMBEDDING_MODEL=text-embedding-ada-002 or enable embedding models in your provider project."
}
```

A dashboard can show a warning banner whenever `search_mode == "fallback"` or
`embedding.available == false`.

## Model reference

| Model | Notes |
|-------|-------|
| `text-embedding-3-small` | Default — best cost/quality when available |
| `text-embedding-3-large` | Higher quality — may also be restricted |
| `text-embedding-ada-002` | Legacy — widely available on older projects |
