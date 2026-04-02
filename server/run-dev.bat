@echo off
setlocal
title InvestWise Development Launcher

echo ========================================
echo InvestWise - Dev Server Launcher
echo ========================================
echo.

:: Check for frontend node_modules
if not exist "node_modules\" (
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

echo [+] Freeing up ports (3000, 5000)...
:: Kill process on port 3000 (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [!] Killing process %%a on port 3000...
    taskkill /F /PID %%a >nul 2>&1
)

:: Kill process on port 5000 (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do (
    echo [!] Killing process %%a on port 5000...
    taskkill /F /PID %%a >nul 2>&1
)

:: Brief pause to ensure ports are released
timeout /t 2 /nobreak >nul

echo [+] Starting Backend Server (Port 5000)...
start "Backend Server" cmd /k "cd server && npm run dev"

echo [+] Starting Frontend Server (Port 3000)...
start "Frontend Server" cmd /k "npm run dev"

echo.
echo ========================================
echo Both servers are starting in separate windows.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:5000
echo ========================================
echo.
pause
