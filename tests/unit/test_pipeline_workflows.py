"""Pipeline workflows listen for workflows that exist.

A `workflow_run` trigger names a workflow by its `name:`. A name that matches
no workflow is silently never fired: the merge gate listened for "Core Tests"
while CI is named "CI", so a PR going green waited for the 10-minute cron.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
GATE_CONFIG = WORKFLOWS.parent / "scripts" / "gate-config.js"


def _load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text())
    # PyYAML reads the bare key `on` as True.
    data["on"] = data.pop(True, data.get("on")) or {}
    return data


def _names() -> set[str]:
    return {_load(p)["name"] for p in WORKFLOWS.glob("*.yml")}


def _workflow_run_sources(file: str) -> list[str]:
    on = _load(WORKFLOWS / file)["on"]
    return list((on.get("workflow_run") or {}).get("workflows") or [])


@pytest.fixture(scope="module")
def gate_config() -> dict:
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(
        ["node", "-e", f"console.log(JSON.stringify(require({json.dumps(str(GATE_CONFIG))})))"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def test_ci_workflow_name_matches_gate_config(gate_config):
    assert _load(WORKFLOWS / gate_config["ciWorkflowFile"])["name"] == gate_config["ciWorkflowName"]


def test_merge_gate_listens_for_existing_workflows(gate_config):
    sources = _workflow_run_sources("claude-merge-gate.yml")
    assert sorted(sources) == sorted(gate_config["mergeGateWorkflowRuns"])
    missing = set(sources) - _names()
    assert not missing, f"claude-merge-gate.yml listens for workflows that do not exist: {missing}"
    assert gate_config["ciWorkflowName"] in sources


def test_merge_gate_filters_runs_with_the_same_list():
    text = (WORKFLOWS / "claude-merge-gate.yml").read_text()
    assert "require(process.env.GATE_CONFIG_PATH).mergeGateWorkflowRuns" in text
    assert "Core Tests" not in text


def test_release_gate_listens_for_ci(gate_config):
    assert _workflow_run_sources("nightly-release-gate.yml") == [gate_config["ciWorkflowName"]]
