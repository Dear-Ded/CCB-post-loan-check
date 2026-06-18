param(
  [Parameter(Mandatory=$true)]
  [string[]]$CompanyName,

  [string[]]$OrgCode = @(),

  [switch]$IncludeHealthCommission,

  [switch]$SkipJudicial,

  [switch]$SkipSearch,

  [switch]$RetryFailed,

  [int]$MaxAttempts = 1,

  [ValidateSet("auto", "assisted", "blocked")]
  [string]$JudicialMode = "assisted",

  [switch]$NoPrompt,

  [switch]$TemplateSlots
)

$runner = Join-Path $PSScriptRoot "packages\core-skill\scripts\run_batch_post_loan_check.ps1"
$argsList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $runner,
  "-JudicialMode", $JudicialMode,
  "-MaxAttempts", $MaxAttempts
)

foreach ($company in $CompanyName) { $argsList += @("-CompanyName", $company) }
foreach ($code in $OrgCode) { $argsList += @("-OrgCode", $code) }
if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
if ($SkipJudicial) { $argsList += "-SkipJudicial" }
if ($SkipSearch) { $argsList += "-SkipSearch" }
if ($RetryFailed) { $argsList += "-RetryFailed" }
if ($NoPrompt) { $argsList += "-NoPrompt" }
if ($TemplateSlots) { $argsList += "-TemplateSlots" }

& powershell.exe @argsList
