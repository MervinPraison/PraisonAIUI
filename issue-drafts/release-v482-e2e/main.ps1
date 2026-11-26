# Praison v4.8.2 — one-shot setup + verify (Connect + optional Ship probe).
#
# Run only this:
#   powershell -NoProfile -ExecutionPolicy Bypass -File main.ps1
#
# Requires: Python 3.10+ on PATH. Set OPENAI_API_KEY in your user env for MCP chat (optional here).
# For ship dry-run: gh auth login, and checkout a branch (not detached HEAD).

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (git -C $ScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $ScriptRoot '..\..')).Path }

$venvPy = Join-Path $ScriptRoot '.venv\Scripts\python.exe'
$venvPip = Join-Path $ScriptRoot '.venv\Scripts\pip.exe'
$praison = Join-Path $ScriptRoot '.venv\Scripts\praisonai.exe'

$warnings = @()
$failed = @()

function Note-Warn($msg) { $script:warnings += $msg; Write-Host "WARN: $msg" -ForegroundColor Yellow }
function Note-Fail($step, $msg) { $script:failed += $step; Write-Host "FAIL $step : $msg" -ForegroundColor Red }
function Note-Ok($step) { Write-Host "OK $step" -ForegroundColor Green }

Write-Host "`n=== Praison 4.8.2 setup (repo: $RepoRoot) ===" -ForegroundColor Cyan

# --- 1. Venv + packages ---
Write-Host "`n=== ensure venv ===" -ForegroundColor Cyan
if (-not (Test-Path $venvPy)) {
    Write-Host 'Creating .venv ...'
    python -m venv (Join-Path $ScriptRoot '.venv')
}
& $venvPy -m pip install -q -U pip
& $venvPip install -q 'praisonai==4.8.2' 'praisonaiagents'
if (-not (Test-Path $praison)) { Note-Fail 'venv' 'praisonai not installed'; exit 2 }
Note-Ok 'venv'

# --- 2. Versions ---
Write-Host "`n=== versions ===" -ForegroundColor Cyan
& $praison --version
& $venvPy -c "import praisonaiagents as a; print('praisonaiagents', a.__version__)"
Note-Ok 'versions'

if (-not $env:OPENAI_API_KEY) {
    Note-Warn 'OPENAI_API_KEY not set in this shell — set it for MCP/agent chat (User env or VS Code terminal env).'
}

# --- 3. Connect editors (write + verify) ---
foreach ($client in @('vscode', 'cursor')) {
    Write-Host "`n=== connect $client ===" -ForegroundColor Cyan
    try {
        $null = & $praison connect $client --verify 2>&1
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
        Note-Ok "connect $client"
    } catch {
        $out = $_.Exception.Message
        if ($client -eq 'cursor') {
            Note-Warn "connect $client skipped or failed ($out) — OK if Cursor not installed."
        } else {
            Note-Fail "connect $client" $out
        }
    }
}

Write-Host "`n=== connect status (json) ===" -ForegroundColor Cyan
& $praison connect --json

# --- 4. Workspace MCP (optional starter) ---
$mcpDir = Join-Path $RepoRoot '.praison\mcp'
if (-not (Test-Path $mcpDir)) {
    New-Item -ItemType Directory -Force -Path $mcpDir | Out-Null
    Write-Host "Created $mcpDir (use: praisonai mcp add ...)" -ForegroundColor DarkGray
}

Write-Host "`n=== mcp list (workspace) ===" -ForegroundColor Cyan
& $praison mcp list 2>&1 | ForEach-Object { Write-Host $_ }

# --- 5. Ship probe (scoped; non-fatal) ---
Write-Host "`n=== scoped ship dry-run ===" -ForegroundColor Cyan
$autoShip = Join-Path $ScriptRoot 'auto_ship.ps1'
if (Test-Path $autoShip) {
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $autoShip -DryRun 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Note-Warn 'scoped ship dry-run failed' }
        else { Note-Ok 'scoped ship dry-run' }
    } catch { Note-Warn "scoped ship: $($_.Exception.Message)" }
} else {
    Note-Warn 'auto_ship.ps1 missing — skip ship probe'
}

# --- Done ---
Write-Host "`n=== DONE — you verify in UI ===" -ForegroundColor Cyan
Write-Host @"
1. VS Code: Reload window. MCP config → $env:USERPROFILE\.copilot\mcp-config.json → server 'praisonai'
2. Cursor:  ~/.cursor/mcp.json should already include 'praisonai'
3. Chat:    Ask the agent to use a Praison MCP tool (after OPENAI_API_KEY is set)
4. Ship:    auto_ship.ps1 (scoped) — add -Apply for draft PR; avoid praisonai ship at repo root
"@

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
if ($failed.Count -gt 0) {
    Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
if ($warnings.Count -gt 0) {
    Write-Host "Warnings: $($warnings.Count) (setup still usable for Connect)" -ForegroundColor Yellow
}
Write-Host 'Setup complete.' -ForegroundColor Green
exit 0