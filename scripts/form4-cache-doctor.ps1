$ErrorActionPreference = "Stop"
$expectedCodeRoot = "C:\dev\alpha-engine"
$codeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($codeRoot -ine $expectedCodeRoot) { throw "Canonical code root is $expectedCodeRoot; actual root is $codeRoot" }
if (-not $env:ALPHA_CACHE_ROOT) { $env:ALPHA_CACHE_ROOT = "D:\alpha-engine\worker\cache" }
if (-not $env:ALPHA_RUNS_ROOT) { $env:ALPHA_RUNS_ROOT = "D:\alpha-engine\worker\.runs" }
Write-Host "codeRoot = $codeRoot"
Write-Host "cacheRoot = $env:ALPHA_CACHE_ROOT"
Write-Host "runsRoot = $env:ALPHA_RUNS_ROOT"

$cCache = Join-Path $codeRoot "worker\cache\edgar-form4"
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

Write-Host "`n=== Form 4 cache candidates ==="
Get-CacheStats $cCache | ConvertTo-Json -Compress
Get-CacheStats $dCache | ConvertTo-Json -Compress

if (Test-Path -LiteralPath $cCache) {
  $item = Get-Item -LiteralPath $cCache -Force
  if ($item.LinkType -notin @("Junction", "SymbolicLink")) {
    throw "C cache is a normal directory. Delete it manually, then rerun doctor. No merge or backup was performed."
  }
  $target = @($item.Target)[0]
  if (-not $target -or [IO.Path]::GetFullPath($target) -ine [IO.Path]::GetFullPath($dCache)) {
    throw "C cache link target $target does not match canonical D cache $dCache"
  }
}
