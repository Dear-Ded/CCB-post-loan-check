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

  [switch]$TemplateSlots
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DefaultOutputRoot = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("RDpc6aG555uu5paH5Lu2XOS4reW7uum7hOays+Wkp+ahpei0t+WQjlxvdXRwdXRz"))
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = $DefaultOutputRoot }
$NodeExe = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$PythonExe = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$NodeModules = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$PnpmNodeModules = Join-Path $NodeModules ".pnpm\node_modules"

if (-not (Test-Path -LiteralPath $NodeExe)) { throw "Bundled Node.js not found: $NodeExe" }
if (-not (Test-Path -LiteralPath $PythonExe)) { throw "Bundled Python not found: $PythonExe" }
if (-not (Test-Path -LiteralPath $NodeModules)) { throw "Bundled node_modules not found: $NodeModules" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutputRoot ("{0}-{1}" -f $CompanyName, $stamp)
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$env:NODE_PATH = "$NodeModules;$PnpmNodeModules"
$env:POST_LOAN_SKILL_ROOT = $SkillRoot
$env:PYTHONUTF8 = "1"

$captureScript = if ($TemplateSlots) { "scripts\capture_template_slots.js" } else { "scripts\capture_portals.js" }

if ($TemplateSlots) {
  $captureArgs = @((Join-Path $SkillRoot $captureScript), "--company", $CompanyName, "--out-dir", $runDir)
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $captureArgs += @("--org-code", $OrgCode) }
  foreach ($p in $Person) { $captureArgs += @("--person", $p) }
  if ($IncludeHealthCommission) { $captureArgs += "--include-health-commission" }
  & $NodeExe @captureArgs
} else {
  $headlessArg = if ($Headless) { "--headless" } else { "--headed" }
  $manualMode = if ($NoPrompt -or $Headless) { "timeout" } else { "prompt" }
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
if ($NoPrompt -or $Headless) { $buildArgs += "--allow-unverified" }
& $PythonExe @buildArgs

if ($LASTEXITCODE -ne 0) { throw "Report build failed with exit code $LASTEXITCODE" }

Write-Host "DONE"
