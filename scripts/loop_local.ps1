# Fetches the states that only answer from your own PC (South Carolina, Iowa and civicAPI's competitive states) every 10 minutes and loads them to Supabase.
# Run from the project folder in PowerShell:  .\scripts\loop_local.ps1   (Ctrl+C to stop)
# Needs this PC awake and the Supabase CLI logged in / linked (the same setup as load_supabase.py).
param([int]$Minutes = 10)
$env:SKIP_MIGRATIONS = "1"
Set-Location (Split-Path $PSScriptRoot -Parent)
while ($true) {
    Write-Host ("[{0}] South Carolina..." -f (Get-Date -Format "HH:mm:ss"))
    python -I scripts/fetch_sc.py
    Write-Host ("[{0}] Iowa..." -f (Get-Date -Format "HH:mm:ss"))
    python -I scripts/import_ia.py --download
    Write-Host ("[{0}] civicAPI (FL SC IA TX ME MI MN NE KS)..." -f (Get-Date -Format "HH:mm:ss"))
    python -I scripts/fetch_civic.py
    Start-Sleep -Seconds ($Minutes * 60)
}
