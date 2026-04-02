# 📋 Environment Variables Setup Guide

## Overview
Proper separation of frontend and backend environment variables with 4 dedicated files.

---

## ✅ **Environment Files Structure**

```
project-root/
├── .env                    # Frontend - Local development (DO NOT COMMIT)
├── .env.example            # Frontend - Template (SAFE TO COMMIT)
└── server/
    ├── .env                # Backend - Local development (DO NOT COMMIT)
    └── .env.example        # Backend - Template (SAFE TO COMMIT)
```

---

## 📁 **File Descriptions**

### 1. **Frontend `.env`** 
**Location:** `/.env`  
**Purpose:** Local frontend development  
**Commit:** ❌ **NEVER** (in .gitignore)  
**Loaded By:** Vite (frontend build tool)

```bash
VITE_API_URL=http://localhost:5000/api
VITE_LONGCAT_API_KEY=your-api-key-here
```

### 2. **Frontend `.env.example`**
**Location:** `/.env.example`  
**Purpose:** Template for frontend developers  
**Commit:** ✅ **SAFE** (commit to version control)  
**Loaded By:** No one (reference only)

```bash
VITE_API_URL=http://localhost:5000/api
VITE_LONGCAT_API_KEY=
```

### 3. **Backend `.env`**
**Location:** `/server/.env`  
**Purpose:** Local backend development  
**Commit:** ❌ **NEVER** (in .gitignore)  
**Loaded By:** Node.js (dotenv)

```bash
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=your-secret-key
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 4. **Backend `.env.example`**
**Location:** `/server/.env.example`  
**Purpose:** Template for backend developers  
**Commit:** ✅ **SAFE** (commit to version control)  
**Loaded By:** No one (reference only)

```bash
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

---

## 🔍 **How Environment Loading Works**

### Frontend (Vite)
```javascript
// Vite automatically loads from:
// 1. .env.local
// 2. .env.development
// 3. .env

// Access in code:
import.meta.env.VITE_API_URL
```

### Backend (Node.js + dotenv)
```javascript
// Explicitly load from server/.env
dotenv.config({ path: '.env' });

// Access in code:
process.env.MONGO_URI
process.env.JWT_SECRET
```

---

## 🚀 **Setup Instructions**

### Step 1: Frontend Setup

```bash
# From project root
cp .env.example .env

# Edit .env and update:
VITE_API_URL=http://localhost:5000/api
VITE_LONGCAT_API_KEY=your-key-if-needed
```

### Step 2: Backend Setup

```bash
# From project root
cd server
cp .env.example .env

# Edit .env and update:
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=$(openssl rand -base64 64)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Step 3: Start Development

```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend
npm run dev
```

---

## 📊 **Variables Reference**

### Frontend Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_URL` | ✅ Yes | Backend API URL | `http://localhost:5000/api` |
| `VITE_LONGCAT_API_KEY` | ❌ No | AI features key | `your-api-key` |

### Backend Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | ✅ Yes | Environment | `development`, `production` |
| `PORT` | ✅ Yes | Server port | `5000` |
| `MONGO_URI` | ✅ Yes | MongoDB connection | `mongodb://localhost:27017/db` |
| `JWT_SECRET` | ✅ Yes | JWT signing key | `random-string` |
| `CORS_ORIGINS` | ✅ Yes | Allowed origins | `http://localhost:5173` |

---

## 🔐 **Security Best Practices**

### ✅ DO:
- Use `.env.example` files as templates
- Keep `.env` files out of version control
- Generate strong random secrets
- Use different secrets for dev/staging/production
- Rotate secrets periodically

### ❌ DON'T:
- Commit `.env` files to Git
- Share `.env` files publicly
- Use weak secrets like "secret123"
- Use production secrets in development

---

## 🎯 **Production Deployment**

### Frontend (Vercel/Netlify)

Set environment variables in platform dashboard:

```
VITE_API_URL=https://api.yourdomain.com/api
VITE_LONGCAT_API_KEY=your-key
```

### Backend (Render/Heroku/Railway)

Set environment variables in platform dashboard:

```
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
JWT_SECRET=very-long-random-string
CORS_ORIGINS=https://yourdomain.com
```

---

## 🧪 **Testing Configuration**

### Verify Frontend Env

Create `src/test-env.jsx`:
```javascript
console.log('Frontend Env:', {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_LONGCAT_API_KEY: import.meta.env.VITE_LONGCAT_API_KEY ? '✅ Set' : '❌ Missing',
});
```

### Verify Backend Env

Add to `server/index.js`:
```javascript
console.log('Backend Env:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGO_URI: process.env.MONGO_URI ? '✅ Set' : '❌ Missing',
  JWT_SECRET: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
});
```

---

## ⚠️ **Troubleshooting**

### Issue: Frontend can't find VITE_API_URL

**Solution:** Check file location
```bash
# Should be in project root
/.env  ✅
/server/.env  ❌
```

### Issue: Backend can't find MONGO_URI

**Solution:** Check dotenv config path
```javascript
// In server/index.js
dotenv.config({ path: '.env' });  // ✅ Correct
dotenv.config();  // ❌ Wrong (looks in wrong directory)
```

### Issue: Variables not updating

**Solution:** Restart development servers
```bash
# Stop both servers (Ctrl+C)

# Restart backend
cd server && npm run dev

# Restart frontend (new terminal)
npm run dev
```

---

## 📝 **Quick Start Commands**

### Complete Setup (Fresh Clone)

```bash
# Frontend
cp .env.example .env

# Backend
cd server
cp .env.example .env

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 64)

# Update .env files with your values

# Start both servers
npm run dev  # Frontend
# In another terminal:
cd server && npm run dev  # Backend
```

### Production Build

```bash
# Frontend - Set production API URL
VITE_API_URL=https://api.yourdomain.com/api npm run build

# Backend - Set production env vars
export NODE_ENV=production
export MONGO_URI=mongodb+srv://...
npm start
```

---

## 📋 **Checklist**

### Development Setup
- [ ] Copied `/.env.example` to `/.env`
- [ ] Updated `VITE_API_URL` in `/.env`
- [ ] Copied `/server/.env.example` to `/server/.env`
- [ ] Updated `MONGO_URI` in `/server/.env`
- [ ] Changed `JWT_SECRET` in `/server/.env`
- [ ] Updated `CORS_ORIGINS` in `/server/.env`
- [ ] Both servers start without errors

### Production Deployment
- [ ] Set all env vars in hosting platform
- [ ] Used strong production secrets
- [ ] Updated CORS for production domain
- [ ] Tested API connectivity
- [ ] Verified database connection

---

## 🎯 **Summary**

| File | Location | Purpose | Commit? |
|------|----------|---------|---------|
| Frontend `.env` | `/` | Local dev | ❌ Never |
| Frontend Example | `/.env.example` | Template | ✅ Yes |
| Backend `.env` | `/server/` | Local dev | ❌ Never |
| Backend Example | `/server/.env.example` | Template | ✅ Yes |

**Total Files:** 4 (2 active + 2 templates)  
**Separation:** ✅ Frontend & Backend isolated  
**Security:** ✅ Sensitive data protected

---

**Status**: ✅ **CONFIGURED**  
**Files Created:** 4  
**Separation:** **Frontend + Backend**  
**Ready for:** **Development & Production**
