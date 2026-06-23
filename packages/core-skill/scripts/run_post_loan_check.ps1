param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OutputRoot = "",
  [int]$ManualTimeoutSeconds = 180,
  [int]$MaxCaptureSeconds = 0,
  [switch]$Headless,
  [switch]$NoPrompt,
  [string]$OrgCode = "",
  [string[]]$Person = @(),
  [switch]$IncludeHealthCommission,
  [switch]$SmokeQuick,
  [switch]$SkipSearch,

[ValidateSet("standard", "enhanced", "deep", "expert")]
[string]$Mode = "enhanced",

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [switch]$TemplateSlots
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$CommandPath = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($CommandPath)) {
  if ($env:POST_LOAN_SKILL_ROOT -and (Test-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT)) {
    $SkillRoot = (Resolve-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT).Path
  } else {
    $candidate = Join-Path (Get-Location).Path "packages\core-skill"
    if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Split-Path -Parent (Get-Location).Path }
    $SkillRoot = (Resolve-Path -LiteralPath $candidate).Path
  }
} else {
  $SkillRoot = Split-Path -Parent (Split-Path -Parent $CommandPath)
}
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

function Resolve-ExistingPath([string[]]$Candidates, [string]$Name) {
  foreach ($candidate in $Candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "$Name not found. Set the matching POST_LOAN_* environment variable or install the bundled runtime."
}

$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$NodeExe = Resolve-ExistingPath @(
  $env:POST_LOAN_NODE_EXE,
  (Join-Path $runtimeRoot "node\bin\node.exe"),
  (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) "Node.js"
$PythonExe = Resolve-ExistingPath @(
  $env:POST_LOAN_PYTHON_EXE,
  (Join-Path $runtimeRoot "python\python.exe"),
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) "Python"
$NodeModules = Resolve-ExistingPath @(
  $env:POST_LOAN_NODE_MODULES,
  (Join-Path $runtimeRoot "node\node_modules"),
  (Join-Path (Split-Path -Parent $SkillRoot) "node_modules"),
  (Join-Path (Get-Location).Path "node_modules")
) "node_modules"
$PnpmNodeModules = Join-Path $NodeModules ".pnpm\node_modules"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutputRoot ("{0}-{1}" -f $CompanyName, $stamp)
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$stageLog = Join-Path $runDir "stage-log.txt"
function Write-Stage([string]$Message) {
  $line = "{0}`t{1}" -f (Get-Date -Format "o"), $Message
  Add-Content -LiteralPath $stageLog -Value $line -Encoding UTF8
  Write-Host $Message
}

function Write-FailureSummary([string]$Reason, [string]$Phase) {
  $screenshots = @(Get-ChildItem -LiteralPath $runDir -Filter "*.png" -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object {
      [ordered]@{
        name = $_.Name
        path = $_.FullName
        bytes = $_.Length
        lastWriteTime = $_.LastWriteTime.ToString("o")
      }
    })
  $stageLines = @()
  if (Test-Path -LiteralPath $stageLog) {
    $stageLines = @(Get-Content -Encoding UTF8 -LiteralPath $stageLog -ErrorAction SilentlyContinue | Select-Object -Last 80)
  }
  $auditPath = Join-Path $runDir "audit-events.json"
  $auditSignals = @()
  $judicialDiagnostics = $null
  if (Test-Path -LiteralPath $auditPath) {
    try {
      $audit = Get-Content -Raw -Encoding UTF8 -LiteralPath $auditPath | ConvertFrom-Json
      $auditSignals = @($audit | Where-Object {
        $_.type -match "failed|failure|cooldown|ready_probe_failed|run_failed|response"
      } | Select-Object -Last 40)
    } catch {
      $auditSignals = @([ordered]@{ type = "audit_parse_failed"; error = $_.Exception.Message })
    }
  }
  $diagnosticScript = Join-Path $SkillRoot "scripts\framework\judicial_diagnostics.js"
  if (Test-Path -LiteralPath $diagnosticScript) {
    try {
      $diagCode = @"
const { summarizeJudicialDiagnostics } = require(process.argv[1]);
const result = summarizeJudicialDiagnostics({ runDir: process.argv[2] });
console.log(JSON.stringify(result));
"@
      $diagJson = & $NodeExe -e $diagCode $diagnosticScript $runDir
      if ($LASTEXITCODE -eq 0 -and $diagJson) {
        $judicialDiagnostics = $diagJson | ConvertFrom-Json
      }
    } catch {
      $judicialDiagnostics = [ordered]@{ ok = $false; error = $_.Exception.Message }
    }
  }
  $payload = [ordered]@{
    ok = $false
    finalReportGenerated = $false
    company = $CompanyName
    orgCode = $OrgCode
    mode = $Mode
    judicialMode = $JudicialMode
    phase = $Phase
    reason = $Reason
    runDir = $runDir
    generatedAt = (Get-Date).ToString("o")
    screenshots = $screenshots
    judicialDiagnostics = $judicialDiagnostics
    stageLogTail = $stageLines
    auditSignals = $auditSignals
    nextAction = "Required judicial/execution official result screenshots were not confirmed. Re-run later or run an assisted official browser session when the source is reachable; supplemental sources cannot replace formal evidence."
  }
  $jsonPath = Join-Path $runDir "failure-summary.json"
  $mdPath = Join-Path $runDir "failure-summary.md"
  $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  $shotLines = @($screenshots | ForEach-Object { "- $($_.name)" })
  $md = @(
    "# Query Failure Diagnostics",
    "",
    "- Company: $CompanyName",
    "- Mode: $Mode",
    "- Phase: $Phase",
    "- Reason: $Reason",
    "- Real screenshots captured: $($screenshots.Count)",
    "- Formal report: not generated",
    "",
    "## Captured Screenshots"
  ) + $shotLines + @(
    "",
    "## Next Action",
    $payload.nextAction
  )
  $md | Set-Content -LiteralPath $mdPath -Encoding UTF8
  Write-Stage "failure summary written: $jsonPath"
}

function Stop-ProcessTreeBestEffort([int]$RootProcessId) {
  try { Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-RequiredEvidenceSummary([string]$ManifestPath) {
  if ([string]::IsNullOrWhiteSpace($ManifestPath) -or -not (Test-Path -LiteralPath $ManifestPath)) {
    return @()
  }
  try {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
    if ($manifest.requiredEvidence -and -not $manifest.requiredEvidence.ok) {
      return @($manifest.requiredEvidence.missingRequired | ForEach-Object {
        [pscustomobject]@{
          id = [string]$_.id
          label = [string]$_.label
          reason = [string]$_.missingReason
        }
      })
    }
  } catch {
    return @([pscustomobject]@{
      id = "manifest"
      label = "manifest"
      reason = "manifest_required_evidence_parse_failed"
    })
  }
  return @()
}

function Format-RequiredEvidenceSummary([object[]]$MissingEvidence) {
  if (-not $MissingEvidence -or $MissingEvidence.Count -eq 0) { return "" }
  return @($MissingEvidence | ForEach-Object { "$($_.id):$($_.reason)" }) -join ", "
}

function Write-MinimalFailureSummary([string]$Reason, [string]$Phase, [string]$ManifestPath = "") {
  $missingEvidence = @(Get-RequiredEvidenceSummary -ManifestPath $ManifestPath)
  $evidenceSummary = Format-RequiredEvidenceSummary -MissingEvidence $missingEvidence
  $effectiveReason = $Reason
  if ($Phase -eq "report_build" -and -not [string]::IsNullOrWhiteSpace($evidenceSummary)) {
    $effectiveReason = "Report build blocked by missing required evidence: $evidenceSummary"
  }
  $nextAction = if (-not [string]::IsNullOrWhiteSpace($evidenceSummary)) {
    "Required evidence is still missing: $evidenceSummary. Re-run the official source capture for those items, then rebuild the report."
  } else {
    "Inspect stage-log.txt and audit-events.json. Required judicial/execution evidence was not confirmed, so the formal report was not generated."
  }
  $screenshots = @(Get-ChildItem -LiteralPath $runDir -Filter "*.png" -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object {
      [ordered]@{
        name = $_.Name
        path = $_.FullName
        bytes = $_.Length
        lastWriteTime = $_.LastWriteTime.ToString("o")
      }
    })
  $category = if ($Reason -match "timed out|timeout") {
    "capture_timeout"
  } elseif ($Reason -match "exit code 1|failed") {
    "required_judicial_evidence_missing"
  } elseif ($Reason -match "manifest") {
    "manifest_not_created"
  } else {
    "run_failed"
  }
  $payload = [ordered]@{
    ok = $false
    finalReportGenerated = $false
    company = $CompanyName
    orgCode = $OrgCode
    mode = $Mode
    judicialMode = $JudicialMode
    phase = $Phase
    reason = $effectiveReason
    runDir = $runDir
    generatedAt = (Get-Date).ToString("o")
    screenshots = $screenshots
    missingEvidence = $missingEvidence
    judicialDiagnostics = [ordered]@{
      ok = $false
      categories = @([ordered]@{
        category = $category
        count = 1
        samples = @([ordered]@{ type = "timeout"; reason = $Reason })
      })
    }
    nextAction = $nextAction
  }
  $jsonPath = Join-Path $runDir "failure-summary.json"
  $mdPath = Join-Path $runDir "failure-summary.md"
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  $md = @(
    "# Query Failure Diagnostics",
    "",
    "- Company: $CompanyName",
    "- Mode: $Mode",
    "- Phase: $Phase",
    "- Reason: $effectiveReason",
    "- Real screenshots captured: $($screenshots.Count)",
    "- Formal report: not generated"
  )
  if ($missingEvidence.Count -gt 0) {
    $md += ""
    $md += "## Missing Evidence"
    $md += @($missingEvidence | ForEach-Object { "- $($_.id): $($_.reason)" })
  }
  $md | Set-Content -LiteralPath $mdPath -Encoding UTF8
  Write-Stage "minimal failure summary written: $jsonPath"
}

function Invoke-NodeWithOptionalTimeout {
  param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [Parameter(Mandatory=$true)]
    [string[]]$Arguments,

    [Parameter(Mandatory=$true)]
    [string]$TimeoutPhase
  )

  if ($MaxCaptureSeconds -le 0) {
    & $FilePath @Arguments
    return $LASTEXITCODE
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.UseShellExecute = $false
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false

  if ($null -ne $psi.ArgumentList) {
    foreach ($arg in $Arguments) { [void]$psi.ArgumentList.Add($arg) }
  } else {
    $escapedArgs = @($Arguments | ForEach-Object {
      '"' + ([string]$_).Replace('\', '\\').Replace('"', '\"') + '"'
    })
    $psi.Arguments = $escapedArgs -join " "
  }

  $process = [System.Diagnostics.Process]::Start($psi)
  Write-Stage "timeout guard armed for process $($process.Id): $MaxCaptureSeconds seconds"
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not $process.HasExited -and $stopwatch.Elapsed.TotalSeconds -lt $MaxCaptureSeconds) {
    Start-Sleep -Milliseconds 500
    try { $process.Refresh() } catch {}
  }
  if (-not $process.HasExited) {
    Write-Stage ("timeout guard triggered after {0:n1} seconds" -f $stopwatch.Elapsed.TotalSeconds)
    $reason = "Portal capture timed out after $MaxCaptureSeconds seconds"
    Write-MinimalFailureSummary -Reason $reason -Phase $TimeoutPhase
    Write-Stage "timeout reached; stopping process tree $($process.Id)"
    Stop-ProcessTreeBestEffort -RootProcessId $process.Id
    throw $reason
  }
  Write-Stage "process $($process.Id) exited with code $($process.ExitCode)"
  return $process.ExitCode
}
Write-Stage "run directory prepared: $runDir"

$env:NODE_PATH = "$NodeModules;$PnpmNodeModules"
$env:POST_LOAN_SKILL_ROOT = $SkillRoot
$env:PYTHONUTF8 = "1"
$env:POST_LOAN_STAGE_LOG = $stageLog

$effectiveTemplateSlots = $true
$captureScript = if ($effectiveTemplateSlots) { "scripts\capture_template_slots.js" } else { "scripts\capture_portals.js" }
$effectiveHeadless = $Headless -or ($effectiveTemplateSlots -and $SmokeQuick -and $NoPrompt)

if ($effectiveTemplateSlots) {
  $captureArgs = @((Join-Path $SkillRoot $captureScript), "--company", $CompanyName, "--out-dir", $runDir)
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $captureArgs += @("--org-code", $OrgCode) }
  foreach ($p in $Person) { $captureArgs += @("--person", $p) }
  if ($IncludeHealthCommission) { $captureArgs += "--include-health-commission" }
  if ($SmokeQuick) { $captureArgs += "--smoke-quick" }
  if ($SkipSearch) { $captureArgs += "--skip-search" }
  if (-not [string]::IsNullOrWhiteSpace($Mode)) { $captureArgs += @("--mode", $Mode) }
  if ($effectiveHeadless) { $captureArgs += "--headless" }
  if ($NoPrompt) { $captureArgs += "--no-prompt" }
  if (-not [string]::IsNullOrWhiteSpace($JudicialMode)) { $captureArgs += @("--judicial-mode", $JudicialMode) }
  Write-Stage "starting portal capture"
  $global:LASTEXITCODE = Invoke-NodeWithOptionalTimeout -FilePath $NodeExe -Arguments $captureArgs -TimeoutPhase "portal_capture_timeout"
} else {
  $headlessArg = if ($effectiveHeadless) { "--headless" } else { "--headed" }
  $manualMode = if ($NoPrompt -or $effectiveHeadless) { "timeout" } else { "prompt" }
  Write-Stage "starting legacy portal capture"
  $legacyArgs = @((Join-Path $SkillRoot $captureScript), "--company", $CompanyName, "--out-dir", $runDir, "--manual-timeout", $ManualTimeoutSeconds, "--manual-mode", $manualMode, $headlessArg)
  $global:LASTEXITCODE = Invoke-NodeWithOptionalTimeout -FilePath $NodeExe -Arguments $legacyArgs -TimeoutPhase "legacy_portal_capture_timeout"
}

if ($LASTEXITCODE -ne 0) {
  $reason = "Portal capture failed with exit code $LASTEXITCODE"
  Write-MinimalFailureSummary -Reason $reason -Phase "portal_capture"
  throw $reason
}
Write-Stage "portal capture completed"

$manifestName = if ($effectiveTemplateSlots) { "template-slots-manifest.json" } else { "manifest.json" }
$manifestPath = Join-Path $runDir $manifestName
if (-not (Test-Path -LiteralPath $manifestPath)) {
  $reason = "Portal capture did not create $manifestName"
  Write-MinimalFailureSummary -Reason $reason -Phase "portal_capture_manifest" -ManifestPath $manifestPath
  throw $reason
}
if ($effectiveTemplateSlots -and (Test-Path -LiteralPath $manifestPath)) {
  try {
    $manifestPayload = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    $missing = @()
    if ($manifestPayload.requiredEvidence -and -not $manifestPayload.requiredEvidence.ok) {
      $missing = @($manifestPayload.requiredEvidence.missingRequired | ForEach-Object { [string]$_.id })
    }
    $repairable = @($missing | Where-Object { $_ -match "^portal_|^search_engine_pages$" })
    if ($repairable.Count -gt 0) {
      Write-Host ("Repairing missing evidence: {0}" -f ($repairable -join ", "))
      $repairArgs = @((Join-Path $SkillRoot "scripts\repair_required_evidence.js"), "--manifest", $manifestPath)
      if ($effectiveHeadless) { $repairArgs += "--headless" }
      & $NodeExe @repairArgs
    }
  } catch {
    Write-Host ("Evidence repair precheck failed: {0}" -f $_.Exception.Message)
  }
}

$buildArgs = @((Join-Path $SkillRoot "scripts\build_report.py"), "--manifest", $manifestPath)
Write-Stage "starting report build"
& $PythonExe @buildArgs
if ($LASTEXITCODE -ne 0) {
  $reason = "Report build failed with exit code $LASTEXITCODE"
  Write-MinimalFailureSummary -Reason $reason -Phase "report_build" -ManifestPath $manifestPath
  throw $reason
}

Write-Stage "report build completed"
Write-Host "DONE"
