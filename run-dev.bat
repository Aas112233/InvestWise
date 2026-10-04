@echo off
setlocal EnableDelayedExpansion
title InvestWise Development Launcher

:: ============================================================================
::  InvestWise - Development Launcher
:: ----------------------------------------------------------------------------
::  Usage:
::    run-dev.bat [port] [flags]
::
::  Flags:
::    --port <n>        Next.js dev port              (default 3000)
::    --lint            Run eslint before booting
::    --test            Run vitest before booting
::    --i18n            Validate the 4 locale files before booting
::    --migrate         Apply pending Drizzle migrations, then boot
::    --seed            Seed the bootstrap superadmin, then boot
::    --doctor          Run preflight checks only, do not start the server
::    --fresh           Wipe .next build cache before booting
::    --help            Show this help and exit
::
::  Examples:
::    run-dev.bat                        normal boot with preflight
::    run-dev.bat 3005                   boot on port 3005
::    run-dev.bat --lint --test          run lint + tests, then boot
::    run-dev.bat --doctor               environment check only
:: ============================================================================

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

:: PowerShell is resolved by absolute path so port detection still works when the
:: shell PATH is unusual (32-bit/MSYS launch). The remaining Windows tools are
:: called unquoted elsewhere on purpose: a quoted absolute path inside a
:: `for /f` command string fails with "The filename, directory name, or volume
:: label syntax is incorrect".
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" set "POWERSHELL=powershell"

:: --- Defaults ---------------------------------------------------------------
set "NEXT_PORT=3000"
set "RUN_LINT=0"
set "RUN_TEST=0"
set "RUN_I18N=0"
set "RUN_MIGRATE=0"
set "RUN_SEED=0"
set "DOCTOR_ONLY=0"
set "FRESH=0"
set "EXIT_CODE=0"
set "FAILURES=0"

:: ============================================================================
::  ARGUMENT PARSING
::  Accepts: bare number = port, "--port 3005", plus any combination of flags.
::  Unknown args fail loudly instead of being silently ignored.
:: ============================================================================
:parse_args
if "%~1"=="" goto :args_done

set "ARG=%~1"
set "ARG=!ARG:"=!"

if "!ARG!"=="--help"    goto :usage
if "!ARG!"=="-h"        goto :usage
if "!ARG!"=="/?"        goto :usage
if "!ARG!"=="--lint"     set "RUN_LINT=1"   & shift & goto :parse_args
if "!ARG!"=="--test"     set "RUN_TEST=1"   & shift & goto :parse_args
if "!ARG!"=="--i18n"     set "RUN_I18N=1"   & shift & goto :parse_args
if "!ARG!"=="--migrate"  set "RUN_MIGRATE=1" & shift & goto :parse_args
if "!ARG!"=="--seed"     set "RUN_SEED=1"   & shift & goto :parse_args
if "!ARG!"=="--doctor"   set "DOCTOR_ONLY=1" & shift & goto :parse_args
if "!ARG!"=="--fresh"    set "FRESH=1"      & shift & goto :parse_args

if "!ARG!"=="--port" (
    if "%~2"=="" (
        echo [FAIL] --port requires a value, e.g. --port 3005
        exit /b 1
    )
    set "NEXT_PORT=%~2"
    shift & shift & goto :parse_args
)

:: Bare-port shorthand: run-dev.bat 3005
set "PORT_TEST=!ARG!"
set "PORT_TEST=!PORT_TEST:--=!"
echo !PORT_TEST!| findstr /r "^[0-9][0-9]*$" >nul
if not errorlevel 1 (
    set "NEXT_PORT=!PORT_TEST!"
    shift & goto :parse_args
)

echo [FAIL] Unknown argument: !ARG!
echo        Run "%~nx0 --help" for the accepted flags.
exit /b 1

:args_done
:: Validate the port range
set /a PORT_NUM=NEXT_PORT 2>nul
if errorlevel 1 (
    echo [FAIL] Invalid port: %NEXT_PORT%
    exit /b 1
)
if %PORT_NUM% LSS 1024 (
    echo [FAIL] Port %NEXT_PORT% is privileged. Use 1024-65535.
    exit /b 1
)
if %PORT_NUM% GTR 65535 (
    echo [FAIL] Port %NEXT_PORT% is out of range. Use 1024-65535.
    exit /b 1
)

