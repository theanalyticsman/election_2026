# Downloads MEDSL (Harvard Dataverse) source files into data/raw.
# Dataverse requires a guestbook response; set DV_NAME and DV_EMAIL before running.
$ErrorActionPreference = 'Stop'
$raw = Join-Path $PSScriptRoot '..\data\raw'
$files = [ordered]@{
  'countypres_2000-2024.tab' = 13573089
  'senate_county_2022.tab'   = 7412054
  'senate_precinct_2016.tab' = 3345325
  'senate_precinct_2018.tab' = 6692658
  'senate_precinct_2020.tab' = 6100391
  'senate_precinct_2024.tab' = 13731184
  'house_precinct_2016.tab'  = 6412765
  'house_precinct_2018.tab'  = 6692624
  'house_precinct_2020.tab'  = 13582893
  'house_precinct_2022.tab'  = 13996912
  'house_precinct_2024.tab'  = 13731101
}
$body = @{ guestbookResponse = @{ name = $env:DV_NAME; email = $env:DV_EMAIL; institution = 'N/A'; position = 'N/A'; answers = @() } } | ConvertTo-Json -Depth 5
$tmp = New-TemporaryFile; Set-Content -Path $tmp -Value $body -Encoding ascii
foreach ($f in $files.GetEnumerator()) {
  $out = Join-Path $raw $f.Key
  if ((Test-Path $out) -and (Get-Item $out).Length -gt 1000) { "skip $($f.Key)"; continue }
  $r = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "https://dataverse.harvard.edu/api/access/datafile/$($f.Value)?gbrecs=true" | ConvertFrom-Json
  curl.exe -sSL -o $out $r.data.signedUrl
  "done $($f.Key) $([math]::Round((Get-Item $out).Length/1MB,1))MB"
}
Remove-Item $tmp
