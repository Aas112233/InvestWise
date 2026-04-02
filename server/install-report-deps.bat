@echo off
echo Installing PDF and Excel generation dependencies...
cd server
npm install pdfkit@0.15.0 exceljs@4.4.0
echo.
echo Dependencies installed successfully!
echo Please restart the backend server.
pause