:: ============================================================================
::  BANNER
:: ============================================================================
echo.
echo ================================================
echo   InvestWise - Development Launcher
echo ================================================
echo   App      : http://localhost:%NEXT_PORT%
echo   Landing  : http://localhost:%NEXT_PORT%/login
echo   Root     : %ROOT_DIR%
if "%RUN_LINT%"=="1"     echo   Gates    : + lint
if "%RUN_TEST%"=="1"     echo   Gates    : + tests
if "%RUN_I18N%"=="1"     echo   Gates    : + i18n validation
if "%RUN_MIGRATE%"=="1"  echo   DB       : migrate before boot
if "%RUN_SEED%"=="1"     echo   DB       : seed before boot
if "%FRESH%"=="1"        echo   Cache    : .next will be cleared
echo ================================================
echo.

:: ============================================================================
::  PREFLIGHT 1/4 - Node.js and npm on PATH, version floor
:: ============================================================================
where node >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Node.js not found on PATH.
    echo        Install Node.js 20+ from https://nodejs.org then retry.
    call :die
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [FAIL] npm not found on PATH.
    call :die
)

:: AGENTS.md / Next.js 15 mandate Node 20+. Parse the major version and gate.
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
    echo [FAIL] Could not determine the Node.js version.
    call :die
)
if %NODE_MAJOR% LSS 20 (
    echo [FAIL] Node %NODE_MAJOR%.x detected. Next.js 15 requires Node 20 or newer.
    echo        Upgrade from https://nodejs.org then retry.
    call :die
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node %%v ^(npm supported^)

:: ============================================================================
::  PREFLIGHT 2/4 - Dependencies installed
:: ============================================================================
if not exist "%ROOT_DIR%\node_modules\" (
    echo [..] node_modules missing. Installing root dependencies...
    echo      First run only; this can take a few minutes.
    pushd "%ROOT_DIR%"
    :: legacy-peer-deps works around an npm 11 arborist peer-resolution bug
    :: with the vitest dependency tree.
    call npm install --legacy-peer-deps --no-audit --no-fund
    if errorlevel 1 (
        echo [FAIL] npm install failed. See output above.
        popd
        call :die
    )
    popd
    echo [OK] Dependencies installed.
) else (
    echo [OK] node_modules present.
)

:: ============================================================================
::  PREFLIGHT 3/4 - Environment file present and actually usable
:: ============================================================================
if not exist "%ROOT_DIR%\.env.local" (
    if exist "%ROOT_DIR%\.env.example" (
        echo [..] No .env.local - creating from .env.example...
        copy "%ROOT_DIR%\.env.example" "%ROOT_DIR%\.env.local" >nul
        echo.
        echo [WARN] .env.local was just created from the template. Edit it first:
        echo          DATABASE_URL        Postgres connection string  (REQUIRED^)
        echo          JWT_SECRET          min 16 chars                (REQUIRED^)
        echo          JWT_REFRESH_SECRET  min 16 chars                (REQUIRED^)
        echo          CRON_SECRET         backup endpoint shared secret
        echo.
        call :die
    ) else (
        echo [FAIL] .env.local is missing and no .env.example exists to copy from.
        call :die
    )
)

:: Confirm the required keys are present AND carry a non-placeholder value.
:: A copied template with "change-me-..." must not boot silently.
set "ENV_MISSING="
call :check_env DATABASE_URL
call :check_env JWT_SECRET
call :check_env JWT_REFRESH_SECRET
call :check_env CRON_SECRET
if defined ENV_MISSING (
    echo [FAIL] .env.local is incomplete or still holds template placeholders:
    echo          !ENV_MISSING!
    echo        Fill these in before starting the dev server.
    call :die
)
echo [OK] .env.local present with required keys.

:: ============================================================================
::  PREFLIGHT 4/4 - Free the port (confirm what we are killing)
:: ============================================================================
call :free_port %NEXT_PORT%

:: `--doctor` stops here with a clean bill of health.
if "%DOCTOR_ONLY%"=="1" (
    echo.
    if "%FAILURES%"=="0" (
        echo [OK] Doctor: all preflight checks passed. Nothing was started.
    ) else (
        echo [WARN] Doctor finished with %FAILURES% warning^(s^) above.
    )
    echo.
    exit /b 0
)

:: ============================================================================
::  OPTIONAL: clear the Next.js build cache
:: ============================================================================
if "%FRESH%"=="1" (
    if exist "%ROOT_DIR%\.next" (
        echo [..] Clearing .next build cache...
        rmdir /s /q "%ROOT_DIR%\.next"
        echo [OK] Build cache cleared.
    ) else (
        echo [OK] No .next cache to clear.
    )
)

