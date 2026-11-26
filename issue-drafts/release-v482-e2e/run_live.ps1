# Run after: $env:OPENAI_API_KEY = 'sk-...'  (never commit)
$ErrorActionPreference = 'Stop'
if (-not $env:OPENAI_API_KEY) { throw 'OPENAI_API_KEY is not set in this shell.' }
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$script = Join-Path $PSScriptRoot 'live_sdk_validation_v482.py'
& $py $script