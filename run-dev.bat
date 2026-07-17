@echo off
title InvestWise Development Launcher

set "FRONTEND_PORT=3004"
set "BACKEND_PORT=5004"
set "ROOT_DIR=%~dp0"

echo.
echo ========================================
echo   InvestWise v2 - Development Launcher
echo ========================================
echo   Frontend : http://localhost:%FRONTEND_PORT%
echo   Backend  : http://localhost:%BACKEND_PORT%
echo ========================================
echo.

:: Check client node_modules
if not exist "%ROOT_DIR%client\node_modules\" (
    echo [FAIL] client\node_modules not found
    echo        Run: cd client ^&^& npm install
    pause
    exit /b 1
)

:: Check server node_modules
if not exist "%ROOT_DIR%server\node_modules\" (
    echo [FAIL] server\node_modules not found
    echo        Run: cd server ^&^& npm install
    pause
    exit /b 1
)

:: Check server .env
if not exist "%ROOT_DIR%server\.env" (
    echo [WARN] server\.env not found - backend may fail
)

:: Free ports
echo [..] Freeing ports...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%FRONTEND_PORT%" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BACKEND_PORT%" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

:: Start Backend
echo [..] Starting Backend...
start "InvestWise-Backend" cmd /k "cd /d %ROOT_DIR%server && set PORT=%BACKEND_PORT% && set CORS_ORIGINS=http://localhost:%FRONTEND_PORT%,http://localhost:3000,http://localhost:5173 && echo Backend: http://localhost:%BACKEND_PORT% && echo. && npx tsx src/index.ts"

:: Start Frontend
echo [..] Starting Frontend...
start "InvestWise-Frontend" cmd /k "cd /d %ROOT_DIR%client && set VITE_API_URL=http://localhost:%BACKEND_PORT%/api && echo Frontend: http://localhost:%FRONTEND_PORT% && echo. && npm run dev -- --port %FRONTEND_PORT%"

echo.
echo ========================================
echo   Both servers launching in new windows
echo ========================================
echo.
pause
