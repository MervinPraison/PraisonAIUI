# Start voice-agent + Cloudflare tunnel for provider webhook URL.
# Usage: .\start_dev.ps1
#        .\start_dev.ps1 -Restart   # kill old app and reload code

param(
    [int]$Port = 8001,
    [switch]$Restart
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
        $key = $key.Trim()
        if ($key -and -not [string]::IsNullOrWhiteSpace($key)) {
            Set-Item -Path "Env:$key" -Value $value.Trim()
        }
    }
}

function Test-AppHttpReady([int]$p) {
    foreach ($path in @("/health/live", "/health", "/api/voice/config")) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p$path" -UseBasicParsing -TimeoutSec 15
            if ($r.StatusCode -eq 200) { return $true }
        } catch { continue }
    }
    return $false
}

function Test-TcpPortListening([int]$p) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { return $true }
    } catch { }
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $p, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(500)
        if ($ok -and $client.Connected) {
            $client.Close()
            return $true
        }
        $client.Close()
    } catch { }
    return $false
}

function Wait-PortReleased([int]$p, [int]$maxSec = 20) {
    $deadline = (Get-Date).AddSeconds($maxSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-TcpPortListening $p)) { return $true }
        Start-Sleep -Seconds 1
    }
    return -not (Test-TcpPortListening $p)
}

function Stop-PortProcess([int]$p) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            if ($conn.OwningProcess) {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
        if ($conns) {
            Start-Sleep -Seconds 2
            Write-Host "Stopped previous process on port $p"
        }
    } catch { }
}

function Clear-LogFile([string]$path) {
    if (-not (Test-Path $path)) { return }
    try {
        Remove-Item $path -Force -ErrorAction Stop
    } catch {
        try { Clear-Content $path -ErrorAction SilentlyContinue } catch { }
    }
}

function Start-VoiceApp([int]$p) {
    Write-Host "Starting voice-agent on port $p..."
    Stop-PortProcess $p
    $appLog = Join-Path $Root ".app.log"
    $appErr = Join-Path $Root ".app.err"
    Clear-LogFile $appLog
    Clear-LogFile $appErr
    Start-Process -FilePath "py" -ArgumentList "-3.13", "app.py" -WorkingDirectory $Root -WindowStyle Minimized `
        -RedirectStandardOutput $appLog -RedirectStandardError $appErr
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        if (Test-AppHttpReady $p) { break }
        Start-Sleep -Seconds 3
    }
    if (-not (Test-AppHttpReady $p)) {
        $errText = ""
        if (Test-Path $appErr) { $errText = Get-Content $appErr -Raw -ErrorAction SilentlyContinue }
        if ($errText -match "Uvicorn running") {
            Write-Host "Server process up — waiting for HTTP endpoints..."
            Start-Sleep -Seconds 10
        }
    }
    if (-not (Test-AppHttpReady $p)) {
        if (Test-Path $appErr) {
            Write-Host "App startup log:" -ForegroundColor Red
            Get-Content $appErr -Tail 20 | ForEach-Object { Write-Host $_ }
        }
        throw "App did not become ready on http://127.0.0.1:$p"
    }
    Write-Host "App ready: http://127.0.0.1:$p"
}

function Get-CloudflaredPidFile([string]$suffix) {
    return Join-Path $Root ".cloudflared$suffix.pid"
}

function Stop-CloudflaredForSuffix([string]$suffix) {
    $pidFile = Get-CloudflaredPidFile $suffix
    try {
        if (Test-Path $pidFile) {
            $procId = [int](Get-Content $pidFile -Raw).Trim()
            if ($procId) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    } catch { }
}

function Stop-CloudflaredTunnel {
    Stop-CloudflaredForSuffix ""
}

function Test-TunnelUrl([string]$baseUrl, [int]$retries = 2) {
    if (-not $baseUrl) { return $false }
    for ($i = 0; $i -lt $retries; $i++) {
        try {
            $null = Invoke-WebRequest -Uri "$baseUrl/api/voice/config" -UseBasicParsing -TimeoutSec 8
            return $true
        } catch {
            if ($i -lt ($retries - 1)) { Start-Sleep -Seconds 2 }
        }
    }
    return $false
}

function Test-SpeechTunnelUrl([string]$baseUrl, [int]$retries = 12) {
    if (-not $baseUrl) { return $false }
    $paths = @("", "/ws")
    for ($i = 0; $i -lt $retries; $i++) {
        foreach ($path in $paths) {
            $uri = if ($path) { "$baseUrl$path" } else { $baseUrl }
            try {
                $null = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
                return $true
            } catch {
                $code = $null
                try {
                    if ($_.Exception.Response) {
                        $code = [int]$_.Exception.Response.StatusCode
                    }
                } catch { }
                # Sidecar returns 404 on / — that still means the tunnel is up.
                if ($code -and $code -ge 200 -and $code -lt 500) {
                    return $true
                }
            }
        }
        if ($i -lt ($retries - 1)) {
            Write-Host "  Speech tunnel not ready yet (attempt $($i + 1)/$retries)..."
            Start-Sleep -Seconds 3
        }
    }
    return $false
}

function Update-EnvValue([string]$key, [string]$value) {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) { return }
    $lines = Get-Content $envFile
    $updated = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match "^\s*$key=") {
            $updated = $true
            "$key=$value"
        } else { $line }
    }
    if (-not $updated) { $newLines += "$key=$value" }
    Set-Content -Path $envFile -Value ($newLines -join "`n")
    Set-Item -Path "Env:$key" -Value $value
}

