# Production Deployment Guide

## Architecture
- **Frontend**: InfinityFree (Apache) - Static React build
- **Backend**: Render.com - Node.js Express API
- **Database**: MongoDB Atlas (Free tier)

---

## 1. MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free cluster
3. Create a database user with password
4. Whitelist all IPs: `0.0.0.0/0` (for Render's dynamic IPs)
5. Get your connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/investwise?retryWrites=true&w=majority
   ```

---

## 2. Backend Deployment (Render)

### Step 1: Prepare the Server
The server is already configured for production with:
- Production CORS (configured via `CORS_ORIGINS` env var)
- Helmet security headers
- Compression middleware

### Step 2: Deploy to Render

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Create a **New Web Service**
4. Connect your GitHub repo
5. Configure:
   - **Name**: investwise-api
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### Step 3: Set Environment Variables in Render

Go to your service → Environment → Add these variables:

| Key | Value |
|-----|-------|
| `MONGO_URI` | `mongodb+srv://...` (your Atlas connection string) |
| `JWT_SECRET` | `a-very-long-random-secret-string-here` |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | `https://yourdomain.epizy.com,https://yourdomain.infinityfree.com` |
| `GEMINI_API_KEY` | (optional) Your Gemini API key |

> **Important**: Replace `yourdomain` with your actual InfinityFree subdomain

### Step 4: Note Your Backend URL
After deployment, Render will give you a URL like:
```
https://investwise-api.onrender.com
```

---

## 3. Frontend Deployment (InfinityFree)

### Step 1: Create Production Build

Create a `.env.production` file in the project root:
```env
VITE_API_URL=https://investwise-api.onrender.com/api
```

Build the frontend:
```bash
npm run build
```

This creates a `/dist` folder with your static files.

### Step 2: Upload to InfinityFree

1. Log in to [InfinityFree](https://www.infinityfree.net/)
2. Create a new hosting account / use existing
3. Go to **Control Panel** → **File Manager** or use **FTP**
4. Navigate to `htdocs` folder
5. Upload ALL contents of your local `/dist` folder
6. Make sure `index.html` is in the root of `htdocs`

### Step 3: Configure Apache for SPA Routing

Create a `.htaccess` file in your `htdocs` folder:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  
  # Handle existing files and directories
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  
  # Redirect all other requests to index.html
  RewriteRule ^ index.html [L]
</IfModule>

# Security headers
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  Header set X-XSS-Protection "1; mode=block"
</IfModule>

# Caching for static assets
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/png "access plus 1 month"
  ExpiresByType image/jpg "access plus 1 month"
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType image/gif "access plus 1 month"
  ExpiresByType image/svg+xml "access plus 1 month"
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
```

---

## 4. Testing Your Deployment

1. Open your InfinityFree URL in browser
2. Try to log in
3. Check browser console for any CORS errors
4. If you see CORS errors:
   - Verify `CORS_ORIGINS` in Render includes your exact frontend URL
   - Make sure there are no trailing slashes

---

## 5. Troubleshooting

### CORS Errors
- Ensure your InfinityFree domain is in `CORS_ORIGINS`
- Include both `http://` and `https://` versions if needed
- No trailing slashes on origins

### 502/503 Errors on Render
- Check Render logs for errors
- Verify `MONGO_URI` is correct
- Ensure MongoDB Atlas IP whitelist includes `0.0.0.0/0`

### "Spinning" Loader on First Request
- Render free tier takes 30-60 seconds to wake up after inactivity
- This is normal for free tier

### Login Works But Data Doesn't Load
- Check browser Network tab for failed requests
- Verify all API endpoints return 200
- Check MongoDB Atlas connection

---

## 6. Security Reminders

⚠️ **Before going live**:

1. Change `JWT_SECRET` to a strong random string (32+ characters)
2. Never commit real credentials to Git
3. Use MongoDB Atlas's built-in authentication
4. Consider upgrading to paid tiers for production-critical applications

---

## Quick Commands Reference

```bash
# Build frontend for production
npm run build

# Test production build locally
npm run preview

# Start backend in production mode
cd server && NODE_ENV=production npm start
```
