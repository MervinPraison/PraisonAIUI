import { useEffect, useState } from 'react'
import { modelsByAgent } from './model'

let models: Promise<Map<string, string>> | null = null

/** The agent definitions' models, fetched once per page view (an empty map when the route is off). */
function loadModels(): Promise<Map<string, string>> {
  models ??= fetch('/api/agents/definitions', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then(modelsByAgent)
    .catch(() => new Map<string, string>())
  return models
}

/** The model an agent is defined with, once known; undefined for an agent without a definition. */
export function useAgentModel(agent: string | undefined): string | undefined {
  const [found, setFound] = useState<{ agent: string; model?: string } | null>(null)
  useEffect(() => {
    if (!agent) return
    let alive = true
    void loadModels().then((m) => alive && setFound({ agent, model: m.get(agent.toLowerCase()) }))
    return () => {
      alive = false
    }
  }, [agent])
  return found && found.agent === agent ? found.model : undefined
}

/** Test hook. */
export function resetAgentModelsForTests(): void {
  models = null
}
