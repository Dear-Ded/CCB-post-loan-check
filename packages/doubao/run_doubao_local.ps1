param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [switch]$IncludeHealthCommission,

  [string]$OutputRoot = "",

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
$projectRoot = Split-Path -Parent (Split-Path -Parent $doubaoRoot)
$coreRoot = Join-Path $projectRoot "packages\core-skill"
$singleRunner = Join-Path $coreRoot "scripts\run_post_loan_check.ps1"
$batchRunner = Join-Path $coreRoot "scripts\run_batch_post_loan_check.ps1"

function Write-TaskResult($ok, $message, $reportPath = "", $outputDir = "") {
  $result = [ordered]@{
    ok = $ok
    message = $message
    reportPath = $reportPath
    outputDir = $outputDir
  }
  if ($Json) {
    $result | ConvertTo-Json -Depth 5
  } else {
    Write-Host $message
    if ($reportPath) { Write-Host "report: $reportPath" }
    if ($outputDir) { Write-Host "folder: $outputDir" }
  }
}

try {
  $normalizedCompanies = $CompanyName.Replace([char]0x3001, ",").Replace([char]0xFF0C, ",").Replace([char]13, ",").Replace([char]10, ",")
  $companyItems = @()
  foreach ($item in ($normalizedCompanies -split ",")) {
    $trimmed = $item.Trim()
    if ($trimmed) { $companyItems += $trimmed }
  }
  $isBatch = $companyItems.Count -gt 1

  $runner = if ($isBatch) { $batchRunner } else { $singleRunner }
  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $runner,
    "-CompanyName", $CompanyName,
    "-TemplateSlots",
    "-JudicialMode", $JudicialMode
  )

  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $argsList += @("-OrgCode", $OrgCode) }
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $argsList += @("-OutputRoot", $OutputRoot) }
  if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
  if ($SkipJudicial -or $isBatch) { $argsList += "-SkipJudicial" }
  if ($SkipSearch) { $argsList += "-SkipSearch" }
  if ($isBatch -or $SkipJudicial) { $argsList += "-NoPrompt" }

  $outputRootPath = if ($OutputRoot) {
    $OutputRoot
  } elseif ($env:POST_LOAN_OUTPUT_ROOT) {
    $env:POST_LOAN_OUTPUT_ROOT
  } else {
    Join-Path ([Environment]::GetFolderPath("MyDocuments")) "CCB贷前贷后查询\outputs"
  }

  $before = Get-Date
  $childOutput = & powershell.exe @argsList 2>&1
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }
  if ($LASTEXITCODE -ne 0) {
    Write-TaskResult $false "Doubao local task failed before report generation."
    exit $LASTEXITCODE
  }

  if ($isBatch) {
    $batchRoot = Get-ChildItem -LiteralPath $outputRootPath -Directory -Filter "batch-post-loan-*" |
      Where-Object { $_.LastWriteTime -ge $before } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($batchRoot) {
      $reports = Join-Path $batchRoot.FullName "reports"
      if (Test-Path -LiteralPath $reports) {
        Write-TaskResult $true "Doubao local batch reports generated." "" $reports
        exit 0
      }
    }
    Write-TaskResult $false "Doubao local batch finished but reports folder was not found." "" $outputRootPath
    exit 1
  }

  $report = Get-ChildItem -LiteralPath $outputRootPath -Recurse -Filter "*.docx" |
    Where-Object {
      $_.LastWriteTime -ge $before -and
      $_.DirectoryName -notmatch "\\batch-post-loan-[^\\]+\\reports$" -and
      $_.FullName -notmatch "\\batch-post-loan-[^\\]+\\evidence\\"
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($report) {
    Write-TaskResult $true "Doubao local report generated." $report.FullName $report.DirectoryName
  } else {
    Write-TaskResult $false "Doubao local task finished but report file was not found." "" $outputRootPath
    exit 1
  }
} catch {
  Write-TaskResult $false ("Doubao local task failed: " + $_.Exception.Message)
  exit 1
}
