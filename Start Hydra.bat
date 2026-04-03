@echo off
:: ─────────────────────────────────────────────────────────────────
::  Hydra — Windows Launcher
::  Double-click this file to start Hydra.
:: ─────────────────────────────────────────────────────────────────

title Hydra Launcher
chcp 65001 >nul

:: Move to the script's own directory (works from any location)
cd /d "%~dp0"

echo.
echo   ╔════════════════════════════════╗
echo   ║   H Y D R A  L A U N C H E R  ║
echo   ╚════════════════════════════════╝
echo.

:: ── Check for Node.js ──────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ✗  Node.js not found!
    echo.
    echo   Hydra requires Node.js v18 or higher.
    echo   Download it from: https://nodejs.org
    echo.
    start "" "https://nodejs.org/en/download"
    echo   Press any key to close...
    pause >nul
    exit /b 1
)

:: Check Node version
for /f "tokens=1 delims=." %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
    echo   ✗  Node.js v18+ required.
    for /f %%v in ('node -e "process.stdout.write(process.versions.node)"') do echo   You have v%%v.
    echo.
    echo   Download the latest: https://nodejs.org
    echo.
    start "" "https://nodejs.org/en/download"
    echo   Press any key to close...
    pause >nul
    exit /b 1
)

:: ── Launch ─────────────────────────────────────────────────────
node launch.js

:: Keep window open on error
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   ✗  Hydra failed to start. See the error above.
    echo   Press any key to close...
    pause >nul
)
