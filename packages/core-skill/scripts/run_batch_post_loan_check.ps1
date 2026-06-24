param(
  [Parameter(Mandatory=$true)]
  [string[]]$CompanyName,

  [string[]]$OrgCode = @(),
  [string]$OutputRoot = "",
  [switch]$IncludeHealthCommission,
  [switch]$SmokeQuick,
  [switch]$NonJudicial,
  [switch]$SkipSearch,
  [switch]$Headless,
  [switch]$RetryFailed,
  [int]$MaxAttempts = 2,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [ValidateSet("", "standard", "enhanced", "deep", "expert")]
  [string]$Mode = "",

  [switch]$NoPrompt,
  [switch]$TemplateSlots
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS)) {
  $env:POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS = "3000"
}
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED)) {
  $env:POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED = "1"
}
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS)) {
  $env:POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS = "8000"
}

$CommandPath = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($CommandPath)) {
  if ($env:POST_LOAN_SKILL_ROOT -and (Test-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT)) {
    $SkillRoot = (Resolve-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT).Path
  } else {
    $candidate = Join-Path (Get-Location).Path "packages\core-skill"
    if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Split-Path -Parent (Get-Location).Path }
    $SkillRoot = (Resolve-Path -LiteralPath $candidate).Path
  }
$ScriptRoot = Join-Path $SkillRoot "scripts"
} else {
  $ScriptRoot = Split-Path -Parent $CommandPath
  $SkillRoot = Split-Path -Parent $ScriptRoot
}

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

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory=$true)]
    [string]$Path,

    [Parameter(Mandatory=$true)]
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Format-GapAction {
  param([string]$Action)

  switch ($Action) {
    "refresh_session_then_retry" { return "刷新授权会话后重试" }
    "retry_with_route_rotation" { return "切换官方入口并重试" }
    "retry_after_cooldown" { return "等待冷却后重试" }
    "retry_managed_official_confirmation" { return "使用托管确认重试官方页面" }
    "retry_with_longer_result_wait" { return "延长结果等待时间后重试" }
    "retry_required_official_sources" { return "重跑必查司法/执行官方页面" }
    "retry_required_judicial_sources" { return "重跑必查司法/执行源" }
    default { return "重试失败任务" }
  }
}

function New-GapListMarkdown {
  param(
    [Parameter(Mandatory=$true)]
    [object[]]$Summary,

    [object]$RetryPlan
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("# 批量查询补证清单")
  $lines.Add("")
  $lines.Add(("生成时间：{0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")))
  $lines.Add("")

  $failed = @($Summary | Where-Object { -not $_.ok })
  $okCount = @($Summary | Where-Object { $_.ok }).Count
  $lines.Add(("总主体：{0}；已完整出具：{1}；待补证：{2}" -f $Summary.Count, $okCount, $failed.Count))
  $lines.Add("")

  if (-not $failed.Count) {
    $lines.Add("本批次没有待补证主体。")
    return ($lines -join [Environment]::NewLine)
  }

  $planItems = @($RetryPlan.items)
  foreach ($row in $failed) {
    $plan = $planItems | Where-Object { $_.company -eq $row.company } | Select-Object -First 1
    $action = if ($plan) { Format-GapAction $plan.action } else { "重试失败任务" }
    $lines.Add(("## {0}" -f $row.company))
    if (-not [string]::IsNullOrWhiteSpace($row.orgCode)) { $lines.Add(("- 统一社会信用代码或组织机构代码：{0}" -f $row.orgCode)) }
    $lines.Add(("- 建议动作：{0}" -f $action))
    if (-not [string]::IsNullOrWhiteSpace($row.error)) { $lines.Add(("- 最近错误：{0}" -f $row.error)) }
    if ($row.evidenceDir) { $lines.Add(("- 证据目录：{0}" -f $row.evidenceDir)) }
    $missing = @($row.missingEvidence)
    if ($missing.Count) {
      $lines.Add("- 缺失证据：")
      foreach ($item in $missing) {
        $lines.Add(("  - {0}（{1}）" -f $item.label, $item.reason))
      }
    }
    $categories = @($row.judicialDiagnostics.categories | ForEach-Object { $_.category } | Where-Object { $_ })
    if ($categories.Count) {
      $lines.Add(("- 失败归因：{0}" -f (($categories | Select-Object -Unique) -join "、")))
    }
    $lines.Add("")
  }

  return ($lines -join [Environment]::NewLine)
}

