# Fetches South Carolina's official results every 10 minutes and loads them to Supabase.
# Run from the project folder in PowerShell:  .\scripts\loop_sc.ps1   (Ctrl+C to stop)
# Needs this PC awake and the Supabase CLI logged in / linked (the same setup as load_supabase.py).
param([int]$Minutes = 10)
$env:SKIP_MIGRATIONS = "1"
Set-Location (Split-Path $PSScriptRoot -Parent)
while ($true) {
    Write-Host ("[{0}] fetching South Carolina..." -f (Get-Date -Format "HH:mm:ss"))
    python -I scripts/fetch_sc.py
    Start-Sleep -Seconds ($Minutes * 60)
}
