param(
  [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"

$CommandPath = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($CommandPath)) {
  if ($env:POST_LOAN_SKILL_ROOT -and (Test-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT)) {
    $skillRoot = (Resolve-Path -LiteralPath $env:POST_LOAN_SKILL_ROOT).Path
  } else {
    $candidate = Join-Path (Get-Location).Path "packages\core-skill"
    if (-not (Test-Path -LiteralPath $candidate)) {
      $candidate = Split-Path -Parent (Get-Location).Path
    }
    $skillRoot = (Resolve-Path -LiteralPath $candidate).Path
  }
} else {
  $skillRoot = Split-Path -Parent (Split-Path -Parent $CommandPath)
}

$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$nodeExe = if ($env:POST_LOAN_NODE_EXE) { $env:POST_LOAN_NODE_EXE } else { Join-Path $runtimeRoot "node\bin\node.exe" }
$pythonExe = if ($env:POST_LOAN_PYTHON_EXE) { $env:POST_LOAN_PYTHON_EXE } else { Join-Path $runtimeRoot "python\python.exe" }
$nodeModules = if ($env:POST_LOAN_NODE_MODULES) { $env:POST_LOAN_NODE_MODULES } else { Join-Path $runtimeRoot "node\node_modules" }
$chromeExe = if ($env:POST_LOAN_CHROME_EXE) {
  $env:POST_LOAN_CHROME_EXE
} else {
  $chromeCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  )
  ($chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1)
}

$templateItem = Get-ChildItem -LiteralPath (Join-Path $skillRoot "assets") -Filter "*.docx" | Select-Object -First 1
$template = if ($templateItem) { $templateItem.FullName } else { Join-Path $skillRoot "assets\template.docx" }
$outputRoot = if ($env:POST_LOAN_OUTPUT_ROOT) {
  $env:POST_LOAN_OUTPUT_ROOT
} else {
  $productDirName = [string]::Concat(
    [char]67, [char]67, [char]66,
    [char]36151, [char]21069, [char]36151, [char]21518,
    [char]26597, [char]35810
  )
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) (Join-Path $productDirName "outputs")
}

$checks = [ordered]@{
  skillRoot = $skillRoot
  node = [ordered]@{ ok = (Test-Path -LiteralPath $nodeExe); path = $nodeExe }
  python = [ordered]@{ ok = (Test-Path -LiteralPath $pythonExe); path = $pythonExe }
  nodeModules = [ordered]@{ ok = (Test-Path -LiteralPath $nodeModules); path = $nodeModules }
  chrome = [ordered]@{ ok = (Test-Path -LiteralPath $chromeExe); path = $chromeExe }
  template = [ordered]@{ ok = (Test-Path -LiteralPath $template); path = $template }
  outputRoot = [ordered]@{ ok = (Test-Path -LiteralPath $outputRoot); path = $outputRoot }
  canWriteOutput = $false
  messages = @()
}

try {
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $probe = Join-Path $outputRoot ".workbuddy-preflight.tmp"
  "ok" | Set-Content -LiteralPath $probe -Encoding UTF8
  Remove-Item -LiteralPath $probe -Force
  $checks.canWriteOutput = $true
} catch {
  $checks.messages += "Output folder is not writable. WorkBuddy should select another user-writable folder."
}

foreach ($key in @("node", "python", "nodeModules", "chrome", "template", "outputRoot")) {
  if (-not $checks[$key].ok) {
    $checks.messages += "Missing runtime component: $key"
  }
}

$checks.ok = $checks.node.ok -and $checks.python.ok -and $checks.nodeModules.ok -and $checks.chrome.ok -and $checks.template.ok -and $checks.canWriteOutput

if ($Json) {
  $checks | ConvertTo-Json -Depth 6
} else {
  if ($checks.ok) {
    Write-Host "WorkBuddy preflight OK"
  } else {
    Write-Host "WorkBuddy preflight failed"
    $checks.messages | ForEach-Object { Write-Host "- $_" }
  }
}