function Start-SpeechSidecar([int]$p = 8002, [switch]$Force) {
    if ((Test-TcpPortListening $p) -and -not $Force) {
        Write-Host "Speech Engine sidecar already listening on port $p"
        return
    }
    Write-Host "Starting Speech Engine sidecar on port $p..."
    Stop-PortProcess $p
    if (-not (Wait-PortReleased $p)) {
        Write-Host "Port $p still in use — forcing stop again..." -ForegroundColor Yellow
        Stop-PortProcess $p
        Start-Sleep -Seconds 3
    }
    $log = Join-Path $Root ".speech-sidecar.log"
    $logErr = "${log}.err"
    Clear-LogFile $log
    Clear-LogFile $logErr
    $env:PYTHONUNBUFFERED = "1"
    Start-Process -FilePath "py" -ArgumentList "-3.13", "-u", "speech_engine_sidecar.py" `
        -WorkingDirectory $Root -WindowStyle Minimized `
        -RedirectStandardOutput $log -RedirectStandardError $logErr
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPortListening $p) {
            Write-Host "Speech Engine sidecar ready on port $p"
            return
        }
        if (Test-Path $log) {
            $tail = Get-Content $log -Tail 1 -ErrorAction SilentlyContinue
            if ($tail) { Write-Host "  $tail" }
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "Sidecar logs:" -ForegroundColor Red
    if (Test-Path $log) {
        Get-Content $log -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $logErr) {
        Get-Content $logErr -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    throw "Speech Engine sidecar did not start on port $p (ElevenLabs API fetch can take up to 90s — check .speech-sidecar.log)"
}

function Start-CloudflaredTunnel([int]$p, [string]$logSuffix = "") {
    Write-Host "Starting Cloudflare tunnel for port $p..."
    $log = Join-Path $Root ".tunnel$logSuffix.log"
    $logErr = "${log}.err"
    Stop-CloudflaredForSuffix $logSuffix
    Clear-LogFile $log
    Clear-LogFile $logErr
    $proc = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://127.0.0.1:$p" `
        -RedirectStandardOutput $log -RedirectStandardError $logErr -WindowStyle Minimized -PassThru
    if ($proc -and $proc.Id) {
        Set-Content -Path (Get-CloudflaredPidFile $logSuffix) -Value $proc.Id
    }
    $deadline = (Get-Date).AddSeconds(90)
    $newUrl = $null
    while ((Get-Date) -lt $deadline -and -not $newUrl) {
        Start-Sleep -Seconds 2
        foreach ($path in @($logErr, $log)) {
            if (-not (Test-Path $path)) { continue }
            $match = Select-String -Path $path -Pattern "https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com" | Select-Object -First 1
            if ($match) {
                $newUrl = $match.Matches[0].Value
                break
            }
        }
    }
    if (-not $newUrl) { throw "Could not read tunnel URL from $logErr" }
    if ($logSuffix) {
        Write-Host "Tunnel ready ($logSuffix): $newUrl"
    } else {
        Update-PublicUrl $newUrl
        Write-Host "Tunnel ready: $newUrl"
    }
    return $newUrl
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

function Ensure-ServerSecret {
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) { return }
    $lines = Get-Content $envFile
    $secret = $env:VOICE_SERVER_URL_SECRET
    foreach ($line in $lines) {
        if ($line -match '^\s*VOICE_SERVER_URL_SECRET=(.+)$') {
            $secret = $Matches[1].Trim()
            break
        }
    }
    if (-not $secret) {
        $secret = [guid]::NewGuid().ToString()
        $updated = $false
        $newLines = foreach ($line in $lines) {
            if ($line -match '^\s*VOICE_SERVER_URL_SECRET=') {
                $updated = $true
                "VOICE_SERVER_URL_SECRET=$secret"
            } else { $line }
        }
        if (-not $updated) { $newLines += "VOICE_SERVER_URL_SECRET=$secret" }
        Set-Content -Path $envFile -Value ($newLines -join "`n")
        Write-Host "Generated VOICE_SERVER_URL_SECRET in .env"
    }
    $env:VOICE_SERVER_URL_SECRET = $secret
}

function Show-ProviderSetupSteps([string]$webhookUrl, [string]$secret) {
    Write-Host ""
    Write-Host "=== Provider webhook setup (Assistant -> Advanced -> Webhook Server) ===" -ForegroundColor Cyan
    Write-Host "Webhook URL:"
    Write-Host "  $webhookUrl"
    Write-Host ""
    Write-Host "Secret header:"
    Write-Host "  Name: X-Voice-Webhook-Secret"
    Write-Host "  Value: $secret"
    Write-Host "================================================================" -ForegroundColor Cyan
}

Load-DotEnv
Ensure-ServerSecret
$env:VOICE_AGENT_PORT = "$Port"

$needsRestart = $Restart.IsPresent
if (Test-TcpPortListening $Port) {
    if ($needsRestart) {
        Stop-PortProcess $Port
    } else {
        try {
            $cfg = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/voice/config" -TimeoutSec 3
            if (-not $cfg.webhook_url -and $env:PUBLIC_API_BASE_URL) {
                Write-Host "App running but missing webhook URL — restarting to reload .env"
                $needsRestart = $true
                Stop-PortProcess $Port
            } else {
                Write-Host "App already running on port $Port"
            }
        } catch {
            Write-Host "App already running on port $Port"
        }
    }
}

$public = $env:PUBLIC_API_BASE_URL
$mainTunnelRecreated = $false
if (Test-TunnelUrl $public) {
    Write-Host "Tunnel OK: $public"
} else {
    $null = Start-CloudflaredTunnel $Port
    $mainTunnelRecreated = $true
}
if ($needsRestart -or -not (Test-TcpPortListening $Port)) {
    Start-VoiceApp $Port
} elseif ($mainTunnelRecreated) {
    Write-Host "Main tunnel URL changed — restarting app to reload .env"
    Stop-PortProcess $Port
    Start-VoiceApp $Port
}

$config = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/voice/config"
Write-Host "Voice configured: $($config.configured)"
Write-Host "Webhook URL: $($config.webhook_url)"
$webhook = if ($config.webhook_url) { $config.webhook_url } else { "$($env:PUBLIC_API_BASE_URL)/webhooks/voice" }

Write-Host ""
Write-Host "Configuring voice provider via API..." -ForegroundColor Cyan
py -3.13 setup_voice_provider.py
if ($LASTEXITCODE -eq 0) {
    Write-Host "Voice provider auto-configured (tools + webhook URL + auth)." -ForegroundColor Green
} else {
    Show-ProviderSetupSteps -webhookUrl $webhook -secret $env:VOICE_SERVER_URL_SECRET
}

if ($env:ELEVENLABS_API_KEY) {
    Write-Host ""
    $speechSidecarOk = Test-TcpPortListening 8002
    $speechTunnelOk = Test-SpeechTunnelUrl $env:SPEECH_ENGINE_PUBLIC_URL
    if (-not $speechTunnelOk) {
        Write-Host "Speech tunnel down — starting sidecar + new Cloudflare tunnel..." -ForegroundColor Cyan
        Start-SpeechSidecar 8002 -Force
        $speechTunnel = Start-CloudflaredTunnel 8002 "-speech"
        Update-EnvValue "SPEECH_ENGINE_PUBLIC_URL" $speechTunnel
        Write-Host "Speech Engine tunnel: $speechTunnel"
        Write-Host "Waiting for speech tunnel to accept connections..."
        Start-Sleep -Seconds 5
        Write-Host "Configuring ElevenLabs Speech Engine..." -ForegroundColor Cyan
        py -3.13 setup_speech_engine.py
        if ($LASTEXITCODE -ne 0) {
            throw "Speech Engine setup failed — run: py -3.13 setup_speech_engine.py"
        }
        Write-Host "Speech Engine configured (WebSocket /ws + browser token)." -ForegroundColor Green
        Load-DotEnv
        Stop-PortProcess $Port
        Start-VoiceApp $Port
    } elseif ($Restart.IsPresent -or -not $speechSidecarOk) {
        Write-Host "Restarting speech sidecar to reload code (keeping existing tunnel)..." -ForegroundColor Yellow
        Start-SpeechSidecar 8002 -Force
    } else {
        Write-Host "Speech stack OK (sidecar :8002 + tunnel reachable)" -ForegroundColor Green
    }
    if (-not (Test-TcpPortListening 8002)) {
        throw "Speech Engine sidecar not listening on 8002"
    }
    Load-DotEnv
    if (-not (Test-SpeechTunnelUrl $env:SPEECH_ENGINE_PUBLIC_URL)) {
        Write-Host ""
        Write-Host "WARNING: Speech Engine tunnel not reachable yet: $($env:SPEECH_ENGINE_PUBLIC_URL)" -ForegroundColor Yellow
        Write-Host "Local dashboard is up at http://127.0.0.1:$Port — wait ~30s, then retry ElevenLabs talk." -ForegroundColor Yellow
        Write-Host "If it still fails, run: .\start_dev.ps1 -Restart" -ForegroundColor Yellow
    } else {
        Write-Host "Speech sidecar: port 8002 | ws_url wss://$($env:SPEECH_ENGINE_PUBLIC_URL -replace 'https://','')/ws"
    }
}

Write-Host "Done. Dashboard: http://127.0.0.1:$Port"
Write-Host "ElevenLabs talk: http://127.0.0.1:$Port/eleven-talk"
Write-Host "Keep this window open — sidecar + tunnels run in the background."
