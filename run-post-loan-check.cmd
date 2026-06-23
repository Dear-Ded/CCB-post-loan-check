@echo off
powershell.exe -NoProfile -Command "$scriptPath=$args[0]; $scriptArgs=@($args | Select-Object -Skip 1); & ([scriptblock]::Create((Get-Content -Raw -LiteralPath $scriptPath))) @scriptArgs" "%~dp0run-post-loan-check.ps1" %*
