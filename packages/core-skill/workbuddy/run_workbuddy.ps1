param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [switch]$IncludeHealthCommission,

  [string[]]$Person = @(),

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

$workbuddyRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillRoot = Split-Path -Parent $workbuddyRoot
$preflight = Join-Path $skillRoot "scripts\preflight_workbuddy.ps1"
$runner = Join-Path $skillRoot "scripts\run_post_loan_check.ps1"
$batchRunner = Join-Path $skillRoot "scripts\run_batch_post_loan_check.ps1"

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

try {
  $preflightJson = powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -Json
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

  if ($isBatch) {
    if (-not $Json) { Write-Host "Batch background mode: final Word reports will be collected in reports." }
  } else {
    if (-not $Json) { Write-Host "Background mode: a visible browser opens only for login or captcha." }
  }

  $runnerPath = if ($isBatch) { $batchRunner } else { $runner }
  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $runnerPath,
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
  foreach ($p in $Person) { $argsList += @("-Person", $p) }

  $before = Get-Date
  $childOutput = & powershell.exe @argsList 2>&1
  if (-not $Json) { $childOutput | ForEach-Object { Write-Host $_ } }
  if ($LASTEXITCODE -ne 0) {
    Write-Result $false "Report was not generated because a source did not reach a verified result page or required login/captcha was unfinished."
    exit $LASTEXITCODE
  }

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
  if ($text -match "org-code|credit code") {
    Write-Result $false "Organization code was not confirmed. Please provide unified social credit code or organization code."
  } elseif ($text -match "Timed out waiting.*login|China Judgments") {
    Write-Result $false "China Judgments Online login was not completed or expired. Restart and log in once in the opened browser."
  } elseif ($text -match "captcha") {
    Write-Result $false "Captcha is still required. Restart and enter the captcha on the prepared page."
  } else {
    Write-Result $false ("Task failed: " + $text)
  }
  exit 1
}
