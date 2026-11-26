# Scoped draft PR — safe alternative to `praisonai ship` on a dirty monorepo.
# `praisonai ship` runs `git add -A`; this commits only listed paths.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto_ship.ps1           # dry-run
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto_ship.ps1 -Apply  # push + draft PR
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto_ship.ps1 -UsePraisonShip -DryRun  # full tree probe

param(
    [switch]$Apply,
    [switch]$DryRun,
    [switch]$UsePraisonShip,
    [string]$Branch = 'test/ship-verify',
    [string[]]$Paths = @(
        '.gitignore',
        'issue-drafts/release-v482-e2e',
        'src/praisonaiui/features/channels.py'
    )
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = git -C $ScriptRoot rev-parse --show-toplevel
$praison = Join-Path $ScriptRoot '.venv\Scripts\praisonai.exe'

if (-not (Test-Path $praison)) {
    Write-Host 'Run main.ps1 first (creates .venv + praisonai 4.8.2).' -ForegroundColor Red
    exit 2
}

Push-Location $RepoRoot
try {
  gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'gh not logged in (gh auth login)' }

  $cur = git rev-parse --abbrev-ref HEAD
  $base = (gh repo view --json defaultBranchRef | ConvertFrom-Json).defaultBranchRef.name
  if ($cur -eq 'HEAD' -or -not $cur) {
    git switch -c $Branch 2>$null
    if ($LASTEXITCODE -ne 0) { git switch $Branch }
  } elseif ($cur -ne $Branch) {
    Write-Host "On branch $cur (scoped ship uses current branch; expected: $Branch)" -ForegroundColor Yellow
  }

  if ($UsePraisonShip) {
    $out = & $praison ship --dry-run 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      Write-Host $out
      exit 1
    }
    $fileLines = ($out -split "`n" | Where-Object { $_ -match '^\s{2}\S' }).Count
    Write-Host "praison ship would touch $fileLines paths." -ForegroundColor Cyan
    if ($fileLines -gt 50 -and -not $Apply) {
      Write-Host 'REFUSE: >50 paths — use scoped ship (default) or widen .gitignore.' -ForegroundColor Yellow
      exit 3
    }
    if ($Apply) {
      & $praison ship 2>&1 | ForEach-Object { Write-Host $_ }
      exit $LASTEXITCODE
    }
    Write-Host $out
    exit 0
  }

  $toStage = @()
  foreach ($p in $Paths) {
    if (-not (Test-Path (Join-Path $RepoRoot $p))) {
      Write-Host "SKIP missing: $p" -ForegroundColor DarkGray
      continue
    }
    $toStage += $p
  }
  if ($toStage.Count -eq 0) { throw 'No paths to stage' }

  $staged = @()
  foreach ($p in $toStage) {
    $staged += git ls-files --others --exclude-standard -- $p 2>$null
    $staged += git ls-files -m -- $p 2>$null
  }
  $staged = $staged | Where-Object { $_ } | Sort-Object -Unique
  $secrets = @()
  foreach ($f in $staged) {
    $leaf = [System.IO.Path]::GetFileName($f).ToLower()
    if ($leaf -match '\.(pem|key|pfx|p12)$' -or $leaf -match '^\.env' -or $leaf -match '\.env\.') {
      if ($leaf -notmatch '\.(example|sample|template)$') { $secrets += $f }
    }
  }
  if ($secrets.Count -gt 0) { throw "Secret-like staged files: $($secrets -join ', ')" }

  Write-Host "`n=== Scoped ship ($($staged.Count) files) ===" -ForegroundColor Cyan
  $staged | ForEach-Object { Write-Host "  $_" }

  $msg = @'
chore: gitignore local workspaces; v4.8.2 release E2E harness

- Ignore venvs, competitive-analysis, local E2E trees
- Add release-v482-e2e connect/ship scripts and live validation
'@

  if (-not $Apply -or $DryRun) {
    Write-Host "`nDry-run: would commit, push, open draft PR into $base" -ForegroundColor Green
    exit 0
  }

  git add -- $toStage
  git commit -m $msg
  $headBranch = git rev-parse --abbrev-ref HEAD
  $pushRemote = 'origin'
  git push -u $pushRemote HEAD 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) {
    if (git remote | Select-String -Pattern '^fork$') {
      $pushRemote = 'fork'
      git push -u $pushRemote HEAD 2>&1 | Out-Host
    }
  }
  if ($LASTEXITCODE -ne 0) { throw 'git push failed (check origin/fork permissions)' }

  $headRef = if ($pushRemote -eq 'fork') { "$((gh api user -q .login))/$(gh repo view $pushRemote --json name -q .name):$headBranch" } else { $headBranch }
  $url = gh pr create --draft --fill --base $base --head $headRef 2>&1
  if ($LASTEXITCODE -ne 0) {
    $view = gh pr view --json url 2>$null | ConvertFrom-Json
    if ($view.url) { Write-Host "PR: $($view.url)" -ForegroundColor Green; exit 0 }
    throw $url
  }
  Write-Host $url -ForegroundColor Green
} finally { Pop-Location }