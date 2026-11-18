/**
 * Release gate preflight — path changes, CI SHA, dedupe, PyPI version checks (PraisonAIUI).
 */

const https = require('https');
const config = require('./gate-config.js');

const PACKAGE_PATHS = config.packagePaths;
const ACTIVE_RELEASE_STATUSES = new Set([
  'queued', 'in_progress', 'waiting', 'pending', 'requested',
]);

function bumpPatch(version) {
  const parts = version.split('.');
  if (parts.length !== 3) throw new Error(`Invalid version: ${version}`);
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

function readVersionsFromTree(root = '.') {
  const fs = require('fs');
  const path = require('path');
  const toml = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
  const match = toml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('Could not read aiui version from pyproject.toml');
  const current = match[1];
  const target = bumpPatch(current);
  return { current, target, packageName: config.pypiPackageName };
}

function pypiVersionExists(packageName, version) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://pypi.org/pypi/${packageName}/${version}/json`,
      { timeout: 15000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function hasActiveReleaseRun(github, owner, repo) {
  const runs = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'pypi-release.yml',
    per_page: 20,
  });
  return runs.data.workflow_runs.some(
    (r) => ACTIVE_RELEASE_STATUSES.has(r.status) && !r.conclusion
  );
}

function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// pypi-release.yml's run-name carries this marker on a dry run, which
// concludes `success` without publishing anything.
const DRY_RUN_MARKER = '[dry run]';

function isDryRunRelease(run) {
  return String(run.display_title || run.name || '').toLowerCase().includes(DRY_RUN_MARKER);
}

async function hasSuccessfulReleaseToday(github, owner, repo, now = new Date()) {
  const dayStart = utcDayStart(now);
  const runs = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'pypi-release.yml',
    status: 'completed',
    per_page: 30,
  });
  return runs.data.workflow_runs.some(
    (r) => r.conclusion === 'success'
      && new Date(r.created_at) >= dayStart
      && !isDryRunRelease(r)
  );
}

/**
 * pypi-release.yml publishes only the SHA the gate (or the person) verified:
 * HEAD must be the trigger SHA when one was given, still be origin/main, and
 * have a successful CI run. `ciRuns` is `gh run list --json status,conclusion`
 * for that commit, newest first.
 */
function checkReleaseSha({ headSha, triggerSha = '', mainSha, ciRuns = [] }) {
  const short = (s) => (s || 'none').slice(0, 7);
  if (!headSha) return { ok: false, reason: 'could not resolve HEAD' };
  if (triggerSha && headSha !== triggerSha) {
    return { ok: false, reason: `checked out ${short(headSha)}, expected trigger SHA ${short(triggerSha)}` };
  }
  if (headSha !== mainSha) {
    return {
      ok: false,
      reason: `${short(headSha)} is no longer origin/main (${short(mainSha)}); `
        + 'the newer commit gets its own CI run and release gate',
    };
  }
  const latest = ciRuns[0];
  if (!latest) return { ok: false, reason: `no CI run for ${short(headSha)}` };
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    return {
      ok: false,
      reason: `CI on ${short(headSha)} is ${latest.status}/${latest.conclusion || 'pending'}, not success`,
    };
  }
  return { ok: true, reason: `CI green on ${short(headSha)}, which is origin/main` };
}

async function lastGreenCiSha(github, owner, repo) {
  const runs = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: config.ciWorkflowFile,
    branch: 'main',
    status: 'completed',
    per_page: 30,
  });
  const hit = runs.data.workflow_runs.find((r) => r.conclusion === 'success');
  return hit ? hit.head_sha : '';
}

