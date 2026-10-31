param(
  [switch]$DisableLegacyTasks
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$Root = "C:\dev\alpha-engine"
$Runs = Join-Path $Root "worker\.runs"
New-Item -ItemType Directory -Force -Path $Runs | Out-Null

$Action = "cmd /c cd /d $Root && npx tsx worker\operations-scheduler.mts >> worker\.runs\operations-scheduler.log 2>&1"
schtasks /Create /TN "AlphaEngine-Operations-Scheduler" /SC ONLOGON /TR $Action /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create AlphaEngine-Operations-Scheduler (exit $LASTEXITCODE)"
}

if ($DisableLegacyTasks) {
  foreach ($Name in @("AlphaEngine-Stocktwits", "AlphaEngine-GDELT", "AlphaEngine-Digest")) {
    schtasks /Query /TN $Name *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Legacy task not present, skipping: $Name"
      continue
    }
    schtasks /Change /TN $Name /DISABLE | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not disable legacy task $Name (exit $LASTEXITCODE)"
    }
  }
}

Write-Host "Installed AlphaEngine-Operations-Scheduler (ONLOGON)."
Write-Host "Start now: schtasks /Run /TN AlphaEngine-Operations-Scheduler"
Write-Host "Status:    schtasks /Query /TN AlphaEngine-Operations-Scheduler /V /FO LIST"
Write-Host "Open UI:   http://127.0.0.1:3000/workers"
if (-not $DisableLegacyTasks) {
  Write-Warning "Legacy tasks were not changed. Re-run with -DisableLegacyTasks before enabling overlapping jobs in the new scheduler."
}
