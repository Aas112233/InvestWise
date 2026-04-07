# 🚀 Quick Start: InvestWise Backups

## 1️⃣ **SETUP (5 minutes)**

### Cloudflare R2:
```
1. Create bucket: investwise-backups
2. Create API token (Read & Write)
3. Copy credentials
```

### Vercel Environment Variables:
```bash
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=investwise-backups
BACKUP_RETENTION_DAYS=30
```

### Install:
```bash
cd server
npm install
```

### Deploy:
```bash
vercel --prod
```

---

## 2️⃣ **API ENDPOINTS**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backup/cron` | POST | Daily cron (auto) |
| `/api/backup/manual` | POST | Trigger backup |
| `/api/backup/list` | GET | View backups |
| `/api/backup/restore` | POST | Restore backup |

---

## 3️⃣ **COMMANDS**

```bash
# Local backup
npm run backup

# List backups
curl https://your-app.vercel.app/api/backup/list

# Restore
curl -X POST https://your-app.vercel.app/api/backup/restore \
  -H "Content-Type: application/json" \
  -d '{"backupKey":"daily/backup-2026-04-07.json.gz","confirm":true}'
```

---

## 4️⃣ **BACKUP SCHEDULE**

⏰ **Daily at 2:00 AM** (Vercel Cron)  
📦 **Retention:** 30 days  
☁️ **Storage:** Cloudflare R2  
🔔 **Notifications:** Discord/Slack webhook  

---

## 5️⃣ **WHAT'S BACKED UP**

✅ members  
✅ transactions  
✅ projects  
✅ funds  
✅ users  
✅ systemSettings  
✅ auditLogs  

---

**Full Guide:** `docs/BACKUP_SETUP_GUIDE.md`
