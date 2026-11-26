# Legacy verifier — prefer main.ps1 (full auto setup).
# Usage:
#   powershell -File main.ps1
#   powershell -File verify_connect_ship.ps1
#   powershell -File verify_connect_ship.ps1 -ApplyConnect   # writes VS Code MCP config + verify
#   powershell -File verify_connect_ship.ps1 -Ship            # real ship (needs gh + feature branch)
param(
    [switch]$ApplyConnect,
    [switch]$Ship
)

$ErrorActionPreference = 'Continue'
$failed = @()

function Step($name, [scriptblock]$block) {
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
    try {
        & $block
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
        Write-Host "OK $name" -ForegroundColor Green
    } catch {
        Write-Host "FAIL $name : $_" -ForegroundColor Red
        $script:failed += $name
    }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root '.venv\Scripts\python.exe'
$praison = Join-Path $root '.venv\Scripts\praisonai.exe'
if (-not (Test-Path $praison)) {
    $praison = (Get-Command praisonai -ErrorAction SilentlyContinue).Source
    $py = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $praison) { Write-Error 'praisonai not found (activate 4.8.2 venv or install praisonai==4.8.2)'; exit 2 }

Step 'versions' {
    & $praison --version
    & $py -c "import praisonaiagents as a; print('praisonaiagents', a.__version__)"
}

Step 'connect status' {
    & $praison connect --json | Out-String | Write-Host
}

Step 'connect print vscode' {
    & $praison connect --print vscode
}

Step 'connect dry-run vscode' {
    & $praison connect --dry-run vscode
}

if ($ApplyConnect) {
    Step 'connect apply vscode' {
        & $praison connect vscode --verify
    }
} else {
    Write-Host "`n(skip) connect apply — pass -ApplyConnect to write MCP config" -ForegroundColor DarkGray
}

Step 'mcp list' {
    & $praison mcp list 2>&1 | Write-Host
}

Step 'ship dry-run' {
    Push-Location (Get-Location)
    try {
        $branch = git rev-parse --abbrev-ref HEAD 2>$null
        if (-not $branch) { throw 'not a git repo' }
        & $praison ship --dry-run 2>&1 | Write-Host
    } finally { Pop-Location }
}

if ($Ship) {
    Step 'ship live' {
        & $praison ship 2>&1 | Write-Host
    }
} else {
    Write-Host "`n(skip) ship live — pass -Ship on a feature branch with gh auth" -ForegroundColor DarkGray
}

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host 'All automated steps passed.' -ForegroundColor Green
    exit 0
}
Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red
exit 1