:: ============================================================================
::  PRE-BOOT GATES
::  Each gate failure is reported together, then the run aborts before boot.
::  Typecheck was removed from the boot path — run `npx tsc --noEmit`
::  (or `npm run typecheck`) manually when you want the full gate.
:: ============================================================================

:: --- i18n locale parity -----------------------------------------------------
if "%RUN_I18N%"=="1" (
    echo.
    echo [..] Validating 4-locale key parity...
    pushd "%ROOT_DIR%"
    call npm run i18n:validate
    if errorlevel 1 (
        echo [FAIL] i18n validation failed. Every key needs all 4 locales.
        set "FAILURES=1"
        popd
        goto :gate_abort
    )
    popd
    echo [OK] Locale files in sync.
)

:: --- Lint -------------------------------------------------------------------
if "%RUN_LINT%"=="1" (
    echo.
    echo [..] Lint: next lint
    pushd "%ROOT_DIR%"
    call npm run lint
    if errorlevel 1 (
        echo [FAIL] Lint errors found.
        set "FAILURES=1"
        popd
        goto :gate_abort
    )
    popd
    echo [OK] Lint clean.
)

:: --- Tests ------------------------------------------------------------------
if "%RUN_TEST%"=="1" (
    echo.
    echo [..] Tests: vitest run
    pushd "%ROOT_DIR%"
    call npm run test
    if errorlevel 1 (
        echo [FAIL] Tests failed.
        set "FAILURES=1"
        popd
        goto :gate_abort
    )
    popd
    echo [OK] Tests passed.
)

:: --- Database migration -----------------------------------------------------
if "%RUN_MIGRATE%"=="1" (
    echo.
    echo [..] Applying Drizzle migrations...
    pushd "%ROOT_DIR%"
    call npm run db:migrate
    if errorlevel 1 (
        echo [FAIL] Migration failed. Check DATABASE_URL and migration state.
        set "FAILURES=1"
        popd
        goto :gate_abort
    )
    popd
    echo [OK] Migrations applied.
)

:: --- Superadmin seed --------------------------------------------------------
if "%RUN_SEED%"=="1" (
    echo.
    echo [..] Seeding bootstrap superadmin ^(idempotent^)...
    pushd "%ROOT_DIR%"
    call npm run db:seed
    if errorlevel 1 (
        echo [FAIL] Seed failed. Check DATABASE_URL and database reachability.
        set "FAILURES=1"
        popd
        goto :gate_abort
    )
    popd
    echo [OK] Superadmin seeded.
)

:: ============================================================================
::  BOOT
:: ============================================================================
echo.
echo ================================================
echo   Starting Next.js dev server...
echo   Open : http://localhost:%NEXT_PORT%/login
echo   Stop : Ctrl+C
echo ================================================
echo.

pushd "%ROOT_DIR%"
call npx next dev -p %NEXT_PORT%
set "EXIT_CODE=!errorlevel!"
popd

echo.
if not "!EXIT_CODE!"=="0" (
    echo [FAIL] Dev server exited with code !EXIT_CODE!.
) else (
    echo [OK] Dev server stopped cleanly.
)
echo.
pause
exit /b !EXIT_CODE!

:: ============================================================================
::  SUBROUTINES
:: ============================================================================

:gate_abort
echo.
echo ================================================
echo   Pre-boot gate failed - server NOT started.
echo ================================================
echo.
call :die

:die
echo.
pause
exit /b 1

