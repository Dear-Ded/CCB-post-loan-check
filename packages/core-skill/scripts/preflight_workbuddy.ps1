param(
  [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"

$skillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeExe = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$pythonExe = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$nodeModules = "C:\Users\80983\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$chromeExe = "C:\Users\80983\AppData\Local\Google\Chrome\Application\chrome.exe"
$templateItem = Get-ChildItem -LiteralPath (Join-Path $skillRoot "assets") -Filter "*.docx" | Select-Object -First 1
$template = if ($templateItem) { $templateItem.FullName } else { Join-Path $skillRoot "assets\template.docx" }
$outputRoot = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("RDpc6aG555uu5paH5Lu2XOS4reW7uum7hOays+Wkp+ahpei0t+WQjlxvdXRwdXRz"))

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
