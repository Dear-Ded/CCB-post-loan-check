param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string]$OutputRoot = "",

  [string[]]$Person = @(),

  [switch]$IncludeHealthCommission,

  [switch]$TemplateSlots,

  [switch]$SkipSearch,

  [switch]$SmokeQuick,

  [ValidateSet("standard", "enhanced", "deep", "expert")]
  [string]$Mode = "",

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [int]$ManualTimeoutSeconds = 180,

  [switch]$Headless,

  [switch]$NoPrompt
)

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$runner = Join-Path $Root "packages\core-skill\scripts\run_post_loan_check.ps1"
$parameters = @{
  CompanyName = $CompanyName
  ManualTimeoutSeconds = $ManualTimeoutSeconds
}

if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $parameters.OrgCode = $OrgCode }
if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) { $parameters.OutputRoot = $OutputRoot }
if ($Person.Count -gt 0) { $parameters.Person = $Person }
if ($IncludeHealthCommission) { $parameters.IncludeHealthCommission = $true }
if ($TemplateSlots) { $parameters.TemplateSlots = $true }
if ($SkipSearch) { $parameters.SkipSearch = $true }
if ($SmokeQuick) { $parameters.SmokeQuick = $true }
if (-not [string]::IsNullOrWhiteSpace($Mode)) { $parameters.Mode = $Mode }
if (-not [string]::IsNullOrWhiteSpace($JudicialMode)) { $parameters.JudicialMode = $JudicialMode }
if ($Headless) { $parameters.Headless = $true }
if ($NoPrompt) { $parameters.NoPrompt = $true }

$scriptText = Get-Content -Raw -Encoding UTF8 -LiteralPath $runner
$scriptBlock = [scriptblock]::Create($scriptText)
& $scriptBlock @parameters
