param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [switch]$IncludeHealthCommission,

  [string[]]$Person = @(),

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
$workbuddyRoot = if ([string]::IsNullOrWhiteSpace($CommandPath)) {
  $candidate = Join-Path (Get-Location).Path "packages\core-skill\workbuddy"
  if (-not (Test-Path -LiteralPath $candidate)) {
    $candidate = Join-Path (Get-Location).Path "workbuddy"
  }
  (Resolve-Path -LiteralPath $candidate).Path
} else {
  Split-Path -Parent $CommandPath
}
$skillRoot = Split-Path -Parent $workbuddyRoot
$preflight = Join-Path $skillRoot "scripts\preflight_workbuddy.ps1"
$runner = Join-Path $skillRoot "scripts\run_post_loan_check.ps1"
$batchRunner = Join-Path $skillRoot "scripts\run_batch_post_loan_check.ps1"

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

function Write-Result($ok, $message, $reportPath = "", $outputDir = "") {
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

function Get-EffectiveOutputRoot {
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { return $OutputRoot }
  if ($preflightResult -and $preflightResult.outputRoot -and $preflightResult.outputRoot.path) {
    return [string]$preflightResult.outputRoot.path
  }
  if ($env:POST_LOAN_OUTPUT_ROOT) { return $env:POST_LOAN_OUTPUT_ROOT }
  $productDirName = [string]::Concat(
    [char]67, [char]67, [char]66,
    [char]36151, [char]21069, [char]36151, [char]21518,
    [char]26597, [char]35810
  )
  return (Join-Path ([Environment]::GetFolderPath("MyDocuments")) (Join-Path $productDirName "outputs"))
}

function Write-WrapperFailureSummary([string]$Reason, [string]$Phase = "workbuddy_wrapper") {
  $root = Get-EffectiveOutputRoot
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
  $preflightJson = Invoke-LocalPowerShellScript -ScriptPath $preflight -Parameters @{ Json = $true }
  $preflightResult = $preflightJson | ConvertFrom-Json
  if (-not $preflightResult.ok) {
    $msg = "Preflight failed: " + (($preflightResult.messages | ForEach-Object { $_ }) -join "; ")
    Write-Result $false $msg
    exit 2
  }

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

  if ($isBatch) {
    if (-not $Json) { Write-Host "Batch background mode: final Word reports will be collected in reports." }
  } else {
    if (-not $Json) { Write-Host "Background mode: a visible browser opens only for login or page challenge." }
  }

  $runnerPath = if ($isBatch) { $batchRunner } else { $runner }
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

  $before = Get-Date
  if ($Json) {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $runnerPath -Parameters $runnerParameters *> $null
  } else {
    $childOutput = Invoke-LocalPowerShellScript -ScriptPath $runnerPath -Parameters $runnerParameters 2>&1
  }
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }

  $outputRootPath = if ($OutputRoot) { $OutputRoot } else { $preflightResult.outputRoot.path }
  $batchReports = $null
  $report = $null
  if ($isBatch) {
    $batchRoot = Get-ChildItem -LiteralPath $outputRootPath -Directory -Filter "batch-post-loan-*" |
      Where-Object { $_.LastWriteTime -ge $before } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($batchRoot) {
      $candidate = Join-Path $batchRoot.FullName "reports"
      if (Test-Path -LiteralPath $candidate) { $batchReports = Get-Item -LiteralPath $candidate }
    }
  } else {
    $report = Get-ChildItem -LiteralPath $outputRootPath -Recurse -Filter "*.docx" |
      Where-Object {
        $_.LastWriteTime -ge $before -and
        $_.DirectoryName -notmatch "\\batch-post-loan-[^\\]+\\reports$" -and
        $_.FullName -notmatch "\\batch-post-loan-[^\\]+\\evidence\\"
      } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
  }

  if ($batchReports) {
    Write-Result $true "Batch reports generated." "" $batchReports.FullName
    if (-not $Json) { Start-Process explorer.exe -ArgumentList "`"$($batchReports.FullName)`"" | Out-Null }
  } elseif ($report) {
    Write-Result $true "Report generated." $report.FullName $report.DirectoryName
    if (-not $Json) { Start-Process explorer.exe -ArgumentList "/select,`"$($report.FullName)`"" | Out-Null }
  } else {
    Write-Result $true "Task completed, but the report file was not located automatically. Check the output folder." "" $outputRootPath
  }
} catch {
  $text = $_.Exception.Message
  $summaryPath = Write-WrapperFailureSummary -Reason $text
  if ($text -match "org-code|credit code") {
    Write-Result $false "Organization code was not confirmed. Please provide unified social credit code or organization code." "" (Split-Path -Parent $summaryPath)
  } elseif ($text -match "Timed out waiting.*login|China Judgments") {
    Write-Result $false "China Judgments Online login was not completed or expired. Restart and log in once in the opened browser." "" (Split-Path -Parent $summaryPath)
  } elseif ($text -match "captcha|challenge") {
    Write-Result $false "A page challenge is still required. Restart and complete the prepared page in the authorized browser session." "" (Split-Path -Parent $summaryPath)
  } else {
    Write-Result $false ("Task failed: " + $text) "" (Split-Path -Parent $summaryPath)
  }
  exit 1
}
