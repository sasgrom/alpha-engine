# Home production deployment: review, build and optional server start.
# No force-push, hard reset, generated-file commits or raw-data uploads.
param(
  [switch]$Apply,
  [switch]$StartServer
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Step([string]$Name, [scriptblock]$Body) {
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  & $Body
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}
function Invoke-Info([string]$Name, [scriptblock]$Body) {
  Write-Host "`n==> $Name" -ForegroundColor DarkCyan
  & $Body
  $global:LASTEXITCODE = 0
}

Write-Host "Alpha Engine home production deploy" -ForegroundColor Green
Write-Host "Root: $root"
Write-Host "Mode: $($Apply ? 'APPLY' : 'DRY RUN')"
Write-Host "No raw data upload, no generated-file commit, no force-push, no reset."

if (-not $Apply) {
  Write-Host "`nPlanned steps: readiness → pull/rebase → install → check → tests → build → reports → QA → health check."
  Write-Host "Run with -Apply. Add -StartServer to install/start the hidden production server on port 3000."
  exit 0
}

Invoke-Info "Current readiness" { npx tsx scripts/production-readiness.mts }
Invoke-Step "Preflight: main branch and clean worktree" {
  $branch = git branch --show-current
  if ($branch -ne "main") { throw "Expected main, got $branch" }
  $dirty = git status --short
  if ($dirty) { throw "Working tree is not clean. Commit or stash code changes before deployment.`n$dirty" }
}
Invoke-Step "Fast-forward review" {
  git pull --rebase origin main
  if ($LASTEXITCODE -ne 0) { throw "git pull --rebase failed. Resolve it manually; do not reset." }
}
Invoke-Step "Dependencies" { npm install --no-audit --no-fund }
Invoke-Step "TypeScript" { npm run check }
Invoke-Step "Tests" { npm test -- --reporter=dot }
Invoke-Step "Production build" { npm run build }
Invoke-Step "Pilot exposure evidence" { npx tsx scripts/build-pilot-exposure-evidence.mts }
Invoke-Step "Company exposure evidence" { npx tsx scripts/build-company-exposure.mts --universe research-universe-51.json }
Invoke-Step "Macro scenarios" { npx tsx scripts/build-macro-scenarios.mts --macro-root D:\research\alpha-engine\macro }
Invoke-Step "Manifest QA" { npx tsx worker/macro-manifest-qa.mts --root D:\research\alpha-engine\macro }
Invoke-Step "Final readiness" { npx tsx scripts/production-readiness.mts }

if ($StartServer) {
  Invoke-Step "Hidden production server" {
    & "$root\worker\home-server-install.ps1"
    $deadline = (Get-Date).AddSeconds(45)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/scenario-lab" -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw "Production server did not return HTTP 200 on /scenario-lab. Inspect worker\.runs\home-server.log." }
    Write-Host "Healthy: http://localhost:3000/scenario-lab" -ForegroundColor Green
  }
}

Write-Host "`nHome production deploy complete." -ForegroundColor Green
