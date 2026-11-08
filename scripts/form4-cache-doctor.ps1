$ErrorActionPreference = "Stop"
$expectedCodeRoot = "C:\dev\alpha-engine"
$codeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($codeRoot -ine $expectedCodeRoot) { throw "Canonical code root is $expectedCodeRoot; actual root is $codeRoot" }
if (-not $env:ALPHA_CACHE_ROOT) { $env:ALPHA_CACHE_ROOT = "D:\alpha-engine\worker\cache" }
if (-not $env:ALPHA_RUNS_ROOT) { $env:ALPHA_RUNS_ROOT = "D:\alpha-engine\worker\.runs" }
Write-Host "codeRoot = $codeRoot"
Write-Host "cacheRoot = $env:ALPHA_CACHE_ROOT"
Write-Host "runsRoot = $env:ALPHA_RUNS_ROOT"

$cParent = Join-Path $codeRoot "worker\cache"
$cCache = Join-Path $cParent "edgar-form4"
$dCache = Join-Path $env:ALPHA_CACHE_ROOT "edgar-form4"

function Get-CacheStats([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ Path = $Path; Files = 0; Bytes = 0; LinkType = "Missing"; Target = $null } }
  $item = Get-Item -LiteralPath $Path -Force
  $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force
  $linkType = if ($item.LinkType) { $item.LinkType } else { "Normal" }
  return [pscustomobject]@{
    Path = $Path
    Files = $files.Count
    Bytes = ($files | Measure-Object -Property Length -Sum).Sum
    LinkType = $linkType
    Target = @($item.Target) -join ";"
  }
}

function Test-LinkTarget([string]$Path, [string]$ExpectedTarget) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.LinkType -notin @("Junction", "SymbolicLink")) { return $false }
  $target = @($item.Target)[0]
  return $target -and [IO.Path]::GetFullPath($target) -ieq [IO.Path]::GetFullPath($ExpectedTarget)
}

Write-Host "`n=== Form 4 cache candidates ==="
Get-CacheStats $cParent | ConvertTo-Json -Compress
Get-CacheStats $cCache | ConvertTo-Json -Compress
Get-CacheStats $dCache | ConvertTo-Json -Compress

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
