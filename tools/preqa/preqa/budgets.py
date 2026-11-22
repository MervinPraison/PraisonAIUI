"""Compare a run's metrics with the budgets file.

``budgets.json``::

    {
      "defaults": {"nav_ms.p95": {"max": 1000}, "held_requests": {"max": 0}},
      "targets":  {"prod": {"nav_ms.p95": {"max": 1500}}}
    }

A key is a dotted path into the run's ``metrics`` (``nav_ms.p95`` reads
``metrics["nav_ms"]["p95"]``). A rule has ``max`` and/or ``min`` and an
optional ``required`` (default true): a required metric that is missing from
the run is itself a breach, so a check that silently stopped measuring fails
instead of passing. ``targets.<name>`` overrides or adds rules for one target;
a rule set to ``null`` there removes the default for that target.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("defaults", {}), dict):
        raise ValueError(f"{path}: expected an object with a 'defaults' object")
    return data


def rules_for(budgets: dict, target: str) -> dict[str, dict]:
    rules = dict(budgets.get("defaults", {}))
    for key, rule in (budgets.get("targets", {}).get(target) or {}).items():
        if rule is None:
            rules.pop(key, None)
        else:
            rules[key] = rule
    return rules


def lookup(metrics: dict, key: str) -> Any:
    cur: Any = metrics
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def compare(metrics: dict, budgets: dict, target: str) -> list[dict]:
    """Every breach of ``target``'s rules, in budget-file order."""
    breaches = []
    for key, rule in rules_for(budgets, target).items():
        value = lookup(metrics, key)
        if value is None or isinstance(value, (dict, list)):
            if rule.get("required", True):
                breaches.append({"metric": key, "kind": "missing", "value": None, "limit": None})
            continue
        if "max" in rule and value > rule["max"]:
            breaches.append({"metric": key, "kind": "max", "value": value, "limit": rule["max"]})
        if "min" in rule and value < rule["min"]:
            breaches.append({"metric": key, "kind": "min", "value": value, "limit": rule["min"]})
    return breaches


def describe(breach: dict) -> str:
    if breach["kind"] == "missing":
        return f"{breach['metric']}: not measured"
    op = ">" if breach["kind"] == "max" else "<"
    return f"{breach['metric']} = {breach['value']} {op} {breach['limit']}"
