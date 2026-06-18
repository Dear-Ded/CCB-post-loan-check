param(
  [Parameter(Mandatory=$true)]
  [string]$OutputRoot,

  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Test-Docx($path) {
  return (Test-Path -LiteralPath $path) -and $path.EndsWith(".docx") -and ((Get-Item -LiteralPath $path).Length -gt 0)
}

function Test-Manifest($path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "missing_manifest" } }
  try {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
    $shots = @($manifest.screenshots)
    if (-not $manifest.company) { return @{ ok = $false; reason = "missing_company" } }
    if ($shots.Count -lt 1) { return @{ ok = $false; reason = "no_screenshots" } }
    foreach ($shot in $shots) {
      if (-not (Test-Path -LiteralPath $shot.screenshot)) { return @{ ok = $false; reason = "missing_screenshot_file" } }
      if ($shot.validation -and $shot.validation.ok -eq $false) { return @{ ok = $false; reason = "invalid_screenshot_validation" } }
    }
    return @{ ok = $true; reason = ""; company = $manifest.company; screenshots = $shots.Count }
  } catch {
    return @{ ok = $false; reason = "manifest_parse_failed: $($_.Exception.Message)" }
  }
}

$results = [System.Collections.Generic.List[object]]::new()

$singleRuns = Get-ChildItem -LiteralPath $OutputRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "batch-post-loan-*" }

foreach ($run in $singleRuns) {
  $manifestPath = Join-Path $run.FullName "template-slots-manifest.json"
  $manifestResult = Test-Manifest $manifestPath
  $docx = Get-ChildItem -LiteralPath $run.FullName -Filter "*.docx" -ErrorAction SilentlyContinue | Select-Object -First 1
  $results.Add([pscustomobject]@{
    type = "single"
    path = $run.FullName
    ok = [bool]($manifestResult.ok -and $docx -and (Test-Docx $docx.FullName))
    company = $manifestResult.company
    screenshots = $manifestResult.screenshots
    report = if ($docx) { $docx.FullName } else { "" }
    reason = if ($manifestResult.ok) { "" } else { $manifestResult.reason }
  })
}

$batchRuns = Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "batch-post-loan-*" -ErrorAction SilentlyContinue
foreach ($batch in $batchRuns) {
  $reportsDir = Join-Path $batch.FullName "reports"
  $evidenceDir = Join-Path $batch.FullName "evidence"
  $summaryPath = Join-Path $batch.FullName "batch-summary.json"
  $reports = @(Get-ChildItem -LiteralPath $reportsDir -Filter "*.docx" -ErrorAction SilentlyContinue)
  $evidenceRuns = @(Get-ChildItem -LiteralPath $evidenceDir -Directory -ErrorAction SilentlyContinue)
  $summary = @()
  if (Test-Path -LiteralPath $summaryPath) {
    $summary = @(Get-Content -Raw -Encoding UTF8 -LiteralPath $summaryPath | ConvertFrom-Json)
  }
  $manifestOk = $true
  $manifestReasons = @()
  foreach ($run in $evidenceRuns) {
    $manifestResult = Test-Manifest (Join-Path $run.FullName "template-slots-manifest.json")
    if (-not $manifestResult.ok) {
      $manifestOk = $false
      $manifestReasons += "$($run.Name):$($manifestResult.reason)"
    }
  }
  $summaryOk = $summary.Count -gt 0 -and (@($summary | Where-Object { -not $_.ok }).Count -eq 0)
  $reportsOk = $reports.Count -ge $summary.Count -and ($reports | Where-Object { -not (Test-Docx $_.FullName) }).Count -eq 0
  $results.Add([pscustomobject]@{
    type = "batch"
    path = $batch.FullName
    ok = [bool]((Test-Path -LiteralPath $reportsDir) -and (Test-Path -LiteralPath $evidenceDir) -and (Test-Path -LiteralPath $summaryPath) -and $summaryOk -and $reportsOk -and $manifestOk)
    company = ""
    screenshots = ""
    report = $reportsDir
    reason = ($manifestReasons -join "; ")
  })
}

$overall = [pscustomobject]@{
  ok = (@($results | Where-Object { -not $_.ok }).Count -eq 0) -and $results.Count -gt 0
  outputRoot = $OutputRoot
  results = $results
}

if ($Json) {
  $overall | ConvertTo-Json -Depth 8
} else {
  $overall.results | Format-Table -AutoSize
  if (-not $overall.ok) { exit 1 }
}
