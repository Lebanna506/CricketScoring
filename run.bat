@echo off
setlocal
cd /d "%~dp0"

set PORT=8080

REM --- Pull the latest version from git, if this is a git checkout ---
if not exist ".git" goto :skipupdate
where git >nul 2>nul
if errorlevel 1 goto :nogit

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set CURRENT_BRANCH=%%b
echo Checking for updates on branch "%CURRENT_BRANCH%"...
git pull --ff-only origin %CURRENT_BRANCH%
if errorlevel 1 (
    echo.
    echo ****************************************************************
    echo  Could not pull the latest changes - you may be offline, have
    echo  local edits that don't cleanly fast-forward, or "%CURRENT_BRANCH%"
    echo  might not be the branch you expect to be on.
    echo  Continuing with the files already on disk - they may be OLD.
    echo ****************************************************************
    echo.
    pause
) else (
    echo.
    for /f "delims=" %%c in ('git log -1 --oneline 2^>nul') do echo Now at: %%c
    echo.
)
goto :afterupdate

:nogit
echo Git is not installed - skipping update check.
echo Install Git from https://git-scm.com if you want this to auto-update.
goto :afterupdate

:skipupdate
echo Not a git checkout - skipping update check.

:afterupdate

REM --- Build, if this project ever grows a build step (no-op today) ---
if not exist "package.json" goto :afterbuild
where npm >nul 2>nul
if errorlevel 1 goto :afterbuild
echo Installing dependencies...
call npm install
findstr /c:"\"build\":" package.json >nul 2>nul
if errorlevel 1 goto :afterbuild
echo Building...
call npm run build

:afterbuild

where python >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server with Python...
    start "Cricket Scorer Server" cmd /k python serve.py %PORT%
    goto :openBrowser
)

where py >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server with Python (py launcher)...
    start "Cricket Scorer Server" cmd /k py serve.py %PORT%
    goto :openBrowser
)

where npx >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server with Node.js (npx serve)...
    start "Cricket Scorer Server" cmd /k npx serve -l %PORT% .
    goto :openBrowser
)

echo.
echo Could not find Python or Node.js on this PC - one of them is needed
echo to serve the app (it can't just be opened as a file).
echo.
echo Install Python from https://python.org (tick "Add to PATH" during
echo setup) or Node.js from https://nodejs.org, then run this file again.
echo.
pause
exit /b 1

:openBrowser
echo.
echo Server starting in a separate window - leave it open while you use the app.
echo Opening http://localhost:%PORT%/ in your browser...
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%/index.html"
exit /b 0
