"""Package metadata agrees with the supported Python versions.

PyPI showed "Python 3.9" while `requires-python` is ">=3.10", and ruff and
mypy targeted 3.9. The floor is `requires-python`; the classifiers, the lint
and type-check targets and the CI matrix follow it.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
PYPROJECT = (ROOT / "pyproject.toml").read_text()


def _version(text: str) -> tuple[int, int]:
    major, minor = text.split(".")[:2]
    return int(major), int(minor)


def _floor() -> tuple[int, int]:
    spec = re.search(r'^requires-python\s*=\s*">=\s*([\d.]+)"', PYPROJECT, re.M).group(1)
    return _version(spec)


def test_classifiers_list_only_supported_versions():
    listed = re.findall(r'"Programming Language :: Python :: (\d+\.\d+)"', PYPROJECT)
    assert listed, "no Python version classifiers"
    assert min(_version(v) for v in listed) == _floor()


def test_ruff_and_mypy_target_the_floor():
    ruff = re.search(r'^target-version\s*=\s*"py(\d)(\d+)"', PYPROJECT, re.M)
    assert (int(ruff.group(1)), int(ruff.group(2))) == _floor()
    mypy = re.search(r'^python_version\s*=\s*"([\d.]+)"', PYPROJECT, re.M).group(1)
    assert _version(mypy) == _floor()


def test_ci_tests_the_floor():
    ci = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text())
    matrix = ci["jobs"]["python"]["strategy"]["matrix"]["python-version"]
    assert min(_version(str(v)) for v in matrix) == _floor()
