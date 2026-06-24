param(
  [string]$CompanyName = "",
  [string]$OrgCode = "UNIFIED_SOCIAL_CREDIT_CODE",
  [string]$SecondCompanyName = "",
  [switch]$Live,
  [ValidateSet("all", "platforms", "batch", "search", "monitor")]
  [string]$Scope = "all",
  [switch]$SkipSearch,
  [switch]$IncludeBatchSearch,
  [switch]$AllowJudicialSkipForFastSmoke,
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  $ProjectRoot = (Get-Location).Path
} else {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
function ConvertFrom-CodePoints([int[]]$CodePoints) {
  return (-join ([char[]]$CodePoints))
}
if ([string]::IsNullOrWhiteSpace($CompanyName)) {
  $CompanyName = [string](ConvertFrom-CodePoints @(28654,38451,35947,33021,32508,21512,33021,28304,26377,38480,20844,21496))
}
if ([string]::IsNullOrWhiteSpace($SecondCompanyName)) {
  $SecondCompanyName = [string](ConvertFrom-CodePoints @(28654,38451,24066,20013,24314,40644,27827,22823,26725,24037,31243,31649,29702,26377,38480,20844,21496))
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $env:TEMP ("ccb-acceptance-" + [guid]::NewGuid().ToString("N"))
}
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS)) {
  $env:POST_LOAN_MANAGED_CONFIRMATION_WAIT_MS = "3000"
}
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED)) {
  $env:POST_LOAN_JUDGMENT_FAST_FAIL_AUTH_REQUIRED = "1"
}
if ([string]::IsNullOrWhiteSpace($env:POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS)) {
  $env:POST_LOAN_JUDGMENT_HOME_FAST_FAIL_TIMEOUT_MS = "8000"
}

function Invoke-Step([string]$Name, [scriptblock]$Body) {
  Write-Host "== $Name"
  & $Body
  Write-Host "OK $Name"
}

function Test-Output([string]$Path) {
  $contractScript = Join-Path $ProjectRoot "tools\test-output-contract.ps1"
  $json = & ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 -LiteralPath $contractScript))) -OutputRoot $Path -Json
  $json | Out-Host
  $payload = $json | ConvertFrom-Json
  if (-not $payload.ok) {
    throw "Output contract failed for $Path"
  }
}

