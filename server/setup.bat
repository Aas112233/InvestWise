@echo off
echo ========================================
echo InvestWise - Quick Setup Script
echo ========================================
echo.

echo [1/5] Installing frontend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Frontend installation failed
    pause
    exit /b 1
)

echo.
echo [2/5] Installing backend dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Backend installation failed
    pause
    exit /b 1
)
cd ..

echo.
echo [3/5] Creating environment files...
if not exist .env.local (
    copy .env.example .env.local
    echo Created .env.local - Please configure your GEMINI_API_KEY
)

if not exist server\.env (
    copy server\.env.example server\.env
    echo Created server\.env - Please configure your MONGO_URI and JWT_SECRET
)

echo.
echo [4/5] Creating logs directory...
if not exist server\logs mkdir server\logs

echo.
echo [5/5] Setup complete!
echo.
echo ========================================
echo Next Steps:
echo ========================================
echo 1. Configure .env.local with your GEMINI_API_KEY
echo 2. Configure server\.env with your MONGO_URI
echo 3. Run: cd server ^&^& npm run dev (Terminal 1)
echo 4. Run: npm run dev (Terminal 2)
echo.
echo Visit: http://localhost:3000
echo ========================================
pause
