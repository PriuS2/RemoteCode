@echo off
chcp 65001 >nul 2>&1
powershell -ExecutionPolicy Bypass -NoExit -Command "& {. '%~dp0start-dev.ps1'}"
