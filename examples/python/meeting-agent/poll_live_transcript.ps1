# Poll live transcript for a meeting (Part B dev test).
# Usage:
#   .\poll_live_transcript.ps1
#   .\poll_live_transcript.ps1 -MeetingId "aecf34bc-7194-4123-9c67-a298b56011da"
#   .\poll_live_transcript.ps1 -IntervalSec 2

param(
    [string]$MeetingId = "",
    [int]$Port = 8000,
    [int]$IntervalSec = 3
)

$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:$Port"

if (-not $MeetingId) {
    $meetings = Invoke-RestMethod -Uri "$base/api/meetings"
    $live = $meetings.meetings | Where-Object { @("live","joining","waiting_room") -contains ($_.live_status).ToLower() } | Select-Object -First 1
    if ($live) {
        $MeetingId = $live.id
    } elseif ($meetings.meetings.Count -gt 0) {
        $MeetingId = $meetings.meetings[0].id
    } else {
        throw "No meetings found. Schedule a bot first."
    }
}

$url = "$base/api/meetings/$MeetingId/live-transcript"

Write-Host "Polling $url every ${IntervalSec}s (Ctrl+C to stop)"
Write-Host ""

$lastCount = -1
$lastText = ""

while ($true) {
    try {
        $r = Invoke-RestMethod -Uri $url -TimeoutSec 10
        $count = [int]$r.line_count
        $status = $r.live_status
        $text = [string]$r.transcript

        if ($count -ne $lastCount -or $text -ne $lastText) {
            $ts = Get-Date -Format "HH:mm:ss"
            Write-Host "[$ts] live_status=$status  lines=$count"
            if ($text) {
                Write-Host "---"
                Write-Host $text
                Write-Host "---"
            } else {
                Write-Host "(empty transcript)"
            }
            Write-Host ""
            $lastCount = $count
            $lastText = $text
        }
    } catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervalSec
}
