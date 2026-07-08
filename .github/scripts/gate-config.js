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
    '4. Product value: review whether the change genuinely adds PraisonAIUI UX value and correct '
    + 'layering (UI/frontend here; core agent logic belongs in praisonaiagents). Reject scope creep.',
  agentPyChecks: false,
  reviewBotLogins: [
    'coderabbitai[bot]',
    'qodo-code-review[bot]',
    'greptile-apps[bot]',
  ],
};
