param(
  [switch]$Accept,
  [switch]$Revoke,
  [switch]$EnterprisePrivate,
  [string]$ConsentFile = ""
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($ConsentFile)) {
  $ConsentFile = Join-Path $env:USERPROFILE ".codex\post-loan-portal-check\challenge-risk-consent.json"
}

$warning = @"
高风险来源自动策略确认

普通公开、授权、内部数据源默认自动导航、填充和重试。
司法、政务、执行类来源在标准模式下默认托管处理。
企业私有化部署可启用 enterprise-private 档位：管理员全局确认后，高风险来源可按策略文件进入自动模式，再由企业按源关闭。

这是一次全局确认，不是逐个数据源确认。启用前请确认：
1. 你对相关数据源拥有合法授权或使用权限；
2. 部署环境、账号使用、访问频率符合相关规则；
3. 你理解高风险来源自动策略可能带来的合规、账号和风控责任；
4. 你愿意对该配置选择承担责任。

确认后，本机会记住该选择；也可以用 -Revoke 撤销，或设置更保守策略来关闭。
"@

if ($Revoke) {
  if (Test-Path -LiteralPath $ConsentFile) {
    Remove-Item -LiteralPath $ConsentFile -Force
  }
  Write-Host "DONE revoked"
  exit 0
}

if (-not $Accept) {
  Write-Host $warning
  Write-Host ""
  Write-Host "如需确认并持久开启，请重新运行并增加 -Accept。"
  exit 2
}

$dir = Split-Path -Parent $ConsentFile
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$payload = [ordered]@{
  highRiskAutoAccepted = $true
  acceptedAt = (Get-Date).ToUniversalTime().ToString("o")
  acceptedBy = $env:USERNAME
  scope = "global"
  deploymentProfile = if ($EnterprisePrivate) { "enterprise-private" } else { "default" }
  warning = "User accepted responsibility for high-risk source auto handling configuration when enabled by policy."
}
$payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConsentFile -Encoding UTF8
Write-Host "DONE $ConsentFile"
