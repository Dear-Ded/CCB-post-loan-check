param(
  [Parameter(Mandatory=$true)]
  [string[]]$CompanyName,

  [string[]]$OrgCode = @(),

  [string]$OutputRoot = "",

  [switch]$IncludeHealthCommission,

  [switch]$SkipJudicial,

  [switch]$SkipSearch,

  [switch]$Headless,

  [switch]$RetryFailed,

  [int]$MaxAttempts = 1,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [switch]$NoPrompt,

  [switch]$TemplateSlots
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultOutputRoot = if ($env:POST_LOAN_OUTPUT_ROOT) {
  $env:POST_LOAN_OUTPUT_ROOT
} else {
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) "CCB贷前贷后查询\outputs"
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = $DefaultOutputRoot }

$companies = @()
foreach ($item in $CompanyName) {
  $normalized = ([string]$item).Replace([char]0xFF0C, ",")
  $companies += ($normalized -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$codes = @()
foreach ($item in $OrgCode) {
  $normalized = ([string]$item).Replace([char]0xFF0C, ",")
  $codes += ($normalized -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$summary = [System.Collections.Generic.List[object]]::new()
$effectiveHeadless = $Headless -or ($SkipJudicial -and $NoPrompt)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$batchRoot = Join-Path $OutputRoot ("batch-post-loan-{0}-{1}" -f $stamp, $PID)

if ($RetryFailed) {
  $batchDirs = Get-ChildItem -LiteralPath $OutputRoot -Directory -Filter "batch-post-loan-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  $previousBatch = $null
  $previous = $null
  foreach ($dir in $batchDirs) {
    $path = Join-Path $dir.FullName "batch-summary.json"
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
      $candidate = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
      if ($candidate) {
        $previousBatch = $dir.FullName
        $previous = $candidate
        break
      }
    } catch {}
  }

  if (-not $previous) { throw "RetryFailed requested but no previous batch-summary.json was found under $OutputRoot" }
  $failed = @($previous | Where-Object { -not $_.ok })
  if (-not $failed.Count) { Write-Host "No failed companies found in previous batch."; exit 0 }
  $companies = @($failed.company)
  $codes = @($failed.orgCode)
  $batchRoot = $previousBatch
  Write-Host ("Retrying {0} failed companies from previous batch." -f $companies.Count)
}

$evidenceRoot = Join-Path $batchRoot "evidence"
$reportsRoot = Join-Path $batchRoot "reports"
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
New-Item -ItemType Directory -Path $reportsRoot -Force | Out-Null

for ($i = 0; $i -lt $companies.Count; $i += 1) {
  $company = $companies[$i]
  $code = if ($i -lt $codes.Count) { $codes[$i] } else { "" }
  Write-Host ("[{0}/{1}] {2}" -f ($i + 1), $companies.Count, $company)

  $before = Get-ChildItem -LiteralPath $evidenceRoot -Directory -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName

  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $ScriptRoot "run_post_loan_check.ps1"),
    "-CompanyName", $company,
    "-OutputRoot", $evidenceRoot,
    "-JudicialMode", $JudicialMode
  )
  if (-not [string]::IsNullOrWhiteSpace($code)) { $argsList += @("-OrgCode", $code) }
  if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
  if ($SkipJudicial) { $argsList += "-SkipJudicial" }
  if ($SkipSearch) { $argsList += "-SkipSearch" }
  if ($effectiveHeadless) { $argsList += "-Headless" }
  if ($NoPrompt) { $argsList += "-NoPrompt" }
  if ($TemplateSlots) { $argsList += "-TemplateSlots" }

  $ok = $false
  $errorText = ""
  $attemptCount = [Math]::Max(1, $MaxAttempts)
  $actualAttempts = 0
  for ($attempt = 1; $attempt -le $attemptCount; $attempt += 1) {
    $actualAttempts = $attempt
    try {
      Write-Host ("Attempt {0}/{1}" -f $attempt, $attemptCount)
      & powershell.exe @argsList
      if ($LASTEXITCODE -ne 0) { throw "run_post_loan_check.ps1 exited with code $LASTEXITCODE" }
      $ok = $true
      $errorText = ""
      break
    } catch {
      $ok = $false
      $errorText = [string]$_.Exception.Message
      Write-Host ("FAILED: {0}" -f $errorText)
      if ($attempt -lt $attemptCount) { Start-Sleep -Seconds ([Math]::Min(30, 5 * $attempt)) }
    }
  }

  $afterDirs = Get-ChildItem -LiteralPath $evidenceRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $before -notcontains $_.FullName } |
    Sort-Object LastWriteTime -Descending
  $runDir = $afterDirs | Select-Object -First 1
  $report = $null
  if ($runDir) {
    $report = Get-ChildItem -LiteralPath $runDir.FullName -Filter "*.docx" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($report) {
      $dest = Join-Path $reportsRoot $report.Name
      Copy-Item -LiteralPath $report.FullName -Destination $dest -Force
    }
  }

  $summary.Add([pscustomobject]@{
    company = $company
    orgCode = $code
    ok = $ok
    attempts = $actualAttempts
    error = $errorText
    evidenceDir = if ($runDir) { $runDir.FullName } else { "" }
    report = if ($report) { (Join-Path $reportsRoot $report.Name) } else { "" }
  })
}

$summaryPath = Join-Path $batchRoot "batch-summary.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ("BATCH_DONE {0}" -f $batchRoot)
