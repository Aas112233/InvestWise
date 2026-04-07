# 🚀 InvestWise Automated Backup System

Automated daily backups to **Cloudflare R2** with Vercel Cron Jobs.

---

## 📋 **FEATURES**

✅ **Automated Daily Backups** - Runs at 2:00 AM via Vercel Cron  
✅ **Cloudflare R2 Storage** - Zero egress fees, S3-compatible  
✅ **Compression** - ~90% size reduction with gzip  
✅ **Verification** - MD5 checksum validation  
✅ **Auto-Cleanup** - Keeps last 30 days, deletes older  
✅ **Manual Backups** - Trigger on-demand via API  
✅ **Restore** - Full database restore from any backup  
✅ **Notifications** - Slack/Discord webhook on failure  

---

## 🛠️ **SETUP GUIDE**

### **Step 1: Create Cloudflare R2 Bucket**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Storage**
3. Click **Create Bucket**
4. Name it: `investwise-backups`
5. Note your **Account ID** (found in R2 dashboard)

### **Step 2: Create R2 API Token**

1. In R2 Dashboard, click **Manage R2 API Tokens**
2. Click **Create API Token**
3. Permissions:
   - **Object Read & Write**
   - Scope: `investwise-backups` bucket only
4. Copy the credentials:
   - `Access Key ID`
   - `Secret Access Key`

### **Step 3: Configure Environment Variables**

#### **On Vercel:**

Go to **Project Settings > Environment Variables** and add:

```bash
# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=investwise-backups

# Backup Settings
BACKUP_RETENTION_DAYS=30

# Optional: Notifications
NOTIFICATION_WEBHOOK_URL=https://discord.com/api/webhooks/...
CRON_SECRET=your-random-secret-token
```

#### **Local Development:**

```bash
cd server
cp .env.example .env
# Fill in your R2 credentials
```

### **Step 4: Install Dependencies**

```bash
cd server
npm install
```

This installs `@aws-sdk/client-s3` for R2 compatibility.

### **Step 5: Deploy to Vercel**

```bash
# From project root
vercel --prod
```

Vercel will automatically:
- Deploy your API routes
- Set up the cron job (daily at 2 AM)
- Start creating backups

---

## 📁 **BACKUP STRUCTURE**

```
investwise-backups/
├── daily/
│   ├── backup-2026-04-07.json.gz
│   ├── backup-2026-04-06.json.gz
│   └── ...
├── monthly/
│   └── backup-2026-04-01.json.gz
└── latest/
    └── backup-latest.json.gz (pointer)
```

**Backed Up Collections:**
- ✅ `members` - Member details, shares, contributions
- ✅ `transactions` - All deposits, expenses, earnings
- ✅ `projects` - Project details, investments, ROI
- ✅ `funds` - Fund balances and types
- ✅ `users` - User accounts, permissions
- ✅ `systemSettings` - Share value, config
- ✅ `auditLogs` - Audit trail (optional)

---

## 🚀 **USAGE**

### **Manual Backup (Local)**

```bash
cd server
npm run backup
```

### **Manual Backup (Vercel API)**

```bash
curl -X POST https://your-app.vercel.app/api/backup/manual \
  -H "Content-Type: application/json" \
  -d '{"type": "daily"}'
```

### **List Backups**

```bash
curl https://your-app.vercel.app/api/backup/list
```

### **Restore from Backup**

⚠️ **WARNING: This overwrites existing data!**

```bash
curl -X POST https://your-app.vercel.app/api/backup/restore \
  -H "Content-Type: application/json" \
  -d '{
    "backupKey": "daily/backup-2026-04-07.json.gz",
    "confirm": true
  }'
```

---

## 🔔 **NOTIFICATIONS**

### **Discord Webhook:**

1. Create a Discord channel for backups
2. Right-click channel > **Edit Channel** > **Integrations**
3. Create Webhook and copy URL
4. Add to Vercel env: `NOTIFICATION_WEBHOOK_URL`

### **Slack Webhook:**

1. Go to **Slack Apps** > **Incoming Webhooks**
2. Create webhook for your channel
3. Add URL to Vercel env: `NOTIFICATION_WEBHOOK_URL`

---

## 🔒 **SECURITY**

- ✅ R2 credentials stored in Vercel env (encrypted)
- ✅ Cron job verification with `CRON_SECRET`
- ✅ Backup files are compressed (not human-readable)
- ✅ Soft deletes preserve audit trail
- ✅ No credentials in code or logs

---

## 📊 **MONITORING**

### **View Backup Logs:**

```bash
# Vercel Dashboard > Logs > Filter: /api/backup
```

### **Check Backup Status:**

```bash
curl https://your-app.vercel.app/api/backup/list
```

### **Backup File Size:**

Typical sizes (compressed):
- Small app (<1000 members): ~50-200 KB
- Medium app (5000 members): ~500 KB - 2 MB
- Large app (20000+ members): ~5-10 MB

---

## 🔄 **BACKUP SCHEDULE**

| Type | Schedule | Retention | Cleanup |
|------|----------|-----------|---------|
| **Daily** | 2:00 AM every day | 30 days | Auto-deletes >30 days |
| **Monthly** | Manual trigger | Forever | Manual |
| **Manual** | On-demand | Forever | Manual |

---

## 🆘 **TROUBLESHOOTING**

### **Error: "R2 client not initialized"**

**Fix:** Check environment variables are set correctly:
```bash
# Verify on Vercel
vercel env ls

# Verify locally
cat server/.env | grep R2_
```

### **Error: "MONGO_URI not found"**

**Fix:** Ensure `MONGO_URI` or `MONGODB_URI` is set in Vercel env vars.

### **Backup Verification Failed**

**Cause:** Network issue during upload  
**Fix:** Retry manually via `/api/backup/manual`

### **Restore Failed**

**Common causes:**
1. Backup file corrupted
2. MongoDB connection lost
3. Schema changes incompatible

**Solution:**
- Try a different backup date
- Check MongoDB is accessible
- Review model schemas

---

## 💡 **TIPS**

1. **Test restores monthly** - Ensure backups are restorable
2. **Monitor notifications** - Don't ignore failure alerts
3. **Keep monthly backups** - Manual trigger for important dates
4. **Review backup size** - Sudden changes indicate issues
5. **Rotate CRON_SECRET** - Change periodically for security

---

## 📞 **SUPPORT**

For issues or questions:
- Check Vercel logs: Dashboard > Logs
- Review R2 bucket: Cloudflare Dashboard > R2
- Test locally: `npm run backup:manual`

---

**Last Updated:** April 7, 2026  
**Version:** 1.0.0
