@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-post-loan-check.ps1" %*
