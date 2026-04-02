# 🎯 Quick Reference - InvestWise Enhancements

## 📦 Installation

```bash
# Run automated setup
setup.bat

# OR manual install
npm install
cd server && npm install
```

## 🔧 Configuration

**Frontend (.env.local):**
```env
VITE_API_URL=http://localhost:5000/api
GEMINI_API_KEY=your_key_here
```

**Backend (server/.env):**
```env
MONGO_URI=mongodb://localhost:27017/investwise
JWT_SECRET=change_this_secret
PORT=5000
NODE_ENV=development
```

## 🚀 Running

```bash
# Backend (Terminal 1)
cd server && npm run dev

# Frontend (Terminal 2)
npm run dev
```

## 🔍 Testing Enhancements

### Health Check
```bash
curl http://localhost:5000/api/health
```

### Rate Limiting Test
```bash
# Try 6 login attempts quickly - 6th should fail
for i in {1..6}; do curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"test"}'; done
```

### Validation Test
```bash
# Invalid email should return 400
curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d '{"email":"invalid","password":"123"}'
```

## 📊 New Endpoints

- `GET /api/health` - System health status
- `GET /api/ping` - Simple availability check

## 🛡️ Security Middleware Applied

1. **helmet** - Security headers
2. **express-rate-limit** - Rate limiting
3. **express-validator** - Input validation
4. **compression** - Response compression
5. **morgan** - Request logging

## 📁 New Files

```
server/middleware/
├── errorHandler.js    # Global error handling
├── validator.js       # Input validation
├── rateLimiter.js     # Rate limiting
└── logger.js          # Request logging

server/routes/
└── healthRoutes.js    # Health monitoring

server/utils/
└── cache.js           # Caching system

server/logs/           # Log files
```

## 🔑 Key Features

### Rate Limits
- Auth routes: 5 requests / 15 min
- API routes: 100 requests / 15 min

### Validation Rules
- Email: Valid format, normalized
- Password: Min 6 characters
- Name: Min 2 characters

### Caching
- TTL: 5 minutes
- Type: In-memory
- Applies to: GET requests

### Logging
- Dev: Console (colored)
- Prod: File (access.log)

## 🐛 Troubleshooting

**Port already in use:**
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

**MongoDB connection failed:**
- Check MONGO_URI in server/.env
- Ensure MongoDB is running

**Rate limit hit:**
- Wait 15 minutes
- Or restart server (dev only)

## 📈 Performance Gains

- **Compression:** ~70% bandwidth reduction
- **Caching:** Reduced DB queries
- **Timeouts:** Prevents hanging requests
- **Validation:** Early request rejection

## 🔐 Security Checklist

- ✅ Environment variables secured
- ✅ Rate limiting enabled
- ✅ Input validation active
- ✅ Security headers set
- ✅ Error messages sanitized
- ✅ JWT expiration configured
- ✅ Password hashing enabled

## 📞 Support

Check logs: `server/logs/access.log`
Health status: http://localhost:5000/api/health
