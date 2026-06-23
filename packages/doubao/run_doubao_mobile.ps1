param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string[]]$Person = @(),

  [string]$OutputRoot = "",

  [switch]$SmokeQuick,

  [switch]$NoPrompt,

  [switch]$IncludeHealthCommission,

  [switch]$SkipSearch,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [ValidateSet("standard", "enhanced", "deep", "expert")]
  [string]$Mode = "enhanced",

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
$localRunner = Join-Path $doubaoRoot "run_doubao_local.ps1"

function Invoke-LocalPowerShellScript {
  param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptPath,

    [hashtable]$Parameters = @{}
  )

  $scriptText = Get-Content -Raw -LiteralPath $ScriptPath
  $scriptBlock = [scriptblock]::Create($scriptText)
  & $scriptBlock @Parameters
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

function Write-WrapperFailureSummary([string]$Reason, [string]$Phase = "doubao_mobile_wrapper") {
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
  $runnerParameters = @{
    CompanyName = $CompanyName
    JudicialMode = $JudicialMode
    Mode = $Mode
  }
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $runnerParameters.OrgCode = $OrgCode }
  if ($Person.Count -gt 0) { $runnerParameters.Person = $Person }
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $runnerParameters.OutputRoot = $OutputRoot }
  if ($IncludeHealthCommission) { $runnerParameters.IncludeHealthCommission = $true }
  if ($SmokeQuick) { $runnerParameters.SmokeQuick = $true }
  if ($NoPrompt) { $runnerParameters.NoPrompt = $true }
  if ($SkipSearch) { $runnerParameters.SkipSearch = $true }

  $before = Get-Date
  if ($Json) {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $localRunner -Parameters $runnerParameters *> $null
  } else {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $localRunner -Parameters $runnerParameters 2>&1
  }
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }

  $outputRootPath = Get-DefaultOutputRoot
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
  $summaryPath = Write-WrapperFailureSummary -Reason $_.Exception.Message
  $downloadMode = if ($Json) { "share-link" } else { "cloud-disk" }
  Write-MobileResult $false ("Doubao mobile handoff failed: " + $_.Exception.Message) "" (Split-Path -Parent $summaryPath) $downloadMode
  exit 1
}
