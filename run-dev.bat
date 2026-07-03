@echo off
setlocal
title InvestWise Development Launcher
set "FRONTEND_PORT=3004"
set "BACKEND_PORT=5004"
set "FRONTEND_API_URL=http://localhost:%BACKEND_PORT%/api"
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "BACKEND_DIR=%ROOT_DIR%\server"
set "FRONTEND_DIR=%ROOT_DIR%\client"

echo ========================================
echo InvestWise - Dev Server Launcher
echo ========================================
echo.

:: Check for frontend node_modules
if not exist "client\node_modules\" (
    echo [!] Frontend dependencies not found. Please run 'setup.bat' first.
    pause
    exit /b 1
)

:: Check for backend node_modules
if not exist "server\node_modules\" (
    echo [!] Backend dependencies not found. Please run 'setup.bat' first.
    pause
    exit /b 1
)

echo [+] Freeing up ports (%FRONTEND_PORT%, %BACKEND_PORT%)...
:: Kill process on port %FRONTEND_PORT% (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do (
    echo [!] Killing process %%a on port %FRONTEND_PORT%...
    taskkill /F /PID %%a >nul 2>&1
)

:: Kill process on port %BACKEND_PORT% (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%BACKEND_PORT% ^| findstr LISTENING') do (
    echo [!] Killing process %%a on port %BACKEND_PORT%...
    taskkill /F /PID %%a >nul 2>&1
)

:: Brief pause to ensure ports are released
timeout /t 2 /nobreak >nul

echo [+] Starting Backend Server (Port %BACKEND_PORT%)...
start "Backend Server" cmd /k "cd /d ""%BACKEND_DIR%"" && set PORT=%BACKEND_PORT% && set CORS_ORIGINS=http://localhost:%FRONTEND_PORT%,http://localhost:3000,http://localhost:5173,http://localhost:%BACKEND_PORT% && npx tsx index.js"

echo [+] Starting Frontend Server (Port %FRONTEND_PORT%)...
start "Frontend Server" cmd /k "cd /d ""%FRONTEND_DIR%"" && set VITE_API_URL=%FRONTEND_API_URL% && npm run dev -- --port %FRONTEND_PORT%"

echo.
echo ========================================
echo Both servers are starting in separate windows.
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend:  http://localhost:%BACKEND_PORT%
echo ========================================
echo.
pause