function Resolve-OptionalNodeExe {
  $runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
  $candidates = @(
    $env:POST_LOAN_NODE_EXE,
    (Join-Path $runtimeRoot "node\bin\node.exe"),
    (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
  )
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return ""
}

$NodeExeForDiagnostics = Resolve-OptionalNodeExe
$ProductDirName = [string]::Concat(
  [char]67, [char]67, [char]66,
  [char]36151, [char]21069, [char]36151, [char]21518,
  [char]26597, [char]35810
)
$DefaultOutputRoot = if ($env:POST_LOAN_OUTPUT_ROOT) {
  $env:POST_LOAN_OUTPUT_ROOT
} else {
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) (Join-Path $ProductDirName "outputs")
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
$effectiveHeadless = $Headless -or ($SmokeQuick -and $NoPrompt)
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
      $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
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

  $runnerPath = Join-Path $ScriptRoot "run_post_loan_check.ps1"
  $runnerParameters = @{
    CompanyName = $company
    OutputRoot = $evidenceRoot
    JudicialMode = $JudicialMode
    Mode = $Mode
  }
  if (-not [string]::IsNullOrWhiteSpace($code)) { $runnerParameters.OrgCode = $code }
  if ($IncludeHealthCommission) { $runnerParameters.IncludeHealthCommission = $true }
  if ($SmokeQuick) { $runnerParameters.SmokeQuick = $true }
  if ($NonJudicial) { $runnerParameters.NonJudicial = $true }
  if ($SkipSearch) { $runnerParameters.SkipSearch = $true }
  if ($effectiveHeadless) { $runnerParameters.Headless = $true }
  if ($NoPrompt) { $runnerParameters.NoPrompt = $true }
  if ($TemplateSlots) { $runnerParameters.TemplateSlots = $true }

  $ok = $false
  $errorText = ""
  $attemptCount = [Math]::Max(1, $MaxAttempts)
  $actualAttempts = 0
  for ($attempt = 1; $attempt -le $attemptCount; $attempt += 1) {
    $actualAttempts = $attempt
    try {
      Write-Host ("Attempt {0}/{1}" -f $attempt, $attemptCount)
      Invoke-LocalPowerShellScript -ScriptPath $runnerPath -Parameters $runnerParameters
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
  $missingEvidence = @()
  $judicialDiagnostics = $null
  $manifestPath = ""
  if ($runDir) {
    $manifestPath = Join-Path $runDir.FullName "template-slots-manifest.json"
    if (Test-Path -LiteralPath $manifestPath) {
      try {
        $manifestPayload = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
        if ($manifestPayload.requiredEvidence -and -not $manifestPayload.requiredEvidence.ok) {
          $missingEvidence = @($manifestPayload.requiredEvidence.missingRequired | ForEach-Object {
            [pscustomobject]@{ id = $_.id; label = $_.label; reason = $_.missingReason }
          })
        }
      } catch {
        $missingEvidence = @([pscustomobject]@{ id = "manifest"; label = "manifest"; reason = "manifest_required_evidence_parse_failed" })
      }
    }
    $report = Get-ChildItem -LiteralPath $runDir.FullName -Filter "*.docx" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($report) {
      $dest = Join-Path $reportsRoot $report.Name
      Copy-Item -LiteralPath $report.FullName -Destination $dest -Force
    }
    try {
      $diagnosticModuleJson = (Join-Path $SkillRoot "scripts\framework\judicial_diagnostics.js") | ConvertTo-Json -Compress
      $runDirJson = $runDir.FullName | ConvertTo-Json -Compress
      $diagnosticScript = @"
const { summarizeJudicialDiagnostics } = require($diagnosticModuleJson);
const result = summarizeJudicialDiagnostics({ runDir: $runDirJson });
process.stdout.write(JSON.stringify(result));
"@
      if ([string]::IsNullOrWhiteSpace($NodeExeForDiagnostics)) { throw "Node.js not found for judicial diagnostics" }
      $diagnosticScriptPath = Join-Path $batchRoot ("diagnostic-{0}.js" -f ([guid]::NewGuid().ToString("N")))
      Write-Utf8NoBomFile -Path $diagnosticScriptPath -Content $diagnosticScript
      $diagnosticJson = & $NodeExeForDiagnostics $diagnosticScriptPath
      Remove-Item -LiteralPath $diagnosticScriptPath -Force -ErrorAction SilentlyContinue
      if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($diagnosticJson)) {
        $judicialDiagnostics = $diagnosticJson | ConvertFrom-Json
      }
    } catch {
      $judicialDiagnostics = [pscustomobject]@{
        ok = $false
        providerUsed = $false
        missing = @()
        categories = @([pscustomobject]@{
          category = "diagnostic_failed"
          count = 1
          samples = @([pscustomobject]@{ type = "diagnostic"; reason = $_.Exception.Message })
        })
      }
    }
  }

  $summary.Add([pscustomobject]@{
    company = $company
    orgCode = $code
    ok = $ok
    attempts = $actualAttempts
    error = $errorText
    missingEvidence = $missingEvidence
    judicialDiagnostics = $judicialDiagnostics
    evidenceDir = if ($runDir) { $runDir.FullName } else { "" }
    manifest = $manifestPath
    report = if ($report) { (Join-Path $reportsRoot $report.Name) } else { "" }
  })
}

$summaryPath = Join-Path $batchRoot "batch-summary.json"
Write-Utf8NoBomFile -Path $summaryPath -Content ($summary | ConvertTo-Json -Depth 8)

$retryPlan = $null
try {
  $retryModuleJson = (Join-Path $SkillRoot "scripts\framework\retry_plan.js") | ConvertTo-Json -Compress
  $summaryPathJson = $summaryPath | ConvertTo-Json -Compress
  $retryPlanPathJson = (Join-Path $batchRoot "retry-plan.json") | ConvertTo-Json -Compress
  $retryPlanScript = @"
const fs = require("fs");
const { buildRetryPlan } = require($retryModuleJson);
const summary = JSON.parse(fs.readFileSync($summaryPathJson, "utf8").replace(/^\uFEFF/, ""));
const plan = buildRetryPlan(summary);
fs.writeFileSync($retryPlanPathJson, JSON.stringify(plan, null, 2), "utf8");
process.stdout.write(JSON.stringify(plan));
"@
  if (-not [string]::IsNullOrWhiteSpace($NodeExeForDiagnostics)) {
    $retryScriptPath = Join-Path $batchRoot ("retry-plan-{0}.js" -f ([guid]::NewGuid().ToString("N")))
    Write-Utf8NoBomFile -Path $retryScriptPath -Content $retryPlanScript
    $retryPlanJson = & $NodeExeForDiagnostics $retryScriptPath
    Remove-Item -LiteralPath $retryScriptPath -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($retryPlanJson)) {
      $retryPlan = $retryPlanJson | ConvertFrom-Json
    }
  }
} catch {
  Write-Host ("Retry plan generation failed: {0}" -f $_.Exception.Message)
}

try {
  if (-not $retryPlan) {
    $retryPath = Join-Path $batchRoot "retry-plan.json"
    if (Test-Path -LiteralPath $retryPath) {
      $retryPlan = Get-Content -Raw -Encoding UTF8 -LiteralPath $retryPath | ConvertFrom-Json
    }
  }
  $gapListPath = Join-Path $batchRoot "补证清单.md"
  Write-Utf8NoBomFile -Path $gapListPath -Content (New-GapListMarkdown -Summary @($summary) -RetryPlan $retryPlan)
} catch {
  Write-Host ("Gap list generation failed: {0}" -f $_.Exception.Message)
}

Write-Host ("BATCH_DONE {0}" -f $batchRoot)
