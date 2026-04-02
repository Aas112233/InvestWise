<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# InvestWise - Enterprise Investment Management

🚀 **Enhanced with Security, Performance & Monitoring**

A modern, full-stack enterprise investment management platform with AI-powered financial advisory.

## ✨ What's New

- 🔒 **Enhanced Security** - Helmet, rate limiting, input validation
- ⚡ **Performance Optimized** - Compression, caching, timeouts
- 📊 **Monitoring** - Health checks, logging, error tracking
- 🛡️ **Production Ready** - Environment configs, error handling

## 🚀 Quick Start

### Automated Setup (Windows)
```bash
setup.bat
```

### Manual Setup

**Prerequisites:** Node.js, MongoDB

1. **Install dependencies:**
   ```bash
   npm install
   cd server && npm install && cd ..
   ```

2. **Configure environment:**
   - Copy `.env.example` to `.env.local`
   - Set `GEMINI_API_KEY` in `.env.local`
   - Copy `server/.env.example` to `server/.env`
   - Set `MONGO_URI` and `JWT_SECRET` in `server/.env`

3. **Run the app:**
   ```bash
   # Terminal 1 - Backend
   cd server && npm run dev
   
   # Terminal 2 - Frontend
   npm run dev
   ```

4. **Visit:** http://localhost:3000

## 📚 Documentation

- **[SETUP.md](SETUP.md)** - Comprehensive setup guide
- **[ENHANCEMENTS.md](ENHANCEMENTS.md)** - All applied enhancements
- **[docs/](docs/)** - Feature specifications

## 🔗 Links

- **AI Studio:** https://ai.studio/apps/drive/1Xe3FcuNJbr7mr-4rzNMYcx1bYgeUoZRn
- **Health Check:** http://localhost:5000/api/health

## 🛡️ Security Features

✅ Helmet security headers  
✅ Rate limiting (DDoS protection)  
✅ Input validation & sanitization  
✅ JWT authentication  
✅ Password hashing (bcrypt)  
✅ Environment variable protection  

## ⚡ Performance Features

✅ Gzip compression (~70% bandwidth reduction)  
✅ In-memory caching  
✅ Request timeouts  
✅ Response optimization  

---

Built with ❤️ using React, Node.js, MongoDB & Gemini AI
