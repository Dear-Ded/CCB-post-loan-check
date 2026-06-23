param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string]$OutputRoot = "",

  [string]$StateFile = "",

  [switch]$SkipSearch,

  [switch]$SmokeQuick,

  [switch]$Json
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  (Get-Location).Path
} else {
  Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $env:TEMP ("ccb-monitor-" + [guid]::NewGuid().ToString("N"))
}
if ([string]::IsNullOrWhiteSpace($StateFile)) {
  $StateFile = Join-Path $ProjectRoot ".monitor-state\monitor-state.json"
}

function Normalize-List([string]$Items) {
  $out = @()
  $normalized = ([string]$Items).Replace([char]0x3001, ",").Replace([char]0xFF0C, ",").Replace([char]13, ",").Replace([char]10, ",")
  foreach ($part in ($normalized -split ",")) {
    $trimmed = $part.Trim()
    if ($trimmed) { $out += $trimmed }
  }
  return $out
}

function Read-State([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{ schemaVersion = "monitor-state/v1"; companies = [ordered]@{} }
  }
  try {
    $payload = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
    $companies = [ordered]@{}
    if ($payload.companies) {
      foreach ($prop in $payload.companies.PSObject.Properties) {
        $companies[$prop.Name] = $prop.Value
      }
    }
    return [ordered]@{ schemaVersion = "monitor-state/v1"; companies = $companies }
  } catch {
    return [ordered]@{ schemaVersion = "monitor-state/v1"; companies = [ordered]@{}; previousStateReadError = $_.Exception.Message }
  }
}

function Get-ManifestSummary($ManifestPath) {
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
  $shots = @($manifest.screenshots)
  $sources = @($shots | ForEach-Object {
    [pscustomobject]@{
      name = $_.name
      url = $_.url
      validationOk = if ($_.validation) { [bool]$_.validation.ok } else { $true }
    }
  })
  $report = Get-ChildItem -LiteralPath (Split-Path -Parent $ManifestPath) -Filter "*.docx" -ErrorAction SilentlyContinue | Select-Object -First 1
  $reportHash = if ($report) { (Get-FileHash -Algorithm SHA256 -LiteralPath $report.FullName).Hash } else { "" }
  $fingerprintPayload = [ordered]@{
    company = $manifest.company
    orgCode = $manifest.orgCode
    screenshots = $sources
    searchResult = $manifest.searchResult
    reportHash = $reportHash
  }
  $fingerprintText = ($fingerprintPayload | ConvertTo-Json -Depth 12 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($fingerprintText)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $fingerprint = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
  return [pscustomobject]@{
    company = $manifest.company
    orgCode = $manifest.orgCode
    manifest = $ManifestPath
    report = if ($report) { $report.FullName } else { "" }
    reportHash = $reportHash
    screenshotCount = $shots.Count
    sources = $sources
    searchResult = $manifest.searchResult
    fingerprint = $fingerprint
  }
}

function Write-State([string]$Path, $State) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

$companies = @(Normalize-List $CompanyName)
$codes = @(Normalize-List $OrgCode)
if (-not $companies.Count) { throw "At least one company is required." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$monitorRoot = Join-Path $OutputRoot ("monitor-{0}-{1}" -f $stamp, $PID)
New-Item -ItemType Directory -Path $monitorRoot -Force | Out-Null

if ($companies.Count -gt 1) {
  $runnerScript = Join-Path $ProjectRoot "packages\core-skill\scripts\run_batch_post_loan_check.ps1"
  $runnerParameters = @{ CompanyName = @($companies); OutputRoot = $monitorRoot; NoPrompt = $true }
  if ($codes.Count) { $runnerParameters.OrgCode = @($codes) }
  if ($SkipSearch) { $runnerParameters.SkipSearch = $true }
  if ($SmokeQuick) { $runnerParameters.SmokeQuick = $true }
  & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $runnerScript))) @runnerParameters
} else {
  $runnerScript = Join-Path $ProjectRoot "packages\core-skill\scripts\run_post_loan_check.ps1"
  $runnerParameters = @{ CompanyName = $companies[0]; OutputRoot = $monitorRoot; NoPrompt = $true }
  if ($codes.Count -gt 0) { $runnerParameters.OrgCode = $codes[0] }
  if ($SkipSearch) { $runnerParameters.SkipSearch = $true }
  if ($SmokeQuick) { $runnerParameters.SmokeQuick = $true }
  & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $runnerScript))) @runnerParameters
}
if ($LASTEXITCODE -ne 0) { throw "Monitor query run failed with exit code $LASTEXITCODE" }

$state = Read-State $StateFile
$items = [System.Collections.Generic.List[object]]::new()
$manifestPaths = @(Get-ChildItem -LiteralPath $monitorRoot -Recurse -Filter "template-slots-manifest.json" -ErrorAction SilentlyContinue)
foreach ($manifestPath in $manifestPaths) {
  $summary = Get-ManifestSummary $manifestPath.FullName
  $previous = $state.companies[$summary.company]
  $status = "new"
  if ($previous) {
    $status = if ($previous.fingerprint -eq $summary.fingerprint) { "unchanged" } else { "changed" }
  }
  $state.companies[$summary.company] = [ordered]@{
    company = $summary.company
    orgCode = $summary.orgCode
    fingerprint = $summary.fingerprint
    lastSeenAt = (Get-Date).ToString("o")
    lastReport = $summary.report
    lastManifest = $summary.manifest
    screenshotCount = $summary.screenshotCount
    previousFingerprint = if ($previous) { $previous.fingerprint } else { "" }
  }
  $items.Add([pscustomobject]@{
    company = $summary.company
    status = $status
    screenshotCount = $summary.screenshotCount
    report = $summary.report
    manifest = $summary.manifest
    searchResult = $summary.searchResult
  })
}
Write-State $StateFile $state

$result = [pscustomobject]@{
  ok = $items.Count -gt 0
  schemaVersion = "monitor-summary/v1"
  generatedAt = (Get-Date).ToString("o")
  monitorRoot = $monitorRoot
  stateFile = $StateFile
  companies = $items
  changedCount = @($items | Where-Object { $_.status -eq "changed" }).Count
  newCount = @($items | Where-Object { $_.status -eq "new" }).Count
  unchangedCount = @($items | Where-Object { $_.status -eq "unchanged" }).Count
}
$summaryPath = Join-Path $monitorRoot "monitor-summary.json"
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

if ($Json) {
  $result | ConvertTo-Json -Depth 12
} else {
  $result.companies | Format-Table -AutoSize
  Write-Host "monitor: $summaryPath"
}
