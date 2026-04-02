# 📋 Environment Variables Guide

## Overview
Consolidated environment configuration for both frontend and backend.

---

## ✅ **Active .env Files**

### 1. **Root `.env`** (Main Configuration)
**Location:** `/.env`  
**Used By:** Both Frontend (Vite) and Backend (Node.js)  
**Status:** ✅ **ACTIVE**

```bash
# Server
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=your-secret-key
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Frontend
VITE_API_URL=http://localhost:5000/api
VITE_LONGCAT_API_KEY=
```

---

## 📁 **Template Files**

### 1. **`/.env.example`**
**Purpose:** Template for frontend developers  
**Copy To:** `/.env`  
**Variables:** Frontend only

### 2. **`/server/.env.example`**  
**Purpose:** Template for backend developers  
**Copy To:** `/server/.env` (if needed)  
**Variables:** Backend only

---

## 🔍 **How dotenv Loads**

### Default Behavior
```javascript
import dotenv from 'dotenv';
dotenv.config();  // Loads .env from current directory
```

### Load Order
```
1. process.cwd()/.env  →  /.env  ✅ USED
2. .env.local          →  Not used
3. .env.development    →  Not used
```

---

## 📊 **Variable Reference**

### Required Variables

| Variable | Used By | Description | Example |
|----------|---------|-------------|---------|
| `NODE_ENV` | Backend | Environment mode | `development`, `production` |
| `PORT` | Backend | Server port | `5000` |
| `MONGO_URI` | Backend | MongoDB connection | `mongodb://localhost:27017/db` |
| `JWT_SECRET` | Backend | JWT signing key | `super-secret-key` |
| `CORS_ORIGINS` | Backend | Allowed origins | `http://localhost:5173` |
| `VITE_API_URL` | Frontend | Backend API URL | `http://localhost:5000/api` |

### Optional Variables

| Variable | Used By | Description | Default |
|----------|---------|-------------|---------|
| `VITE_LONGCAT_API_KEY` | Frontend | AI features | - |
| `EMAIL_HOST` | Backend | Email service | - |
| `EMAIL_PORT` | Backend | Email port | `587` |
| `IPINFO_TOKEN` | Backend | IP geolocation | - |

---

## 🚀 **Setup Instructions**

### 1. Development Setup

**Step 1: Copy template**
```bash
# From project root
cp .env.example .env
```

**Step 2: Configure variables**
```bash
# MongoDB (use Atlas or local)
MONGO_URI=mongodb://localhost:27017/investwise

# JWT Secret (generate random string)
JWT_SECRET=$(openssl rand -base64 32)

# API URL (for frontend)
VITE_API_URL=http://localhost:5000/api
```

**Step 3: Start servers**
```bash
# Backend
cd server && npm run dev

# Frontend (new terminal)
npm run dev
```

### 2. Production Setup

**Environment Variables (Server)**
```bash
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
JWT_SECRET=very-long-random-string
CORS_ORIGINS=https://yourdomain.com
VITE_API_URL=https://api.yourdomain.com/api
```

**Build Frontend**
```bash
# Set VITE_API_URL before build
VITE_API_URL=https://api.yourdomain.com/api npm run build
```

---

## ⚠️ **Common Issues**

### Issue: Variables not loading

**Solution:** Check .env file location
```bash
# Should be in project root
/.env  ✅
/server/.env  ❌ (Not loaded by default)
```

### Issue: Frontend can't find API

**Solution:** Set VITE_API_URL correctly
```bash
# Development
VITE_API_URL=http://localhost:5000/api

# Production (Render, Vercel, etc.)
VITE_API_URL=https://your-api.onrender.com/api
```

### Issue: CORS errors

**Solution:** Add frontend URL to CORS_ORIGINS
```bash
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,https://yourdomain.com
```

### Issue: MongoDB connection failed

**Solution:** Check MONGO_URI format
```bash
# Local MongoDB
MONGO_URI=mongodb://localhost:27017/investwise

# MongoDB Atlas
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/investwise
```

---

## 🔐 **Security Best Practices**

### 1. **Never Commit .env**
```bash
# Already in .gitignore
.env
.env.local
.env.production
```

### 2. **Use Strong Secrets**
```bash
# Generate JWT secret
openssl rand -base64 64

# Or use node
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. **Environment-Specific Files**
```bash
# Development
.env.development  →  Local testing

# Production
.env.production   →  Deployed servers
```

### 4. **Use Environment Variables in CI/CD**
```yaml
# GitHub Actions
env:
  MONGO_URI: ${{ secrets.MONGO_URI }}
  JWT_SECRET: ${{ secrets.JWT_SECRET }}
```

---

## 📦 **Deployment Platforms**

### Render.com

**Environment Variables:**
```
NODE_ENV=production
PORT=5000
MONGO_URI=<from Atlas>
JWT_SECRET=<generate>
CORS_ORIGINS=https://your-app.onrender.com
VITE_API_URL=https://your-app.onrender.com/api
```

### Vercel (Frontend)

**Environment Variables:**
```
VITE_API_URL=https://your-api.onrender.com/api
VITE_LONGCAT_API_KEY=<your-key>
```

### Heroku

**Set via CLI:**
```bash
heroku config:set MONGO_URI=mongodb+srv://...
heroku config:set JWT_SECRET=your-secret
heroku config:set CORS_ORIGINS=https://your-app.herokuapp.com
```

### Railway

**Environment Variables:**
- Add in Railway dashboard
- Auto-detects PORT
- Connect MongoDB plugin

---

## 🧪 **Testing Configuration**

### Check Loaded Variables

**Backend:**
```javascript
// Add to server/index.js
console.log('Loaded env:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGO_URI: process.env.MONGO_URI ? '✅ Set' : '❌ Missing',
  JWT_SECRET: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
});
```

**Frontend:**
```javascript
// In browser console
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
```

### Validate Configuration

**Script: `validate-env.js`**
```javascript
import dotenv from 'dotenv';
dotenv.config();

const required = ['MONGO_URI', 'JWT_SECRET', 'PORT'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required env variables:', missing);
  process.exit(1);
}

console.log('✅ All required env variables loaded');
```

---

## 📝 **Quick Reference**

### Development
```bash
# .env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=dev-secret-key
CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:5000/api
```

### Production
```bash
# .env.production
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
JWT_SECRET=very-long-random-string-here
CORS_ORIGINS=https://yourdomain.com
VITE_API_URL=https://api.yourdomain.com/api
```

### Testing
```bash
# .env.test
NODE_ENV=test
PORT=5001
MONGO_URI=mongodb://localhost:27017/investwise-test
JWT_SECRET=test-secret
CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:5001/api
```

---

## 🎯 **Summary**

| File | Purpose | Status |
|------|---------|--------|
| `/.env` | Main configuration | ✅ **ACTIVE - USE THIS** |
| `/.env.example` | Frontend template | 📋 Reference only |
| `/server/.env.example` | Backend template | 📋 Reference only |

**Recommendation:** Use single `/.env` file for simplicity. Both frontend and backend will load from it.

---

**Status**: ✅ **CONSOLIDATED**  
**Active Files**: 1 (`/.env`)  
**Template Files**: 2 (`.env.example`, `server/.env.example`)  
**Configuration**: **Unified**
