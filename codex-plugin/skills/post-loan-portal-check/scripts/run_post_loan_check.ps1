param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OutputRoot = "",

  [int]$ManualTimeoutSeconds = 180,

  [switch]$Headless,

  [switch]$NoPrompt,

  [string]$OrgCode = "",

  [string[]]$Person = @(),

  [switch]$IncludeHealthCommission,

  [switch]$SkipJudicial,

  [switch]$SkipSearch,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [switch]$TemplateSlots
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DefaultOutputRoot = if ($env:POST_LOAN_OUTPUT_ROOT) {
  $env:POST_LOAN_OUTPUT_ROOT
} else {
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) "CCB贷前贷后查询\outputs"
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

$env:NODE_PATH = "$NodeModules;$PnpmNodeModules"
$env:POST_LOAN_SKILL_ROOT = $SkillRoot
$env:PYTHONUTF8 = "1"

$captureScript = if ($TemplateSlots) { "scripts\capture_template_slots.js" } else { "scripts\capture_portals.js" }
$effectiveHeadless = $Headless -or ($TemplateSlots -and $SkipJudicial -and $NoPrompt)

if ($TemplateSlots) {
  $captureArgs = @((Join-Path $SkillRoot $captureScript), "--company", $CompanyName, "--out-dir", $runDir)
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $captureArgs += @("--org-code", $OrgCode) }
  foreach ($p in $Person) { $captureArgs += @("--person", $p) }
  if ($IncludeHealthCommission) { $captureArgs += "--include-health-commission" }
  if ($SkipJudicial) { $captureArgs += "--skip-judicial" }
  if ($SkipSearch) { $captureArgs += "--skip-search" }
  if ($effectiveHeadless) { $captureArgs += "--headless" }
  if (-not [string]::IsNullOrWhiteSpace($JudicialMode)) { $captureArgs += @("--judicial-mode", $JudicialMode) }
  & $NodeExe @captureArgs
} else {
  $headlessArg = if ($effectiveHeadless) { "--headless" } else { "--headed" }
  $manualMode = if ($NoPrompt -or $effectiveHeadless) { "timeout" } else { "prompt" }
  & $NodeExe (Join-Path $SkillRoot $captureScript) `
    --company $CompanyName `
    --out-dir $runDir `
    --manual-timeout $ManualTimeoutSeconds `
    --manual-mode $manualMode `
    $headlessArg
}

if ($LASTEXITCODE -ne 0) { throw "Portal capture failed with exit code $LASTEXITCODE" }

$manifestName = if ($TemplateSlots) { "template-slots-manifest.json" } else { "manifest.json" }
$buildArgs = @((Join-Path $SkillRoot "scripts\build_report.py"), "--manifest", (Join-Path $runDir $manifestName))
if ($NoPrompt -or $effectiveHeadless) { $buildArgs += "--allow-unverified" }
& $PythonExe @buildArgs

if ($LASTEXITCODE -ne 0) { throw "Report build failed with exit code $LASTEXITCODE" }

Write-Host "DONE"
