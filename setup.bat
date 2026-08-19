@echo off
setlocal enabledelayedexpansion

title InvestWise - Initial Setup and Database Provisioning Wizard

cls
echo ======================================================================
echo          INVESTWISE ENTERPRISE ASSET MANAGEMENT SYSTEM                
echo          Automated Database and Application Setup Wizard                
echo ======================================================================
echo.

:: 1. Check Node.js Prerequisites
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js 20 or higher from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Check npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed or not in PATH!
    echo.
    pause
    exit /b 1
)

echo [1/4] Checking and installing server dependencies...
if not exist "server\node_modules\" (
    echo Installing server dependencies - please wait...
    cd server
    call npm install
    if !errorlevel! neq 0 (
        echo [ERROR] Server npm install failed!
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo Server dependencies are already installed.
)

echo.
echo [2/4] Checking and installing client dependencies...
if not exist "client\node_modules\" (
    echo Installing client dependencies - please wait...
    cd client
    call npm install
    if !errorlevel! neq 0 (
        echo [ERROR] Client npm install failed!
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo Client dependencies are already installed.
)

echo.
echo [3/4] Ensuring logs directory exists...
if not exist "server\logs" mkdir "server\logs"

echo.
echo [4/4] Starting Interactive Database and Admin Setup Wizard...
echo.
cd server
call npm run db:init
set DB_INIT_STATUS=!errorlevel!
cd ..

if !DB_INIT_STATUS! neq 0 (
    echo.
    echo [ERROR] Database setup wizard encountered an issue.
    echo Please verify your database connection credentials and try again.
    echo.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo  SETUP COMPLETE!
echo ======================================================================
echo.
set /p START_NOW="Would you like to start the application now? (y/n) [y]: "
if /i "!START_NOW!"=="" set START_NOW=y
if /i "!START_NOW!"=="y" (
    echo Starting InvestWise Dev Servers...
    call run-dev.bat
) else (
    echo You can start the app anytime by running: run-dev.bat
    echo.
    pause
)
