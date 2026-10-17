# Backend Integration Contract

PraisonAIUI supports a four-layer integration model so standalone mode and SDK-integrated mode can share the same feature APIs.

## Four Layers

1. **Feature API layer**  
   Endpoints live in feature modules and expose stable HTTP/CLI behaviour.
2. **Feature manager layer**  
   Each feature manager keeps local fallback logic for standalone operation.
3. **Backend factory layer**  
   `praisonaiui.backends` provides optional injected factories (`get_workflow_runner()`, `get_hooks_lister()`, `get_usage_query()`, etc.).
4. **SDK/runtime layer**  
   PraisonAI or praisonaiagents implementations are used when injected or importable.

## Injection Contract

- Injected backends are optional and must be callable.
- Features must keep local fallbacks when injected backends are absent or fail.
- Backend call signatures should remain minimal and dict/list based.
- Integration should not introduce hard imports in feature modules when a fallback already exists.

## Operational Rule

When integrated, wrappers should inject backend callables at startup; when standalone, features should run without any backend injection.
