param(
  [string]$PythonExe = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PythonExe)) {
  $PythonExe = (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
}
if ([string]::IsNullOrWhiteSpace($PythonExe)) {
  throw "Python was not found. Install Python or pass -PythonExe."
}

Write-Host "Installing optional low-risk image text recognition component for authorized/private deployments."
Write-Host "This component is disabled by default and must be explicitly enabled by policy."
& $PythonExe -m pip install ddddocr
if ($LASTEXITCODE -ne 0) {
  throw "Optional image text recognition component installation failed."
}
Write-Host "DONE"
