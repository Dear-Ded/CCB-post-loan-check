param(
  [Parameter(Mandatory=$true)]
  [string]$CompanyName,
  [string]$OrgCode = "",
  [switch]$IncludeHealthCommission,
  [string[]]$Person = @()
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runner = Join-Path $root "core-skill\workbuddy\run_workbuddy.ps1"
$argsList = @("-CompanyName", $CompanyName)
if ($OrgCode) { $argsList += @("-OrgCode", $OrgCode) }
if ($IncludeHealthCommission) { $argsList += "-IncludeHealthCommission" }
foreach ($p in $Person) { $argsList += @("-Person", $p) }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner @argsList