async function evaluateReleasePreflight(github, owner, repo, options, core) {
  const {
    headSha,
    isCiTrigger = false,
    bump = 'patch',
    // Injectable for the selftest.
    readVersions = readVersionsFromTree,
    pypiExists = pypiVersionExists,
  } = options;

  const reasons = [];
  const out = {
    ready: false,
    // true when the repo is in a state no later run can fix by itself: the
    // workflow fails instead of reporting a quiet skip every night.
    blocked: false,
    reasons,
    headSha: headSha || '',
    lastTag: '',
    targetVersion: '',
    packageName: config.pypiPackageName,
  };

  if (bump !== 'patch') {
    reasons.push('only patch auto-release supported');
    return out;
  }

  if (await hasActiveReleaseRun(github, owner, repo)) {
    reasons.push('PyPI Release already in progress or awaiting approval');
    return out;
  }

  const referenceTime = options.now instanceof Date ? options.now : new Date();
  if (await hasSuccessfulReleaseToday(github, owner, repo, referenceTime)) {
    const day = referenceTime.toISOString().slice(0, 10);
    reasons.push(`already released today (UTC ${day}); max one patch release per day`);
    return out;
  }

  let versions;
  try {
    versions = readVersions();
  } catch (err) {
    reasons.push(err.message);
    return out;
  }
  out.targetVersion = versions.target;

  // No release is active (checked above), so the next version being on PyPI
  // means a release published it and never landed its bump on main. Every
  // later run would compute the same target and skip: fail loudly instead.
  const onPypi = await pypiExists(config.pypiPackageName, versions.target);
  if (onPypi) {
    out.blocked = true;
    reasons.push(
      `${config.pypiPackageName}==${versions.target} is on PyPI but pyproject.toml on main `
      + `still says ${versions.current}: a release published without pushing its bump. `
      + `Bump pyproject.toml and __version__.py to ${versions.target} on main.`
    );
    return out;
  }

  const { execSync } = require('child_process');
  let lastTag = '';
  try {
    lastTag = execSync('git describe --tags --match "v*" --abbrev=0', { encoding: 'utf8' }).trim();
  } catch {
    reasons.push('no v* tag found');
    return out;
  }
  out.lastTag = lastTag;

  let changed = '';
  try {
    changed = execSync(
      `git diff --name-only ${lastTag} HEAD -- ${PACKAGE_PATHS.join(' ')}`,
      { encoding: 'utf8' }
    ).trim();
  } catch {
    reasons.push('git diff failed');
    return out;
  }

  if (!changed) {
    reasons.push(`no changes in ${PACKAGE_PATHS.join(' or ')} since ${lastTag}`);
    return out;
  }

  if (isCiTrigger) {
    let mainSha = '';
    try {
      mainSha = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
    } catch {
      reasons.push('could not resolve origin/main');
      return out;
    }
    if (headSha !== mainSha) {
      reasons.push(`superseded: green SHA ${headSha.slice(0, 7)} != main ${mainSha.slice(0, 7)}`);
      return out;
    }
    out.headSha = headSha;
  } else {
    const evalSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    out.headSha = evalSha;
    const greenSha = await lastGreenCiSha(github, owner, repo);
    if (greenSha !== evalSha) {
      reasons.push(`CI not green on HEAD (last green: ${greenSha ? greenSha.slice(0, 7) : 'none'})`);
      return out;
    }
  }

  out.ready = true;
  out.reasons = ['ready'];
  if (core) core.info(`Release preflight passed for ${out.headSha || headSha}`);
  return out;
}

// CLI for pypi-release.yml: `node release-gate.js verify-sha`
// (env HEAD_SHA, TRIGGER_SHA, MAIN_SHA, CI_RUNS_JSON).
if (require.main === module) {
  const [cmd] = process.argv.slice(2);
  if (cmd !== 'verify-sha') {
    console.error('usage: release-gate.js verify-sha');
    process.exit(2);
  }
  let ciRuns = [];
  try {
    ciRuns = JSON.parse(process.env.CI_RUNS_JSON || '[]');
  } catch {
    console.error('CI_RUNS_JSON is not JSON');
    process.exit(1);
  }
  const res = checkReleaseSha({
    headSha: process.env.HEAD_SHA || '',
    triggerSha: process.env.TRIGGER_SHA || '',
    mainSha: process.env.MAIN_SHA || '',
    ciRuns,
  });
  console.log(res.ok ? `ok: ${res.reason}` : `refusing to release: ${res.reason}`);
  process.exit(res.ok ? 0 : 1);
}

module.exports = {
  bumpPatch,
  checkReleaseSha,
  isDryRunRelease,
  DRY_RUN_MARKER,
  readVersionsFromTree,
  pypiVersionExists,
  hasSuccessfulReleaseToday,
  utcDayStart,
  evaluateReleasePreflight,
  lastGreenCiSha,
  ACTIVE_RELEASE_STATUSES,
  PACKAGE_PATHS,
};
