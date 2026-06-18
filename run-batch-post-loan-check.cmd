@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-batch-post-loan-check.ps1" %*
