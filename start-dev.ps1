# InvestWise Dev Server Starter Script

Write-Host "Initializing InvestWise Development Environment..." -ForegroundColor Cyan

# Function to kill process on a specific port
function Kill-Port($port) {
    $processes = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($processes) {
        foreach ($process in $processes) {
            try {
                $pidVal = $process.OwningProcess
                $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host "Killing process on port $port (PID: $pidVal)..." -ForegroundColor Yellow
                    Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
                }
            }
            catch {
                Write-Host "Could not kill process on port $port. It might already be gone." -ForegroundColor DarkGray
            }
        }
    }
    else {
        Write-Host "Port $port is free." -ForegroundColor Green
    }
}

# 1. Kill potentially stuck processes
Write-Host "Cleaning up ports 3000 (Frontend) and 5000 (Backend)..." -ForegroundColor Magenta
Kill-Port 3000
Kill-Port 5000

# Wait a moment for ports to clear
Start-Sleep -Seconds 1

# 2. Start Backend Server
Write-Host "Starting Backend Server on Port 5000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {cd server; Write-Host 'Starting Backend...'; npm.cmd run dev}"

# 3. Start Frontend Server
Write-Host "Starting Frontend Server on Port 3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {Write-Host 'Starting Frontend...'; npm.cmd run dev}"

Write-Host "Development environment started!" -ForegroundColor Green
Write-Host "Backend: http://localhost:5000"
Write-Host "Frontend: http://localhost:3000"
