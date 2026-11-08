param(
  [string]$Tickers = "",
  [string]$From = "",
  [switch]$DryRun,
  [switch]$StrictQa,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$expectedCodeRoot = "C:\dev\alpha-engine"
$codeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($codeRoot -ine $expectedCodeRoot) { throw "Canonical code root is $expectedCodeRoot; actual root is $codeRoot" }
if (-not $env:ALPHA_CACHE_ROOT) { $env:ALPHA_CACHE_ROOT = "D:\alpha-engine\worker\cache" }
if (-not $env:ALPHA_RUNS_ROOT) { $env:ALPHA_RUNS_ROOT = "D:\alpha-engine\worker\.runs" }
Write-Host "codeRoot = $codeRoot"
Write-Host "cacheRoot = $env:ALPHA_CACHE_ROOT"
Write-Host "runsRoot = $env:ALPHA_RUNS_ROOT"
Set-Location $codeRoot

$cParent = Join-Path $codeRoot "worker\cache"
$cCache = Join-Path $cParent "edgar-form4"
$dCache = Join-Path $env:ALPHA_CACHE_ROOT "edgar-form4"
function Test-LinkTarget([string]$Path, [string]$ExpectedTarget) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -notin @("Junction", "SymbolicLink")) { return $false }
  $target = @($item.Target)[0]
  return $target -and [IO.Path]::GetFullPath($target) -ieq [IO.Path]::GetFullPath($ExpectedTarget)
}

$parentItem = Get-Item -LiteralPath $cParent -Force
if ($parentItem.LinkType -in @("Junction", "SymbolicLink")) {
  if (-not (Test-LinkTarget $cParent $env:ALPHA_CACHE_ROOT)) {
    throw "worker\cache link target does not match ALPHA_CACHE_ROOT; no files were changed"
  }
  Write-Host "OK: single physical store via junction"
} elseif (Test-LinkTarget $cCache $dCache) {
  Write-Host "OK: single physical store via edgar-form4 junction"
} else {
  $dFiles = Get-ChildItem -LiteralPath $dCache -Recurse -File -Force -ErrorAction SilentlyContinue
  if ($dFiles.Count -gt 0) {
    throw "Split-brain detected: worker\cache is a normal directory and D cache contains files; no files were changed"
  }
  Write-Host "OK: empty cache start is allowed"
}

if (Get-Command git -ErrorAction SilentlyContinue) {
  $changes = git status --short
  if ($changes) { Write-Warning "Working tree is not clean; continuing without blocking the local MVP." }
}
foreach ($command in @("node", "npm", "npx")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required" }
}

$universeArgs = @("--universe", "research-universe-50.json")
if ($Tickers) { $universeArgs += @("--tickers", $Tickers) }
if ($From) { $universeArgs += @("--from", $From) }

function Invoke-Step {
  param([string]$Name, [string]$Script, [string[]]$Arguments)
  Write-Host "`n=== $Name ==="
  & npx tsx $Script @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

$fetchArgs = $universeArgs
if ($Force) { $fetchArgs += "--force" }
Invoke-Step "Fetch SEC Form 4" "worker/form4-fetch.mts" $fetchArgs
Invoke-Step "Parse ownership XML" "worker/form4-parse.mts" $universeArgs
Invoke-Step "Build insider-buy features" "worker/form4-features.mts" $universeArgs

$qaArgs = $universeArgs
if ($StrictQa) { $qaArgs += "--strict-qa" }
Invoke-Step "Synthetic and golden EDGAR QA" "worker/form4-qa.mts" $qaArgs
Invoke-Step "Dry-run benchmark" "worker/form4-benchmark.mts" ($universeArgs + "--dry-run")

$features = Get-Content (Join-Path $env:ALPHA_CACHE_ROOT "edgar-form4\features-summary.json") -Raw | ConvertFrom-Json
$benchmark = Get-Content (Join-Path $env:ALPHA_RUNS_ROOT "form4-qa\benchmark-summary.json") -Raw | ConvertFrom-Json
$qa = Get-Content (Join-Path $env:ALPHA_RUNS_ROOT "form4-qa\summary.json") -Raw | ConvertFrom-Json
$clusterCount = ($features.companies | Measure-Object -Property clusters -Sum).Sum
$notComputable = @($features.companies | Where-Object { $_.clusters -eq 0 } | ForEach-Object { $_.ticker })

Write-Host "`n=== Form 4 MVP summary ==="
Write-Host "Signal: insider_buy_cluster_v1"
Write-Host "Companies: $($features.companies.Count); clusters: $clusterCount; not_computable: $($notComputable.Count)"
if ($notComputable.Count) { Write-Host "Not computable tickers: $($notComputable -join ', ')" }
Write-Host "QA: $($qa.status); golden issuers: $($qa.golden.ticker -join ', ')"
Write-Host "Benchmark: $($benchmark.status); notProductionAlpha: $($benchmark.notProductionAlpha)"
foreach ($horizon in @(1, 5, 20)) {
  $row = $benchmark.horizons."forward${horizon}d"
  Write-Host "+${horizon}d: status=$($row.status); computed=$($row.counts.computed)/$($row.counts.total); coverage=$($row.coverage); hitRate=$($row.hitRate); medianExcess=$($row.medianExcess)"
}
Write-Host "Production DB/API writes: not_run"
