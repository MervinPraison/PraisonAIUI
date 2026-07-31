/**
 * PraisonAIUI gate configuration — imported by merge-gate, release-gate, ci-failure-claude.
 */

module.exports = {
  repoFullName: 'MervinPraison/PraisonAIUI',
  productPathPrefixes: ['src/praisonaiui/', 'src/frontend/', 'tests/'],
  sensitivePathPatterns: [
    /^\.github\/workflows\//,
    /^pyproject\.toml$/,
    /credentials\.json$/i,
  ],
  requiredCheckPatterns: [/^ci$/i, /python/i, /test/i, /lint/i, /ruff/i],
  ciWorkflowFile: 'ci.yml',
  ciWorkflowName: 'CI',
  mergeGateWorkflowRuns: ['CI', 'Claude Assistant'],
  ciFailureWorkflowRuns: ['CI'],
  pypiPackageName: 'aiui',
  packagePaths: ['src/praisonaiui', 'src/frontend', 'pyproject.toml'],
  finalClaudeScope:
    'SCOPE: Focus ONLY on PraisonAIUI (src/praisonaiui, src/frontend, tests, docs). '
    + 'Do NOT expand into praisonaiagents or the monorepo unless the PR explicitly requires it.',
  finalClaudeProductValue:
    '4. Product value: review in depth whether the change genuinely adds PraisonAIUI UX value — '
    + 'never add features for the sake of adding them. It must strengthen the UI (simpler, '
    + 'more user-friendly, robust). If it does not clearly add value, request changes or recommend '
    + 'rejecting/closing rather than merging scope creep.\n'
    + '5. Layering: UI/frontend/server features here; core agent runtime belongs in praisonaiagents '
    + '(PraisonAI monorepo). Agent-callable tools → PraisonAI-Tools. Do not pull monorepo or SDK '
    + 'scope into this repo unless the PR explicitly requires it.\n'
    + '6. Do not bloat server.py or create_app() with new params — prefer existing YAML config, '
    + 'plugins, and feature modules; only add params if absolutely required. Reject knobs/exports '
    + 'with no live consumer.',
  mergeGateProductValue:
    'Confirm product value gate: change strengthens PraisonAIUI UX (no scope creep). The aim is a '
    + 'LIGHTWEIGHT AND POWERFUL package — BLOCK changes that add params/modules/exports duplicating '
    + 'existing UI capabilities (YAML config, plugins, feature modules, existing server hooks), or '
    + 'add knobs/fields with no live consumer, i.e. scope creep for the sake of it.',
  mergeGateLayering:
    'Layering routing: BLOCK if core agent logic was added here instead of praisonaiagents; BLOCK if '
    + 'agent-callable tools were added here instead of PraisonAI-Tools.',
  mergeGateServerBloat:
    'Do not bloat server.py or create_app() with additional params — only if absolutely required; '
    + 'prefer existing config/plugin patterns.',
  agentPyChecks: false,
  reviewBotLogins: [
    'coderabbitai[bot]',
    'qodo-code-review[bot]',
    'greptile-apps[bot]',
  ],
};
