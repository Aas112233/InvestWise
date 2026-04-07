# 🔒 Security Best Practices

## 📋 **Table of Contents**
- [Credential Management](#credential-management)
- [Environment Variables](#environment-variables)
- [Git Security](#git-security)
- [Pre-Commit Hooks](#pre-commit-hooks)
- [Cloudflare R2 Security](#cloudflare-r2-security)
- [MongoDB Security](#mongodb-security)
- [Deployment Security](#deployment-security)

---

## 🔐 Credential Management

### ✅ **DO:**
- Use `.env` files for local development
- Store production credentials in Vercel/Heroku dashboard
- Rotate credentials regularly (every 90 days)
- Use different credentials for development/production
- Store sensitive credentials in a password manager (1Password, LastPass, Bitwarden)

### ❌ **NEVER:**
- Commit `.env` files to git
- Hardcode credentials in source code
- Share credentials via email/chat
- Use production credentials in development
- Commit documentation files with real credentials

---

## 🌍 Environment Variables

### **Local Development:**
```bash
# Create .env file in server/ directory
cp server/.env.example server/.env

# Edit with your credentials
nano server/.env
```

### **Production (Vercel):**
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add variables with proper scope (Production/Preview/Development)
3. **Never** download or export environment variables file

### **Required Variables:**
```bash
# MongoDB
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname

# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=your-bucket-name

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Optional: Notifications
NOTIFICATION_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

---

## 🛡️ Git Security

### **Protected Files (`.gitignore`):**
These files are **automatically ignored** by git:
- ✅ `.env` and all variants
- ✅ `server/.env`
- ✅ `docs/*_CONFIGURATION.md` (credential documentation)
- ✅ `*.pem`, `*.key`, `*.crt` (certificates)
- ✅ `secrets/`, `credentials/`, `private/` directories

### **Verify Before Committing:**
```bash
# Check what will be committed
git status

# Review changes
git diff --cached

# Ensure no .env files are staged
git ls-files | grep -i ".env"
```

---

## 🪝 Pre-Commit Hooks

A pre-commit hook is installed at `.git/hooks/pre-commit` that:

**Scans for:**
- Cloudflare R2 credentials
- MongoDB connection strings
- AWS access keys
- Generic API keys/secrets
- Password patterns

**Blocks commits** that contain potential credentials with a clear error message.

### **To Bypass (NOT RECOMMENDED):**
```bash
git commit --no-verify -m "your message"
```

⚠️ **Only bypass if you're absolutely certain no credentials are exposed!**

---

## ☁️ Cloudflare R2 Security

### **Best Practices:**
1. **Use minimal permissions** - Only grant Read/Write to specific bucket
2. **Rotate API tokens** every 90 days
3. **Never share** Account ID or Access Keys
4. **Monitor usage** in Cloudflare Dashboard
5. **Enable audit logs** if available

### **If Credentials Are Exposed:**
1. **Immediately revoke** the API token in Cloudflare Dashboard
2. **Create a new token** with same permissions
3. **Update** all environment variables with new credentials
4. **Review** git history to ensure credentials weren't committed
5. **Notify** team members to update their local `.env` files

### **Token Permissions:**
```
✅ Required:
- Object Read
- Object Write

❌ NOT Required:
- Bucket Read/Write
- Account settings
- Worker access
```

---

## 🗄️ MongoDB Security

### **Best Practices:**
1. **Use strong passwords** - Minimum 16 characters, mix of upper/lower/numbers/symbols
2. **Enable IP whitelist** - Restrict access to known IPs (or `0.0.0.0/0` for Vercel)
3. **Use database user** (not admin root user)
4. **Enable MFA** on MongoDB Atlas account
5. **Monitor access logs** regularly

### **Connection String Format:**
```
mongodb+srv://username:PASSWORD@cluster.mongodb.net/dbname?options
```

⚠️ **If password contains special characters (`@`, `#`, `$`, etc.), URL-encode them:**
```
@ → %40
# → %23
$ → %24
& → %26
```

---

## 🚀 Deployment Security

### **Vercel:**
- ✅ Use Environment Variables dashboard (encrypted at rest)
- ✅ Set proper variable scope (Production/Preview/Development)
- ✅ Enable Vercel's built-in security features
- ✅ Use custom domains with HTTPS (automatic)

### **Never:**
- ❌ Commit `.env` files
- ❌ Use `vercel env pull` in CI/CD
- ❌ Share environment variable exports
- ❌ Log sensitive values

### **Verify Deployment:**
```bash
# Check environment variables are set
vercel env ls

# Verify no secrets in build logs
vercel logs <deployment-url>
```

---

## 🔍 Security Checklist

Before deploying to production:

- [ ] All `.env` files are in `.gitignore`
- [ ] No credentials in source code
- [ ] Pre-commit hook is installed and working
- [ ] MongoDB user has minimal required permissions
- [ ] R2 API token is scoped to single bucket
- [ ] JWT_SECRET is at least 32 characters
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] Error messages don't leak sensitive data
- [ ] Dependencies are up to date (`npm audit`)

---

## 🆘 Emergency Procedures

### **If Credentials Are Compromised:**

1. **Cloudflare R2:**
   - Go to Cloudflare Dashboard → R2 → API Tokens
   - Revoke compromised token
   - Create new token
   - Update Vercel environment variables

2. **MongoDB:**
   - Go to MongoDB Atlas → Database Access
   - Change user password
   - Update `MONGO_URI` in Vercel

3. **JWT Secret:**
   - Generate new secret: `openssl rand -base64 64`
   - Update `JWT_SECRET` in Vercel
   - **All existing tokens will be invalidated** - users must re-login

4. **Audit:**
   - Check git history: `git log --all --full-history -p | grep -i "password\|secret\|key"`
   - Review Vercel deployment logs
   - Check R2 access logs for unauthorized access

---

## 📞 Security Contacts

- **Report vulnerabilities:** Create a private issue or contact maintainers directly
- **Security incidents:** Rotate affected credentials immediately
- **Questions:** Review this document or consult team lead

---

**Last Updated:** April 7, 2026  
**Version:** 1.0.0
