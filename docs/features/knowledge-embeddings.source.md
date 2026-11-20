---
nav_title: Knowledge embeddings
---

# Knowledge Embedding Model Configuration

Knowledge / RAG search uses vector **embeddings**. The default embedding model is
`text-embedding-3-small`. Many OpenAI keys or projects do not have access to that
model (organization tier, model allowlist, or regional restrictions), which caused
knowledge search to silently degrade to local substring matching.

PraisonAIUI now makes this failure mode configurable and observable.

## Configure the embedding model

The knowledge store embeds through praisonaiagents, whose adapters read
`OPENAI_EMBEDDING_MODEL`:

```bash
export OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
```

The `/v1/embeddings` endpoint reads `AIUI_EMBEDDING_MODEL` first, then
`OPENAI_EMBEDDING_MODEL`.

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

The praisonaiagents adapters do not raise when an embedding fails: search
returns no hits and a write returns a failed result. So the store embeds one
word when it starts, and reads the result of every write. While embeddings are
unavailable, `GET /api/knowledge/status` says so:

```json
{
  "total": 12,
  "backend": "SDKKnowledgeManager",
  "status": "degraded",
  "embedding": {"available": false, "error": "<the provider's error>"},
  "warnings": ["Embeddings unavailable: text-embedding-3-small is not accessible. Using keyword search; new entries are kept in memory and won't persist across restarts. Set OPENAI_EMBEDDING_MODEL to a model your provider project can access."]
}
```

`POST /api/knowledge` still keeps the entry (in memory, searchable by keyword)
but no longer claims it was saved: the response has `"persisted": false`,
`"sdk_synced": false` and the same `warning`. A file upload while embeddings
are down is indexed as text in memory when it is a text file, with that
warning as `knowledge_warning`; other files are refused with it.

`POST /api/knowledge/search` indicates whether results came from vector search or a
degraded local fallback:

```json
{
  "results": [],
  "count": 0,
  "search_mode": "fallback",
  "warning": "Embeddings unavailable: text-embedding-3-small is not accessible. Using keyword search; ..."
}
```

`search_mode` is `vector` only when the hits came from the vector store; a
keyword match on a healthy store is `local`.

A dashboard can show a warning banner whenever `search_mode == "fallback"` or
`embedding.available == false`.

## Model reference

| Model | Notes |
|-------|-------|
| `text-embedding-3-small` | Default — best cost/quality when available |
| `text-embedding-3-large` | Higher quality — may also be restricted |
| `text-embedding-ada-002` | Legacy — widely available on older projects |
