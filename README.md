<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# InvestWise - Enterprise Investment Management

 **Enhanced with Security, Performance & Monitoring**

A modern, full-stack enterprise investment management platform with AI-powered financial advisory.

## Project Structure

```
investwise_web_app/
├── client/          # React frontend (Vite + TypeScript)
├── server/          # Express.js backend (Node.js + MongoDB)
├── docs/            # Documentation & feature specs
├── run-dev.bat      # Start both servers (Windows)
├── setup.bat        # First-time setup script
└── start-dev.ps1    # PowerShell dev launcher
```

## What's New

- **Enhanced Security** - Helmet, rate limiting, input validation
- **Performance Optimized** - Compression, caching, timeouts
- **Monitoring** - Health checks, logging, error tracking
- **Production Ready** - Environment configs, error handling

## Quick Start

### Automated Setup (Windows)
```bash
setup.bat
```

### Manual Setup

**Prerequisites:** Node.js, MongoDB

1. **Install dependencies:**
 ```bash
 cd client && npm install && cd ..
 cd server && npm install && cd ..
 ```

2. **Configure environment:**
 - Copy `client/.env.example` to `client/.env.local`
 - Set `GEMINI_API_KEY` in `client/.env.local`
 - Copy `server/.env.example` to `server/.env`
 - Set `MONGO_URI` and `JWT_SECRET` in `server/.env`

3. **Run the app:**
 ```bash
 # Option 1: Use the launcher script
 run-dev.bat

 # Option 2: Manual (two terminals)
 # Terminal 1 - Backend
 cd server && node index.js

 # Terminal 2 - Frontend
 cd client && npm run dev
 ```

4. **Visit:** http://localhost:3004

## Documentation

- **[docs/SETUP.md](docs/SETUP.md)** - Comprehensive setup guide
- **[docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md)** - All applied enhancements
- **[docs/](docs/)** - Feature specifications

## Links

- **AI Studio:** https://ai.studio/apps/drive/1Xe3FcuNJbr7mr-4rzNMYcx1bYgeUoZRn
- **Health Check:** http://localhost:5004/api/health

## Security Features

 Helmet security headers
 Rate limiting (DDoS protection)
 Input validation & sanitization
 JWT authentication
 Password hashing (bcrypt)
 Environment variable protection

## Performance Features

 Gzip compression (~70% bandwidth reduction)
 In-memory caching
 Request timeouts
 Response optimization

---

Built with using React, Node.js, MongoDB & Gemini AI
