# BeautifulUI upstream pin record

BeautifulUI is vendored (shadcn-style registry copy), **not** an npm dependency.
This file is the single source of truth for what upstream revision is vendored.
Update it in the **same PR** that adds or bumps any vendored component, and make
sure the frontend CI gate (issue #295) passes.

See [beautifului-adapter-architecture.md](./beautifului-adapter-architecture.md)
for the adapter boundary and folder layout.

## Pin

| Field | Value |
|-------|-------|
| Upstream repo | _TBD — record on first vendor_ |
| Git SHA | _TBD_ |
| Vendored on (date) | _TBD_ |
| Registry base URL | _TBD_ |
| License | MIT (kept in-tree) |

## Vendored components

Record one row per component the first time it is copied in.

| Component | Registry URL | SHA | Vendored path | Date |
|-----------|--------------|-----|---------------|------|
| _(none yet)_ | | | | |

## Upgrade checklist

1. Update the SHA / date / registry rows above.
2. Re-copy changed components into `src/frontend/src/agent-ui/vendors/beautifului/`.
3. Keep all upstream imports inside `src/agent-ui/` (adapter boundary rule).
4. Run the frontend build + adapter unit tests (frontend CI gate, #295).
5. Do **not** add a `beautiful-ui` entry to `package.json` dependencies.