function Test-SmokeOutput([string]$Path) {
  $summaries = @(Get-ChildItem -LiteralPath $Path -Recurse -Filter "failure-summary.json" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
  if ($summaries.Count -lt 1) {
    throw "Smoke run did not create failure-summary.json under $Path"
  }
  $latest = $summaries | Select-Object -First 1
  $payload = Get-Content -Raw -Encoding UTF8 -LiteralPath $latest.FullName | ConvertFrom-Json
  if ($payload.ok -ne $false) {
    throw "Smoke failure summary must be explicit ok=false: $($latest.FullName)"
  }
  if ($payload.finalReportGenerated -ne $false) {
    throw "Smoke failure summary must not mark a formal report as generated: $($latest.FullName)"
  }
  if ([string]::IsNullOrWhiteSpace([string]$payload.reason)) {
    throw "Smoke failure summary must include a failure reason: $($latest.FullName)"
  }
  $docx = @(Get-ChildItem -LiteralPath $Path -Recurse -Filter "*.docx" -ErrorAction SilentlyContinue)
  if ($docx.Count -gt 0) {
    throw "Smoke run must not create formal Word reports: $($docx[0].FullName)"
  }
  [pscustomobject]@{
    ok = $true
    smoke = $true
    outputRoot = $Path
    failureSummary = $latest.FullName
    reason = $payload.reason
  } | ConvertTo-Json -Depth 4 | Out-Host
}

function Invoke-AndValidateRun([string]$OutputPath, [scriptblock]$Body) {
  $runError = $null
  try {
    & $Body
  } catch {
    $runError = $_
  }

  if ($AllowJudicialSkipForFastSmoke) {
    if ($runError) {
      Write-Host ("Smoke run produced expected non-final status: {0}" -f $runError.Exception.Message)
    }
    Test-SmokeOutput $OutputPath
    return
  }

  if ($runError) { throw $runError }
  Test-Output $OutputPath
}

function Convert-ParameterHashtableToArgs([hashtable]$Parameters) {
  $args = @()
  foreach ($key in $Parameters.Keys) {
    $value = $Parameters[$key]
    if ($value -is [bool]) {
      if ($value) { $args += "-$key" }
    } elseif ($value -is [System.Management.Automation.SwitchParameter]) {
      if ($value.IsPresent) { $args += "-$key" }
    } elseif ($value -is [array]) {
      foreach ($item in $value) {
        $args += "-$key"
        $args += [string]$item
      }
    } elseif ($null -ne $value) {
      $args += "-$key"
      $args += [string]$value
    }
  }
  return $args
}

function Invoke-ChildPowerShellScript([string]$ScriptPath, [hashtable]$Parameters) {
  $wrapper = Join-Path $env:TEMP ("ccb-ps-wrapper-{0}.ps1" -f ([guid]::NewGuid().ToString("N")))
  $wrapperText = @'
param(
  [Parameter(Mandatory=$true)]
  [string]$ScriptPath,

  [Parameter(Mandatory=$true)]
  [string]$ParametersFile
)
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$parameters = Import-Clixml -LiteralPath $ParametersFile
$scriptText = Get-Content -Raw -Encoding UTF8 -LiteralPath $ScriptPath
& ([scriptblock]::Create($scriptText)) @parameters
'@
  $parametersFile = Join-Path $env:TEMP ("ccb-ps-params-{0}.clixml" -f ([guid]::NewGuid().ToString("N")))
  Set-Content -LiteralPath $wrapper -Value $wrapperText -Encoding ASCII
  try {
    $Parameters | Export-Clixml -LiteralPath $parametersFile
    & powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $wrapper -ScriptPath $ScriptPath -ParametersFile $parametersFile
    if ($LASTEXITCODE -ne 0) {
      throw "$ScriptPath failed with exit code $LASTEXITCODE"
    }
  } finally {
    Remove-Item -LiteralPath $wrapper -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $parametersFile -Force -ErrorAction SilentlyContinue
  }
}

Push-Location $ProjectRoot
try {
  Invoke-Step "pollution-scan" {
    $dueDiligence = ConvertFrom-CodePoints @(23613,35843,25253,21578)
    $wallStreetCn = ConvertFrom-CodePoints @(21326,23572,34903)
    $legacyEnv = [string]::Concat("WALL", "STREET", "_", "TIE", "LING")
    $legacyPrefix = [string]::Concat("W", "ST", "_")
    $legacyLower = [string]::Concat("wall", "street")
    $legacyTitle = [string]::Concat("Wall", " ", "Street")
    $legacyPlace = [string]::Concat("Tie", "ling")
    $pattern = "$dueDiligence|$legacyEnv|$legacyPrefix|$legacyLower|$wallStreetCn|$legacyTitle|$legacyPlace"
    $pollution = rg -n $pattern -S --glob "!node_modules/**" .
    if ($LASTEXITCODE -eq 0 -and $pollution) { throw "Cross-project pollution found:`n$pollution" }
  }
  Invoke-Step "diff-check" { git diff --check | Out-Host }
  Invoke-Step "check-js" { cmd /c npm run check:js }
  Invoke-Step "check-bash" { cmd /c npm run check:bash }
  Invoke-Step "test-datasource" { cmd /c npm run test:datasource }
  Invoke-Step "test-graph" { cmd /c npm run test:graph }
  Invoke-Step "test-policy" { cmd /c npm run test:policy }

  if ($Live) {
    $skipSearch = [bool]$SkipSearch
    $runPlatforms = $Scope -eq "all" -or $Scope -eq "platforms"
    $runBatch = $Scope -eq "all" -or $Scope -eq "batch"
    $runSearch = $Scope -eq "all" -or $Scope -eq "search"
    $runMonitor = $Scope -eq "all" -or $Scope -eq "monitor"

    if ($runSearch) {
      Invoke-Step "search-live" {
        $out = Join-Path $OutputRoot "search"
        $scriptPath = Join-Path $ProjectRoot "packages\core-skill\scripts\run_post_loan_check.ps1"
        $parameters = @{ CompanyName = $CompanyName; OrgCode = $OrgCode; OutputRoot = $out; TemplateSlots = $true }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
        Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }
    }

    if ($runPlatforms) {
      Invoke-Step "codex-core-live" {
        $out = Join-Path $OutputRoot "core"
        $scriptPath = Join-Path $ProjectRoot "packages\core-skill\scripts\run_post_loan_check.ps1"
        $parameters = @{ CompanyName = $CompanyName; OrgCode = $OrgCode; OutputRoot = $out; TemplateSlots = $true }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
        if ($skipSearch) { $parameters.SkipSearch = $true }
        Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }

      Invoke-Step "workbuddy-live" {
        $out = Join-Path $OutputRoot "workbuddy"
        $scriptPath = Join-Path $ProjectRoot "packages\core-skill\workbuddy\run_workbuddy.ps1"
        $parameters = @{ CompanyName = $CompanyName; OrgCode = $OrgCode; OutputRoot = $out; Json = $true }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
        if ($skipSearch) { $parameters.SkipSearch = $true }
        Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }

      Invoke-Step "doubao-local-live" {
        $out = Join-Path $OutputRoot "doubao-local"
      $scriptPath = Join-Path $ProjectRoot "packages\doubao\run_doubao_local.ps1"
      $parameters = @{ CompanyName = $CompanyName; OrgCode = $OrgCode; OutputRoot = $out; Json = $true }
      if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
      if ($skipSearch) { $parameters.SkipSearch = $true }
      Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }

      Invoke-Step "doubao-mobile-live" {
        $out = Join-Path $OutputRoot "doubao-mobile"
        $scriptPath = Join-Path $ProjectRoot "packages\doubao\run_doubao_mobile.ps1"
        $parameters = @{ CompanyName = $CompanyName; OrgCode = $OrgCode; OutputRoot = $out; Json = $true }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
        if ($skipSearch) { $parameters.SkipSearch = $true }
        Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }

      Invoke-Step "doubao-app-bash-live" {
        $out = Join-Path $OutputRoot "doubao-app-bash"
        $searchArg = if ($skipSearch) { "--skip-search" } else { "" }
        $judicialArg = if ($AllowJudicialSkipForFastSmoke) { "--smoke-quick" } else { "" }
        Invoke-AndValidateRun $out {
          bash packages/doubao/run_doubao_app.sh --company $CompanyName --org-code $OrgCode --output-root $out $judicialArg $searchArg --json
          if ($LASTEXITCODE -ne 0) {
            throw "Doubao app bash failed with exit code $LASTEXITCODE"
          }
        }
      }
    }

    if ($runBatch) {
      Invoke-Step "batch-live" {
        $out = Join-Path $OutputRoot "batch"
        $companyList = "$CompanyName,$SecondCompanyName"
        $scriptPath = Join-Path $ProjectRoot "packages\core-skill\scripts\run_batch_post_loan_check.ps1"
        $parameters = @{ CompanyName = @($companyList); OutputRoot = $out }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true; $parameters.NoPrompt = $true }
        if ($skipSearch -or -not $IncludeBatchSearch) { $parameters.SkipSearch = $true }
        Invoke-AndValidateRun $out { Invoke-ChildPowerShellScript $scriptPath $parameters }
      }
    }

    if ($runMonitor) {
      Invoke-Step "monitor-live" {
        $out = Join-Path $OutputRoot "monitor"
        $state = Join-Path $out "monitor-state.json"
        $scriptPath = Join-Path $ProjectRoot "tools\run-monitor.ps1"
        $parameters = @{ CompanyName = @($CompanyName); OrgCode = @($OrgCode); OutputRoot = $out; StateFile = $state; SkipSearch = $true; Json = $true }
        if ($AllowJudicialSkipForFastSmoke) { $parameters.SmokeQuick = $true }
        $monitorError = $null
        try {
          Invoke-ChildPowerShellScript $scriptPath $parameters
        } catch {
          $monitorError = $_
        }
        if ($AllowJudicialSkipForFastSmoke) {
          if ($monitorError) {
            Write-Host ("Smoke monitor produced expected non-final status: {0}" -f $monitorError.Exception.Message)
          }
          Test-SmokeOutput $out
          return
        }
        if ($monitorError) { throw $monitorError }
        $summary = Get-ChildItem -LiteralPath $out -Recurse -Filter "monitor-summary.json" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $summary) { throw "monitor-summary.json was not created" }
      $payload = Get-Content -Raw -Encoding UTF8 -LiteralPath $summary.FullName | ConvertFrom-Json
      if (-not $payload.ok -or @($payload.companies).Count -lt 1) { throw "Monitor summary did not contain a valid company result" }
      Test-Output $payload.monitorRoot
      }
    }
  }

  [pscustomobject]@{
    ok = $true
    live = [bool]$Live
    scope = $Scope
    skipSearch = [bool]$SkipSearch
    includeBatchSearch = [bool]$IncludeBatchSearch
    outputRoot = $OutputRoot
  } | ConvertTo-Json -Depth 4
} finally {
  Pop-Location
}
