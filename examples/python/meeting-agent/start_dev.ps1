# Start meeting-agent (Part B) + Cloudflare tunnel for Recall webhooks.
# Usage: .\start_dev.ps1
# Optional: $env:TEST_MEETING_URL = "https://meet.google.com/..." ; .\start_dev.ps1 -ScheduleBot

param(
    [switch]$ScheduleBot,
    [string]$MeetingUrl = $env:TEST_MEETING_URL,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Load-DotEnv {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) { return }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") { return }
        $key, $value = $line -split "=", 2
        if ($key -and -not [string]::IsNullOrWhiteSpace($key) -and -not (Get-Item "Env:$key" -ErrorAction SilentlyContinue)) {
            Set-Item -Path "Env:$key" -Value $value.Trim()
        }
    }
}

function Test-PortListening([int]$p) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/recall/config" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Update-PublicUrl([string]$baseUrl) {
    $envFile = Join-Path $Root ".env"
    $content = Get-Content $envFile -Raw
    if ($content -match "PUBLIC_API_BASE_URL=.*") {
        $newContent = $content -replace "PUBLIC_API_BASE_URL=.*", "PUBLIC_API_BASE_URL=$baseUrl"
    } else {
        $newContent = $content.TrimEnd() + "`nPUBLIC_API_BASE_URL=$baseUrl`n"
    }
    Set-Content -Path $envFile -Value $newContent -NoNewline
    $env:PUBLIC_API_BASE_URL = $baseUrl
    Write-Host "Updated .env PUBLIC_API_BASE_URL=$baseUrl"
}

Load-DotEnv
$env:MEETING_AGENT_PORT = "$Port"

if (-not (Test-PortListening $Port)) {
    Write-Host "Starting meeting-agent on port $Port..."
    Start-Process -FilePath "py" -ArgumentList "-3.13", "app.py" -WorkingDirectory $Root -WindowStyle Minimized
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening $Port) { break }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-PortListening $Port)) {
        throw "App did not become ready on http://127.0.0.1:$Port"
    }
    Write-Host "App ready: http://127.0.0.1:$Port"
} else {
    Write-Host "App already running on port $Port"
}

$public = $env:PUBLIC_API_BASE_URL
try {
    $null = Invoke-WebRequest -Uri "$public/api/recall/config" -UseBasicParsing -TimeoutSec 5
    Write-Host "Tunnel OK: $public"
} catch {
    Write-Host "Starting Cloudflare tunnel (quick tunnel - URL may change)..."
    $log = Join-Path $Root ".tunnel.log"
    $logErr = "${log}.err"
    if (Test-Path $log) { Remove-Item $log -Force }
    if (Test-Path $logErr) { Remove-Item $logErr -Force }
    Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://127.0.0.1:$Port" `
        -RedirectStandardOutput $log -RedirectStandardError $logErr -WindowStyle Minimized
    $deadline = (Get-Date).AddSeconds(90)
    $newUrl = $null
    while ((Get-Date) -lt $deadline -and -not $newUrl) {
        Start-Sleep -Seconds 2
        foreach ($path in @($logErr, $log)) {
            if (-not (Test-Path $path)) { continue }
            $match = Select-String -Path $path -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($match) {
                $newUrl = $match.Matches[0].Value
                break
            }
        }
    }
    if (-not $newUrl) { throw "Could not read tunnel URL from $logErr (or $log). Check cloudflared is installed." }
    Update-PublicUrl $newUrl
    Write-Host "Tunnel ready: $newUrl"
    Write-Host "If Recall webhook URL changed, update it in Recall dashboard Webhooks"
}

$config = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/recall/config"
Write-Host "Recall configured: $($config.configured)"

if ($ScheduleBot) {
    if (-not $MeetingUrl) {
        Write-Host "No TEST_MEETING_URL - skip bot schedule. Set env TEST_MEETING_URL or pass -MeetingUrl"
    } else {
        $body = @{ meeting_url = $MeetingUrl; title = "Part B live transcript test" } | ConvertTo-Json
        $result = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/recall/bots" `
            -ContentType "application/json" -Body $body
        Write-Host "Bot scheduled:" ($result | ConvertTo-Json -Compress)
    }
}

Write-Host "Done. Dashboard: http://127.0.0.1:$Port"
