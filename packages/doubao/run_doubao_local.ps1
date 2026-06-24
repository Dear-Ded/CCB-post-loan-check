param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string[]]$Person = @(),

  [switch]$IncludeHealthCommission,

  [string]$OutputRoot = "",

  [switch]$SmokeQuick,

  [switch]$NonJudicial,

  [switch]$NoPrompt,

  [switch]$SkipSearch,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [ValidateSet("", "standard", "enhanced", "deep", "expert")]
  [string]$Mode = "",

  [switch]$Json
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$CommandPath = $MyInvocation.MyCommand.Path
$doubaoRoot = if ([string]::IsNullOrWhiteSpace($CommandPath)) {
  $candidate = Join-Path (Get-Location).Path "packages\doubao"
  if (-not (Test-Path -LiteralPath $candidate)) {
    $candidate = (Get-Location).Path
  }
  (Resolve-Path -LiteralPath $candidate).Path
} else {
  Split-Path -Parent $CommandPath
}
$projectRoot = Split-Path -Parent (Split-Path -Parent $doubaoRoot)
$coreRoot = Join-Path $projectRoot "packages\core-skill"
$singleRunner = Join-Path $coreRoot "scripts\run_post_loan_check.ps1"
$batchRunner = Join-Path $coreRoot "scripts\run_batch_post_loan_check.ps1"

function Invoke-LocalPowerShellScript {
  param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptPath,

    [hashtable]$Parameters = @{}
  )

  $scriptText = Get-Content -Raw -Encoding UTF8 -LiteralPath $ScriptPath
  $scriptBlock = [scriptblock]::Create($scriptText)
  & $scriptBlock @Parameters
}

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

function Get-DefaultOutputRoot {
  if ($OutputRoot) { return $OutputRoot }
  if ($env:POST_LOAN_OUTPUT_ROOT) { return $env:POST_LOAN_OUTPUT_ROOT }
  $productDirName = [string]::Concat(
    [char]67, [char]67, [char]66,
    [char]36151, [char]21069, [char]36151, [char]21518,
    [char]26597, [char]35810
  )
  return (Join-Path ([Environment]::GetFolderPath("MyDocuments")) (Join-Path $productDirName "outputs"))
}

function Write-WrapperFailureSummary([string]$Reason, [string]$Phase = "doubao_local_wrapper") {
  $root = Get-DefaultOutputRoot
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $runDir = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  $runDirPath = if ($runDir) {
    $runDir.FullName
  } else {
    Join-Path $root ("wrapper-failure-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  }
  New-Item -ItemType Directory -Path $runDirPath -Force | Out-Null
  $summaryPath = Join-Path $runDirPath "failure-summary.json"
  if (-not (Test-Path -LiteralPath $summaryPath)) {
    $payload = [ordered]@{
      ok = $false
      finalReportGenerated = $false
      company = $CompanyName
      orgCode = $OrgCode
      mode = $Mode
      nonJudicialMode = [bool]$NonJudicial
      judicialMode = $JudicialMode
      phase = $Phase
      reason = $Reason
      runDir = $runDirPath
      generatedAt = (Get-Date).ToString("o")
      screenshots = @()
      missingEvidence = @()
      nextAction = "Inspect the run folder and retry the official source capture. A formal Word report was not generated."
    }
    $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    @(
      "# Query Failure Diagnostics",
      "",
      "- Company: $CompanyName",
      "- Mode: $Mode",
      "- Phase: $Phase",
      "- Reason: $Reason",
      "- Formal report: not generated"
    ) | Set-Content -LiteralPath (Join-Path $runDirPath "failure-summary.md") -Encoding UTF8
  }
  return $summaryPath
}

try {
  $normalizedCompanies = $CompanyName.Replace([char]0x3001, ",").Replace([char]0xFF0C, ",").Replace([char]13, ",").Replace([char]10, ",")
  $companyItems = @()
  foreach ($item in ($normalizedCompanies -split ",")) {
    $trimmed = $item.Trim()
    if ($trimmed) { $companyItems += $trimmed }
  }
  $isBatch = $companyItems.Count -gt 1
  if ($isBatch -and $Person.Count -gt 0) {
    throw "Person execution checks are only supported for single-company runs."
  }

  $runner = if ($isBatch) { $batchRunner } else { $singleRunner }
  $runnerParameters = @{
    CompanyName = $CompanyName
    TemplateSlots = $true
    JudicialMode = $(if ($NonJudicial) { "blocked" } else { $JudicialMode })
    Mode = $Mode
  }

  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $runnerParameters.OrgCode = $OrgCode }
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $runnerParameters.OutputRoot = $OutputRoot }
  if ($IncludeHealthCommission) { $runnerParameters.IncludeHealthCommission = $true }
  if ($SmokeQuick) { $runnerParameters.SmokeQuick = $true }
  if ($NonJudicial) { $runnerParameters.NonJudicial = $true }
  if ($NoPrompt) { $runnerParameters.NoPrompt = $true }
  if ($SkipSearch) { $runnerParameters.SkipSearch = $true }
  if ($Person.Count -gt 0 -and -not $isBatch) { $runnerParameters.Person = $Person }

  $outputRootPath = Get-DefaultOutputRoot

  $before = Get-Date
  if ($Json) {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $runner -Parameters $runnerParameters *> $null
  } else {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $runner -Parameters $runnerParameters 2>&1
  }
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }

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
  $summaryPath = Write-WrapperFailureSummary -Reason $_.Exception.Message
  Write-TaskResult $false ("Doubao local task failed: " + $_.Exception.Message) "" (Split-Path -Parent $summaryPath)
  exit 1
}
