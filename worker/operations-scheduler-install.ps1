param(
  [switch]$DisableLegacyTasks
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$Root = "C:\dev\alpha-engine"
$Runs = Join-Path $Root "worker\.runs"
New-Item -ItemType Directory -Force -Path $Runs | Out-Null

$Action = "wscript.exe `"$Root\worker\operations-scheduler-hidden.vbs`""
schtasks /Create /TN "AlphaEngine-Operations-Scheduler" /SC ONLOGON /TR $Action /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create AlphaEngine-Operations-Scheduler (exit $LASTEXITCODE)"
}

if ($DisableLegacyTasks) {
  foreach ($Name in @("AlphaEngine-Stocktwits", "AlphaEngine-GDELT", "AlphaEngine-Digest")) {
    $LegacyTask = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($null -eq $LegacyTask) {
      Write-Host "Legacy task not present, skipping: $Name"
      continue
    }
    try {
      Disable-ScheduledTask -InputObject $LegacyTask -ErrorAction Stop | Out-Null
      Write-Host "Disabled legacy task: $Name"
    }
    catch {
      Write-Warning "Could not disable legacy task ${Name}: $($_.Exception.Message)"
    }
  }
}

Write-Host "Installed AlphaEngine-Operations-Scheduler (ONLOGON, hidden process)."
Write-Host "Start now: schtasks /Run /TN AlphaEngine-Operations-Scheduler"
Write-Host "Status:    schtasks /Query /TN AlphaEngine-Operations-Scheduler /V /FO LIST"
Write-Host "Open UI:   http://127.0.0.1:3000/workers"
if (-not $DisableLegacyTasks) {
  Write-Warning "Legacy tasks were not changed. Re-run with -DisableLegacyTasks before enabling overlapping jobs in the new scheduler."
}
