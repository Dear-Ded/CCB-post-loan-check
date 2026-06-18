param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string]$OutputRoot = "",

  [switch]$IncludeHealthCommission,

  [switch]$SkipJudicial,

  [switch]$SkipSearch,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [switch]$Json
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$doubaoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localRunner = Join-Path $doubaoRoot "run_doubao_local.ps1"

function Get-DefaultOutputRoot {
  if ($OutputRoot) { return $OutputRoot }
  if ($env:POST_LOAN_OUTPUT_ROOT) { return $env:POST_LOAN_OUTPUT_ROOT }
  return (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "CCB贷前贷后查询\outputs")
}

function Write-MobileResult($ok, $message, $reportPath = "", $outputDir = "", $downloadMode = "none") {
  $payload = [ordered]@{
    ok = $ok
    message = $message
    entrySurface = "mobile-app"
    executionSurface = "doubao-office-task-or-cloud-or-pc-worker"
    downloadMode = $downloadMode
    reportPath = $reportPath
    outputDir = $outputDir
  }
  if ($Json) {
    $payload | ConvertTo-Json -Depth 6
  } else {
    Write-Host $message
    if ($reportPath) { Write-Host "report: $reportPath" }
    if ($outputDir) { Write-Host "folder: $outputDir" }
    if ($downloadMode -ne "none") { Write-Host "delivery: $downloadMode" }
  }
}

try {
  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $localRunner,
    "-CompanyName", $CompanyName,
    "-JudicialMode", $JudicialMode
  )
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $argsList += @("-OrgCode", $OrgCode) }
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $argsList += @("-OutputRoot", $OutputRoot) }
  if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
  if ($SkipJudicial) { $argsList += "-SkipJudicial" }
  if ($SkipSearch) { $argsList += "-SkipSearch" }

  $before = Get-Date
  $childOutput = & powershell.exe @argsList 2>&1
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }
  if ($LASTEXITCODE -ne 0) {
    Write-MobileResult $false "Doubao mobile handoff failed before report generation."
    exit $LASTEXITCODE
  }

  $outputRootPath = Get-DefaultOutputRoot
  $normalizedCompanies = $CompanyName.Replace([char]0x3001, ",").Replace([char]0xFF0C, ",").Replace([char]13, ",").Replace([char]10, ",")
  $companyItems = @()
  foreach ($item in ($normalizedCompanies -split ",")) {
    $trimmed = $item.Trim()
    if ($trimmed) { $companyItems += $trimmed }
  }
  $isBatch = $companyItems.Count -gt 1
  $downloadMode = if ($Json) { "share-link" } else { "cloud-disk" }

  if ($isBatch) {
    $batchRoot = Get-ChildItem -LiteralPath $outputRootPath -Directory -Filter "batch-post-loan-*" |
      Where-Object { $_.LastWriteTime -ge $before } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($batchRoot) {
      $reports = Join-Path $batchRoot.FullName "reports"
      if (Test-Path -LiteralPath $reports) {
        Write-MobileResult $true "Doubao mobile batch handoff completed." "" $reports $downloadMode
        exit 0
      }
    }
    Write-MobileResult $false "Doubao mobile batch handoff finished but reports folder was not found." "" $outputRootPath $downloadMode
    exit 1
  }

  $report = Get-ChildItem -LiteralPath $outputRootPath -Recurse -Filter "*.docx" |
    Where-Object { $_.LastWriteTime -ge $before } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($report) {
    Write-MobileResult $true "Doubao mobile handoff completed." $report.FullName $report.DirectoryName $downloadMode
  } else {
    Write-MobileResult $false "Doubao mobile handoff finished but report file was not found." "" $outputRootPath $downloadMode
    exit 1
  }
} catch {
  Write-MobileResult $false ("Doubao mobile handoff failed: " + $_.Exception.Message)
  exit 1
}
