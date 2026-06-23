param(
  [Parameter(Mandatory=$true)]
  [string[]]$CompanyName,

  [string[]]$OrgCode = @(),

  [string]$OutputRoot = "",

  [switch]$IncludeHealthCommission,

  [switch]$SkipSearch,

  [switch]$SmokeQuick,

  [switch]$RetryFailed,

  [int]$MaxAttempts = 2,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [ValidateSet("standard", "enhanced", "deep", "expert")]
  [string]$Mode = "enhanced",

  [switch]$NoPrompt,

  [switch]$TemplateSlots
)

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$runner = Join-Path $Root "packages\core-skill\scripts\run_batch_post_loan_check.ps1"
$parameters = @{
  JudicialMode = $JudicialMode
  Mode = $Mode
  MaxAttempts = $MaxAttempts
  CompanyName = $CompanyName
}

if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $parameters.OutputRoot = $OutputRoot }
if ($OrgCode.Count -gt 0) { $parameters.OrgCode = $OrgCode }
if ($IncludeHealthCommission) { $parameters.IncludeHealthCommission = $true }
if ($SkipSearch) { $parameters.SkipSearch = $true }
if ($SmokeQuick) { $parameters.SmokeQuick = $true }
if ($RetryFailed) { $parameters.RetryFailed = $true }
if ($NoPrompt) { $parameters.NoPrompt = $true }
if ($TemplateSlots) { $parameters.TemplateSlots = $true }

$scriptText = Get-Content -Raw -Encoding UTF8 -LiteralPath $runner
$scriptBlock = [scriptblock]::Create($scriptText)
& $scriptBlock @parameters
