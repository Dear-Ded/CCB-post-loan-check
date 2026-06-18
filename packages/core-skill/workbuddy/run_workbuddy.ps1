param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [switch]$IncludeHealthCommission,

  [string[]]$Person = @(),

  [string]$OutputRoot = "",

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
    if ($reportPath) { Write-Host "报告：$reportPath" }
    if ($outputDir) { Write-Host "目录：$outputDir" }
  }
}

try {
  $preflightJson = powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -Json
  $preflightResult = $preflightJson | ConvertFrom-Json
  if (-not $preflightResult.ok) {
    $msg = "运行环境还没准备好：" + (($preflightResult.messages | ForEach-Object { $_ }) -join "；")
    Write-Result $false $msg
    exit 2
  }

  Write-Host "开始前只需要你做这一次："
  Write-Host "1. 我会打开浏览器并把能填的信息都填好。"
  Write-Host "2. 请登录中国裁判文书网。"
  Write-Host "3. 请在每个中国执行信息公开网页面只输入验证码。"
  Write-Host "4. 完成后不用回到聊天窗口，我会自动继续并生成报告。"

  $argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $runner,
    "-CompanyName", $CompanyName,
    "-TemplateSlots"
  )
  if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $argsList += @("-OrgCode", $OrgCode) }
  if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $argsList += @("-OutputRoot", $OutputRoot) }
  if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
  foreach ($p in $Person) { $argsList += @("-Person", $p) }

  $before = Get-Date
  & powershell.exe @argsList
  if ($LASTEXITCODE -ne 0) {
    Write-Result $false "报告没有生成，因为有页面还不是查询结果页，或登录/验证码没有完成。"
    exit $LASTEXITCODE
  }

  $outputRootPath = if ($OutputRoot) { $OutputRoot } else { $preflightResult.outputRoot.path }
  $report = Get-ChildItem -LiteralPath $outputRootPath -Recurse -Filter "*.docx" |
    Where-Object { $_.LastWriteTime -ge $before -and $_.Name -like "贷后查询-*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($report) {
    Write-Result $true "报告已生成。" $report.FullName $report.DirectoryName
    Start-Process explorer.exe -ArgumentList "/select,`"$($report.FullName)`"" | Out-Null
  } else {
    Write-Result $true "任务已完成，但没有自动定位到报告文件，请在输出目录查看。" "" $outputRootPath
  }
} catch {
  $text = $_.Exception.Message
  if ($text -match "统一社会信用代码|组织机构代码|org-code") {
    Write-Result $false "没能自动确认企业统一社会信用代码。请在开始任务时补充统一社会信用代码/组织机构代码。"
  } elseif ($text -match "Timed out waiting.*login|China Judgments") {
    Write-Result $false "裁判文书网登录没有完成或已过期。请重新开始任务，并在打开的浏览器里登录一次。"
  } elseif ($text -match "captcha|验证码") {
    Write-Result $false "还差验证码。我已经把其他信息填好了，请重新开始后只输入验证码。"
  } else {
    Write-Result $false ("任务失败：" + $text)
  }
  exit 1
}
