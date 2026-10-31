$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$Root = "C:\dev\alpha-engine"
$Runs = Join-Path $Root "worker\.runs"
New-Item -ItemType Directory -Force -Path $Runs | Out-Null

if (-not (Test-Path (Join-Path $Root "dist\boot.js"))) {
  Write-Warning "dist\boot.js is missing. Run npm run build before installing the production server task."
  exit 1
}

$Action = "wscript.exe `"$Root\worker\home-server-hidden.vbs`""
schtasks /Create /TN "AlphaEngine-Home-Server" /SC ONLOGON /TR $Action /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create AlphaEngine-Home-Server (exit $LASTEXITCODE)"
}

Write-Host "Installed AlphaEngine-Home-Server (ONLOGON, hidden production process)."
Write-Host "Stop any existing dev/production server on port 3000, then start this one:"
Write-Host "schtasks /Run /TN AlphaEngine-Home-Server"
Write-Host "Health: curl.exe -I --max-time 10 http://127.0.0.1:3000/"
Write-Host "Log:    Get-Content worker\.runs\home-server.log -Tail 50"
Write-Host "Development mode remains manual: npm run dev (do not run both)."
