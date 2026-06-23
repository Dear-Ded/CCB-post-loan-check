$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-PythonExe {
  $runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
  $candidates = @(
    $env:POST_LOAN_PYTHON_EXE,
    (Join-Path $runtimeRoot "python\python.exe"),
    (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
  )
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "Python not found"
}

Add-Type -AssemblyName System.Drawing

$repo = (Get-Location).Path
$python = Resolve-PythonExe
$work = Join-Path $env:TEMP ("ccb-build-report-test-{0}" -f ([guid]::NewGuid().ToString("N")))
$run = Join-Path $work "run"
New-Item -ItemType Directory -Path $run -Force | Out-Null

$sourceTemplate = Get-ChildItem -LiteralPath (Join-Path $repo "packages\core-skill\assets") -Filter "*.docx" | Select-Object -First 1
if (-not $sourceTemplate) { throw "source report template not found" }
$template = Join-Path $work "template.docx"
Copy-Item -LiteralPath $sourceTemplate.FullName -Destination $template -Force

$image = Join-Path $run "shot.png"
$bitmap = New-Object System.Drawing.Bitmap 1268, 755
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$bitmap.Save($image, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$manifest = Join-Path $run "template-slots-manifest.json"
$payload = [ordered]@{
  company = "Puyang Test Company"
  screenshots = @(
    [ordered]@{
      slot = 1
      name = "China Judgments Online"
      screenshot = $image
      url = "https://wenshu.court.gov.cn/"
      validation = [ordered]@{ ok = $true }
    }
  )
  requiredEvidence = [ordered]@{
    ok = $true
    missingRequired = @()
  }
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifest -Encoding UTF8

$outDocx = Join-Path $run "report-output.docx"
& $python (Join-Path $repo "packages\core-skill\scripts\build_report.py") --manifest $manifest --template $template --out $outDocx
if ($LASTEXITCODE -ne 0) { throw "build_report.py failed" }

$updated = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifest | ConvertFrom-Json
if (-not $updated.reportDocx) { throw "reportDocx was not written to manifest" }
if (-not (Test-Path -LiteralPath $updated.reportDocx)) { throw "report docx was not created" }
if ($updated.reportDocx -ne $outDocx) { throw "reportDocx does not match requested output path" }
$reportName = Split-Path -Leaf $updated.reportDocx
if ($reportName -notmatch "\.docx$") { throw "report filename does not end with .docx" }

$payload.requiredEvidence = [ordered]@{
  ok = $false
  missingRequired = @([ordered]@{ id = "judicial_wenshu"; missingReason = "missing_judgment_result" })
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifest -Encoding UTF8
$reportScript = Join-Path $repo "packages\core-skill\scripts\build_report.py"
& cmd.exe /c "`"$python`" `"$reportScript`" --manifest `"$manifest`" --template `"$template`" >nul 2>nul"
if ($LASTEXITCODE -eq 0) { throw "build_report.py should reject incomplete required evidence" }

Remove-Item -LiteralPath $work -Recurse -Force
Write-Host "build-report ok"