:: ----------------------------------------------------------------------------
:: check_env <VAR_NAME>
:: Flags the variable when absent, empty, or left at a template placeholder.
:: ----------------------------------------------------------------------------
:check_env
set "KEY=%~1"
set "VAL="
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"%KEY%=" "%ROOT_DIR%\.env.local"`) do set "VAL=%%b"
:: Strip surrounding quotes and trailing whitespace
set "VAL=!VAL:"=!"
for /f "tokens=* delims= " %%t in ("!VAL!") do set "VAL=%%t"
if not defined VAL (
    set "ENV_MISSING=!ENV_MISSING! %KEY%"
    goto :eof
)
echo !VAL!| findstr /i /c:"change-me" /c:"your-" /c:"<" >nul
if not errorlevel 1 set "ENV_MISSING=!ENV_MISSING! %KEY%"
goto :eof

:: ----------------------------------------------------------------------------
:: free_port <port>
:: Reports what is holding the port, kills it, then polls until it is released
:: instead of sleeping a fixed 2 seconds.
:: ----------------------------------------------------------------------------
:free_port
set "FP_PORT=%~1"
set "FP_FOUND=0"

:: Detection is delegated to :fp_listeners (PowerShell first, netstat fallback).
call :fp_listeners %FP_PORT%
if "!FP_FOUND!"=="0" (
    echo [OK] Port !FP_PORT! is free.
    goto :eof
)

:: Identify the owner so we do not silently kill an unrelated service.
:: tasklist CSV is "name","pid",... - slice on commas, not spaces, or the whole
:: trailing record leaks into the name.
set "FP_NAME=unknown"
for /f "tokens=1 delims=," %%n in ('tasklist /fi "PID eq !FP_PID!" /nh /fo csv 2^>nul') do (
    for /f "tokens=* delims= " %%m in ("%%~n") do set "FP_NAME=%%m"
)
echo [..] Port !FP_PORT! held by !FP_NAME! ^(PID !FP_PID!^) - stopping it...
taskkill /F /PID !FP_PID! >nul 2>&1
if errorlevel 1 (
    echo [WARN] Could not stop PID !FP_PID!. It may need elevated rights.
    echo        Stop it manually, then re-run. Or pick another port:
    echo          %~nx0 3005
    set /a FAILURES+=1
    goto :eof
)

:: Poll for release, max ~5s, instead of an unconditional sleep
set /a FP_TRIES=0
:fp_wait
set /a FP_TRIES+=1
set "FP_FOUND=0"
call :fp_listeners %FP_PORT%
if "!FP_FOUND!"=="0" (
    echo [OK] Port !FP_PORT! released.
    goto :eof
)
if !FP_TRIES! GEQ 10 (
    echo [WARN] Port !FP_PORT! still busy after 5s - the dev server may fail to bind.
    set /a FAILURES+=1
    goto :eof
)
:: timeout with a sub-second granularity is unavailable; use ping as a ~300ms timer
ping -n 1 -w 300 127.0.0.1 >nul 2>&1
goto :fp_wait

:: ----------------------------------------------------------------------------
:: fp_listeners <port>
:: Sets FP_FOUND=1 and FP_PID to the last listener PID when the port is held.
:: Primary detector is PowerShell (independent of console encoding and locale);
:: netstat is the fallback for hosts where PowerShell is unavailable or blocked.
:: ----------------------------------------------------------------------------
:fp_listeners
set "FL_PORT=%~1"
set "FL_PID="
:: Detector 1: PowerShell (locale- and encoding-independent).
:: The command is passed as a single unquoted token on purpose - nesting quoted
:: variables inside a `for /f` command string breaks cmd's parsing with
:: "is not recognized as an internal or external command".
for /f "usebackq tokens=*" %%p in (`powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -LocalPort %FL_PORT% -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1 -ExpandProperty OwningProcess" 2^>nul`) do set "FL_PID=%%p"
if defined FL_PID if not "!FL_PID!"=="0" (
    set "FP_FOUND=1"
    set "FP_PID=!FL_PID!"
    goto :eof
)
:: Detector 2: netstat fallback (also used when PowerShell is disabled by policy).
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":!FL_PORT!" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        set "FP_FOUND=1"
        set "FP_PID=%%a"
    )
)
goto :eof

:: ----------------------------------------------------------------------------
:usage
echo.
echo InvestWise Development Launcher
echo.
echo   run-dev.bat [port] [flags]
echo.
echo Port:
echo   [port]              Shorthand, e.g. "run-dev.bat 3005"     (default 3000)
echo   --port ^<n^>          Same, explicit form
echo.
echo Flags:
echo   --lint              Run eslint before booting
echo   --test              Run vitest before booting
echo   --i18n              Validate the 4 locale files before booting
echo   --migrate           Apply pending Drizzle migrations, then boot
echo   --seed              Seed the bootstrap superadmin, then boot
echo   --doctor            Run preflight checks only, do not start the server
echo   --fresh             Wipe .next build cache before booting
echo   --help              Show this help
echo.
echo Examples:
echo   run-dev.bat                             normal boot (preflight)
echo   run-dev.bat 3005                        boot on port 3005
echo   run-dev.bat --lint --test               full verification, then boot
echo   run-dev.bat --migrate --seed            provision the DB, then boot
echo   run-dev.bat --doctor                    environment check only
echo.
exit /b 0
