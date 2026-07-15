"""Unit tests for Skills Studio (STITCH-008, #218).

Covers:
  * skills.* i18n keys across locales.
  * Frontend view content assertions (tabs, diff overlay, deep-link, APIs).
  * XSS-safety of the proposed-content diff render.
  * approvals.js cross-link for skill-type rows.
  * Python-mirrored isSkillApproval (R1-R5) predicate and LCS line diff.
"""

from __future__ import annotations

from pathlib import Path

from praisonaiui.features.i18n import JSONLocaleManager

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views"
)
SKILLS_JS = FRONTEND / "skills.js"
APPROVALS_JS = FRONTEND / "approvals.js"
HELPERS_JS = FRONTEND / "_helpers.js"


class TestI18nKeys:
    KEYS = [
        "skills.title",
        "skills.subtitle",
        "skills.tab.pending",
        "skills.tab.installed",
        "skills.tab.history",
        "skills.diff.current",
        "skills.diff.proposed",
        "skills.diff.no_existing",
        "skills.action.approve",
        "skills.action.reject",
        "skills.pending.empty",
    ]

    def test_keys_present_all_locales(self):
        mgr = JSONLocaleManager()
        for locale in ("en", "es", "fr"):
            strings = mgr.get_strings(locale)
            for k in self.KEYS:
                assert k in strings, f"missing {locale} key: {k}"


class TestHelpersJs:
    def test_helpers_export_functions(self):
        src = HELPERS_JS.read_text()
        assert "export function diffLines(" in src
        assert "export function renderMarkdownPreview(" in src
        assert "export function isSkillApproval(" in src

    def test_diff_normalises_crlf(self):
        src = HELPERS_JS.read_text()
        assert "replace(/\\r\\n?/g, '\\n')" in src

    def test_preview_escapes_first(self):
        src = HELPERS_JS.read_text()
        assert "esc(s)" in src


class TestSkillsJs:
    def test_exports_render_and_cleanup(self):
        src = SKILLS_JS.read_text()
        assert "export async function render" in src
        assert "export function cleanup" in src

    def test_tab_shell_present(self):
        src = SKILLS_JS.read_text()
        assert "class=\"ss-tab\"" in src
        assert "tabBtn('pending'" in src
        assert "tabBtn('installed'" in src
        assert "tabBtn('history'" in src

    def test_url_state_and_deep_link(self):
        src = SKILLS_JS.read_text()
        assert "approval_id" in src
        assert "currentApprovalId(" in src
        assert "openDiff(" in src

    def test_uses_existing_apis(self):
        src = SKILLS_JS.read_text()
        assert "/api/approvals/pending" in src
        assert "/api/approvals/history" in src
        assert "/api/skills" in src
        assert "/api/skills/${cb.dataset.id}/toggle" in src
        assert "/api/approvals/${id}/${verb}" in src

    def test_imports_skill_helpers(self):
        src = SKILLS_JS.read_text()
        assert "isSkillApproval" in src
        assert "diffLines" in src
        assert "renderMarkdownPreview" in src

    def test_no_browser_eval(self):
        src = SKILLS_JS.read_text()
        assert "eval(" not in src

    def test_proposed_content_escaped_in_diff(self):
        src = SKILLS_JS.read_text()
        # Diff rows must escape line text; no raw interpolation of r.text.
        assert "esc(r.text)" in src
        assert "${r.text}" not in src

    def test_empty_state_and_no_existing_labels(self):
        src = SKILLS_JS.read_text()
        assert "No pending skill writes" in src
        assert "No existing skill" in src


class TestApprovalsCrossLink:
    def test_skill_row_links_to_studio(self):
        src = APPROVALS_JS.read_text()
        assert "isSkillApproval" in src
        assert "/skills?tab=pending&approval_id=" in src


# ── Python mirrors of the JS predicate + diff for logic verification ──


def is_skill_approval(a: dict) -> bool:
    names = {"write_skill", "skill_write", "save_skill", "create_skill"}
    if str(a.get("tool_name", "")).lower() in names:
        return True
    if str(a.get("action", "")).lower() in names:
        return True
    if str(a.get("type", "")).lower() == "skill_write":
        return True
    meta = a.get("metadata") or {}
    if str(meta.get("kind", "")).lower() == "skill":
        return True
    path = str((a.get("arguments") or {}).get("path", ""))
    if path.endswith("SKILL.md") or ".praisonai/skills/" in path:
        return True
    return False


def diff_lines(before: str, after: str) -> list[tuple[str, str]]:
    a = before.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    b = after.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    n, m = len(a), len(b)
    lcs = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            lcs[i][j] = (
                lcs[i + 1][j + 1] + 1
                if a[i] == b[j]
                else max(lcs[i + 1][j], lcs[i][j + 1])
            )
    out: list[tuple[str, str]] = []
    i = j = 0
    while i < n and j < m:
        if a[i] == b[j]:
            out.append(("ctx", a[i]))
            i += 1
            j += 1
        elif lcs[i + 1][j] >= lcs[i][j + 1]:
            out.append(("del", a[i]))
            i += 1
        else:
            out.append(("add", b[j]))
            j += 1
    while i < n:
        out.append(("del", a[i]))
        i += 1
    while j < m:
        out.append(("add", b[j]))
        j += 1
    return out


class TestSkillPredicate:
    def test_r1_tool_name(self):
        assert is_skill_approval({"tool_name": "write_skill"})
        assert is_skill_approval({"tool_name": "Create_Skill"})

    def test_r2_action(self):
        assert is_skill_approval({"action": "save_skill"})

    def test_r3_type(self):
        assert is_skill_approval({"type": "skill_write"})

    def test_r4_metadata_kind(self):
        assert is_skill_approval({"metadata": {"kind": "skill"}})

    def test_r5_path(self):
        assert is_skill_approval({"arguments": {"path": "x/y/SKILL.md"}})
        assert is_skill_approval({"arguments": {"path": ".praisonai/skills/z/x"}})

    def test_non_skill_rejected(self):
        assert not is_skill_approval({"tool_name": "run_shell"})
        assert not is_skill_approval({"arguments": {"path": "notes.txt"}})
        assert not is_skill_approval({})


class TestDiffLines:
    def test_add_and_delete_counts(self):
        rows = diff_lines("a\nb\nc", "a\nx\nc")
        adds = [r for r in rows if r[0] == "add"]
        dels = [r for r in rows if r[0] == "del"]
        ctx = [r for r in rows if r[0] == "ctx"]
        assert len(adds) == 1 and adds[0][1] == "x"
        assert len(dels) == 1 and dels[0][1] == "b"
        assert len(ctx) == 2

    def test_new_skill_additions(self):
        rows = diff_lines("", "line1\nline2")
        assert any(r[0] == "add" and r[1] == "line1" for r in rows)
        assert any(r[0] == "add" and r[1] == "line2" for r in rows)

    def test_crlf_normalised(self):
        rows = diff_lines("a\r\nb", "a\nb")
        assert all(r[0] == "ctx" for r in rows)

    def test_hundred_line_diff(self):
        before = "\n".join(f"l{i}" for i in range(100))
        after = "\n".join(("CHANGED" if i == 50 else f"l{i}") for i in range(100))
        rows = diff_lines(before, after)
        assert any(r[0] == "add" and r[1] == "CHANGED" for r in rows)
        assert any(r[0] == "del" and r[1] == "l50" for r in rows)
