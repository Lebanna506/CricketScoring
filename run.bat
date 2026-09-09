@echo off
setlocal
cd /d "%~dp0"

set PORT=8080

where python >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server with Python...
    start "Cricket Scorer Server" cmd /k python -m http.server %PORT%
    goto :openBrowser
)

where py >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server with Python (py launcher)...
    start "Cricket Scorer Server" cmd /k py -m http.server %PORT%
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
