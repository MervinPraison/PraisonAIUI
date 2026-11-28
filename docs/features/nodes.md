# Execution Nodes & Presence

> The Nodes page (nodes, under the Control sidebar group) monitors execution nodes and live server/worker instances connected to your PraisonAIUI deployment.

The **Nodes** page (`nodes`, under the **Control** sidebar group) monitors execution nodes and live server/worker instances connected to your PraisonAIUI deployment.

On startup, `NodesFeature` automatically registers the `local` host node and server instance so the Nodes page immediately reflects the current machine's OS, Python version, and online status.

## REST API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/nodes` | List registered execution nodes and total count |
| `POST` | `/api/nodes` | Register a new execution node (`201`, returns generated auth `token`) |
| `GET` | `/api/nodes/{node_id}` | Fetch node details |
| `PUT` | `/api/nodes/{node_id}` | Update `name`, `host`, `agents`, or `approval_policy` |
| `DELETE` | `/api/nodes/{node_id}` | Remove a node |
| `GET` | `/api/nodes/{node_id}/status` | Check node health, status, and last heartbeat |
| `GET` / `PUT` | `/api/nodes/{node_id}/agents` | Inspect or assign agents bound to a node |
| `GET` | `/api/nodes/instances` | List connected instances (alias: `GET /api/instances`) |
| `POST` | `/api/instances/heartbeat` | Record an instance presence heartbeat |

### Registering a Worker Node

```bash
curl -X POST http://127.0.0.1:8000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gpu-worker-1",
    "host": "10.0.0.14",
    "platform": "Linux",
    "agents": ["researcher"],
    "approval_policy": "deny"
  }'
```

## Custom Backends

Implement `NodeProtocol` from `praisonaiui.features.nodes` (`list_nodes`, `register_node`, `get_node`, `delete_node`, `heartbeat`) to back node presence with your own orchestrator or service registry.

## Disabling

```yaml
extensions:
  disabled:
    - builtin.nodes
```

## See Also

- [Device Pairing](https://ui.praison.ai/docs/features/device-pairing.md)
- [Features REST API](https://ui.praison.ai/docs/api/features-api.md#nodes-instances)

## Related pages

- [Work Hub, Kanban & Jobs Board](https://ui.praison.ai/docs/features/work-hub-and-kanban.md)
- [Architecture](https://ui.praison.ai/docs/concepts/architecture.md)
- [Training Lab](https://ui.praison.ai/docs/features/training.md)
