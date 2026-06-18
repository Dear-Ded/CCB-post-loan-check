param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,

  [string]$OrgCode = "",

  [string[]]$Person = @(),

  [switch]$IncludeHealthCommission,

  [switch]$TemplateSlots,

  [switch]$SkipJudicial,

  [switch]$SkipSearch,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [int]$ManualTimeoutSeconds = 180,

  [switch]$Headless,

  [switch]$NoPrompt
)

$runner = Join-Path $PSScriptRoot "packages\core-skill\scripts\run_post_loan_check.ps1"
$argsList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $runner,
  "-CompanyName", $CompanyName,
  "-ManualTimeoutSeconds", $ManualTimeoutSeconds
)

if (-not [string]::IsNullOrWhiteSpace($OrgCode)) { $argsList += @("-OrgCode", $OrgCode) }
foreach ($p in $Person) { $argsList += @("-Person", $p) }
if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
if ($TemplateSlots) { $argsList += "-TemplateSlots" }
if ($SkipJudicial) { $argsList += "-SkipJudicial" }
if ($SkipSearch) { $argsList += "-SkipSearch" }
if (-not [string]::IsNullOrWhiteSpace($JudicialMode)) { $argsList += @("-JudicialMode", $JudicialMode) }
if ($Headless) { $argsList += "-Headless" }
if ($NoPrompt) { $argsList += "-NoPrompt" }

& powershell.exe @argsList
