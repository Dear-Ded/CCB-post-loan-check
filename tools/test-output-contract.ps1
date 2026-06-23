param(
  [Parameter(Mandatory=$true)]
  [string]$OutputRoot,

  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Test-Docx($Path) {
  return (Test-Path -LiteralPath $Path) -and $Path.EndsWith(".docx") -and ((Get-Item -LiteralPath $Path).Length -gt 0)
}

function Test-ReportName($Path) {
  if (-not $Path) { return $false }
  $name = (Split-Path -Leaf $Path).Trim()
  $prefix = [string]::Concat([char[]](36151,21518,26597,35810,45))
  return $name.StartsWith($prefix) -and ($name -match '-[0-9]{8}\.docx$')
}

function Test-Manifest($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return @{ ok = $false; reason = "missing_manifest" } }
  try {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
    $shots = @($manifest.screenshots)
    if (-not $manifest.company) { return @{ ok = $false; reason = "missing_company" } }
    if ($shots.Count -lt 1) { return @{ ok = $false; reason = "no_screenshots" } }
    foreach ($shot in $shots) {
      if (-not (Test-Path -LiteralPath $shot.screenshot)) { return @{ ok = $false; reason = "missing_screenshot_file" } }
      if ($shot.validation -and $shot.validation.ok -eq $false) { return @{ ok = $false; reason = "invalid_screenshot_validation" } }
    }
    if ($manifest.PSObject.Properties.Name -contains "smokeQuick" -and $manifest.smokeQuick) {
      return @{ ok = $false; reason = "smoke_quick_not_final_delivery" }
    }
    if ($manifest.PSObject.Properties.Name -contains "requiredEvidence") {
      $requiredEvidence = $manifest.requiredEvidence
      if ($requiredEvidence -and ($requiredEvidence.PSObject.Properties.Name -contains "ok") -and -not $requiredEvidence.ok) {
        $missing = @($requiredEvidence.missingRequired | ForEach-Object { "$($_.id):$($_.missingReason)" })
        return @{ ok = $false; reason = "missing_required_evidence: $($missing -join ',')" }
      }
    }
    if ($manifest.PSObject.Properties.Name -contains "missingEvidence" -and @($manifest.missingEvidence).Count -gt 0) {
      $missing = @($manifest.missingEvidence | ForEach-Object { "$($_.id):$($_.reason)" })
      return @{ ok = $false; reason = "missing_evidence_summary: $($missing -join ',')" }
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
  $docxOk = [bool]($docx -and (Test-Docx $docx.FullName) -and (Test-ReportName $docx.FullName))
  $results.Add([pscustomobject]@{
    type = "single"
    path = $run.FullName
    ok = [bool]($manifestResult.ok -and $docxOk)
    company = $manifestResult.company
    screenshots = $manifestResult.screenshots
    report = if ($docx) { $docx.FullName } else { "" }
    reason = if (-not $manifestResult.ok) { $manifestResult.reason } elseif (-not $docxOk) { "invalid_report_name_or_docx" } else { "" }
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
  $summaryPayload = $null
  if (Test-Path -LiteralPath $summaryPath) {
    $summaryPayload = Get-Content -Raw -Encoding UTF8 -LiteralPath $summaryPath | ConvertFrom-Json
    if ($summaryPayload.PSObject.Properties.Name -contains "items") {
      $summary = @($summaryPayload.items)
    } else {
      $summary = @($summaryPayload)
    }
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
  if ($summaryPayload -and ($summaryPayload.PSObject.Properties.Name -contains "partial") -and $summaryPayload.partial) {
    $summaryOk = $false
    $manifestReasons += "batch_partial_remaining_$($summaryPayload.remainingCompanies)"
  }
  $reportsOk = $reports.Count -ge $summary.Count -and ($reports | Where-Object { -not (Test-Docx $_.FullName) -or -not (Test-ReportName $_.FullName) }).Count -eq 0
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
