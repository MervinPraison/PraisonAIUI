#!/usr/bin/env node
/**
 * Run: node .github/scripts/release-gate-selftest.js
 */
const rg = require('./release-gate.js');
const config = require('./gate-config.js');

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error('FAIL:', name);
    failed += 1;
  } else {
    console.log('ok:', name);
  }
}

assert('package name is aiui', config.pypiPackageName === 'aiui');
assert('bumpPatch works', rg.bumpPatch('0.3.127') === '0.3.128');

try {
  const versions = rg.readVersionsFromTree(process.cwd());
  assert('reads current version', /^\d+\.\d+\.\d+$/.test(versions.current));
  assert('computes target patch', versions.target === rg.bumpPatch(versions.current));
} catch (err) {
  console.error('FAIL: readVersionsFromTree', err.message);
  failed += 1;
}

assert('PACKAGE_PATHS includes pyproject', rg.PACKAGE_PATHS.includes('pyproject.toml'));

// --- pypi-release.yml checks out and verifies the trigger SHA -------------
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const green = [{ status: 'completed', conclusion: 'success' }];
assert('sha: trigger SHA that is main with green CI is ok',
  rg.checkReleaseSha({ headSha: A, triggerSha: A, mainSha: A, ciRuns: green }).ok);
assert('sha: manual release (no trigger SHA) on green main is ok',
  rg.checkReleaseSha({ headSha: A, mainSha: A, ciRuns: green }).ok);
assert('sha: main moved after the gate -> refuse',
  !rg.checkReleaseSha({ headSha: A, triggerSha: A, mainSha: B, ciRuns: green }).ok);
assert('sha: checkout is not the trigger SHA -> refuse',
  !rg.checkReleaseSha({ headSha: B, triggerSha: A, mainSha: B, ciRuns: green }).ok);
assert('sha: CI still running -> refuse',
  !rg.checkReleaseSha({ headSha: A, mainSha: A, ciRuns: [{ status: 'in_progress', conclusion: '' }] }).ok);
assert('sha: CI red -> refuse',
  !rg.checkReleaseSha({ headSha: A, mainSha: A, ciRuns: [{ status: 'completed', conclusion: 'failure' }] }).ok);
assert('sha: no CI run -> refuse',
  !rg.checkReleaseSha({ headSha: A, mainSha: A, ciRuns: [] }).ok);

// --- a dry run is not "already released today" -----------------------------
function fakeGithub(runs) {
  return { rest: { actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }) } } };
}
const now = new Date('2026-11-18T15:00:00Z');
const today = '2026-11-18T09:00:00Z';

(async () => {
  assert('dry-run marker detected', rg.isDryRunRelease({ display_title: 'PyPI Release [dry run] patch' }));
  assert('real run is not a dry run', !rg.isDryRunRelease({ display_title: 'PyPI Release patch (ci)' }));
  assert('legacy run title (no marker) counts as a release', !rg.isDryRunRelease({ display_title: 'PyPI Release' }));

  assert('dry run today does not count as released',
    !(await rg.hasSuccessfulReleaseToday(fakeGithub([
      { conclusion: 'success', created_at: today, display_title: 'PyPI Release [dry run] patch' },
    ]), 'o', 'r', now)));
  assert('real release today counts',
    await rg.hasSuccessfulReleaseToday(fakeGithub([
      { conclusion: 'success', created_at: today, display_title: 'PyPI Release patch (manual)' },
    ]), 'o', 'r', now));
  assert('failed release today does not count',
    !(await rg.hasSuccessfulReleaseToday(fakeGithub([
      { conclusion: 'failure', created_at: today, display_title: 'PyPI Release patch (ci)' },
    ]), 'o', 'r', now)));
  assert('yesterday does not count',
    !(await rg.hasSuccessfulReleaseToday(fakeGithub([
      { conclusion: 'success', created_at: '2026-11-17T23:59:00Z', display_title: 'PyPI Release patch (ci)' },
    ]), 'o', 'r', now)));

  // --- target already on PyPI while the tree is behind: fail loudly ---------
  const behind = await rg.evaluateReleasePreflight(fakeGithub([]), 'o', 'r', {
    headSha: A,
    now,
    readVersions: () => ({ current: '1.2.3', target: '1.2.4', packageName: 'aiui' }),
    pypiExists: async () => true,
  });
  assert('target on PyPI + tree behind -> not ready', behind.ready === false);
  assert('target on PyPI + tree behind -> blocked (workflow fails)', behind.blocked === true);
  assert('blocked reason names both versions',
    /1\.2\.4/.test(behind.reasons[0]) && /1\.2\.3/.test(behind.reasons[0]));

  const skipToday = await rg.evaluateReleasePreflight(fakeGithub([
    { status: 'completed', conclusion: 'success', created_at: today, display_title: 'PyPI Release patch (ci)' },
  ]), 'o', 'r', { headSha: A, now });
  assert('ordinary skip (released today) is not blocked', skipToday.blocked === false && !skipToday.ready);

  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FAIL: selftest crashed', err);
  process.exit(1);
});
