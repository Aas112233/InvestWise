# Quick Start - Security Features Guide

## For Developers & Operations

---

## Key Features Implemented

### 1. **Correlation IDs** - Track Every Request
Every request gets a unique ID for tracing:

```bash
# Check response headers
curl -v http://localhost:5000/api/health | grep X-Correlation-ID

# Response includes:
{
 "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
 ...
}
```

**Use it:** Include correlation ID when reporting bugs!

---

### 2. **Rate Limiting** - Prevents Abuse

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Authentication | 20 requests | 15 minutes |
| General API | 500 requests | 15 minutes |
| **Financial Operations** | **50 requests** | **15 minutes** |

**Financial ops include:** deposits, expenses, transfers, dividends, etc.

---

### 3. **Input Validation** - Catches Errors Early

All financial transactions validated for:
- Amount: 0.01 to 10,000,000
- MongoDB IDs: Valid format
- Dates: No future dates
- Text: XSS protection, length limits
- Required fields: Enforced

**Example Error:**
```json
{
 "errors": [
 {
 "msg": "Amount must be between 0.01 and 10,000,000",
 "param": "amount",
 "location": "body"
 }
 ]
}
```

---

### 4. **Audit Trail** - Everything Logged

All financial operations logged with:
- Who did it (user ID)
- What they did (action)
- When (timestamp)
- Details (amounts, balances, correlation ID)

**Query audit logs:**
```javascript
db.auditlogs.find({
 action: 'CREATE_DEPOSIT',
 'details.correlationId': 'a1b2c3d4-...'
})
```

---

## Debugging Guide

### Problem: User reports failed transaction

**Step 1:** Get correlation ID from user
```
User: "My deposit failed, reference ID: abc-123-def"
```

**Step 2:** Search logs
```bash
grep "abc-123-def" /var/log/investwise/*.log
```

**Step 3:** Find root cause
```
[abc-123-def] POST /api/finance/deposits
[abc-123-def] Auth: User authenticated
[abc-123-def] Validation: Fund not found
```

**Step 4:** Resolve
```
Support: "Please select a valid fund and try again. 
Your request ID was abc-123-def for reference."
```

---

## Monitoring Commands

### Check Rate Limiter Status
```bash
# View rate limit headers in response
curl -I http://localhost:5000/api/finance/deposits \
 -H "Authorization: Bearer TOKEN"

# Look for:
# X-RateLimit-Limit: 50
# X-RateLimit-Remaining: 45
# X-RateLimit-Reset: 1712500000
```

### Monitor Audit Logs
```bash
# Count today's financial operations
mongo investwise --eval '
db.auditlogs.count({
 createdAt: { $gte: new Date("2026-04-07") },
 action: { $in: ["CREATE_DEPOSIT", "CREATE_EXPENSE", "CREATE_EARNING"] }
})
'
```

### Check for Errors
```bash
# Recent errors with correlation IDs
tail -100 logs/server_errors.log | grep "\[.*\]"

# Format: [timestamp] [correlation-id] method path - error
```

---

## Performance Tips

### 1. Stats Recalculation is Async
Don't worry if dashboard stats take a moment to update - they recalculate in the background.

### 2. Use Correlation IDs in Tests
```javascript
const response = await fetch('/api/finance/deposits', {...});
const corrId = response.headers.get('X-Correlation-ID');
console.log(`Test request ID: ${corrId}`);
```

### 3. Batch Operations
For multiple deposits, use bulk endpoint:
```bash
POST /api/finance/deposits/bulk
{
 "fundId": "...",
 "deposits": [...]
}
```
Counts as 1 request vs N requests.

---

## Security Best Practices

### For API Users:
1. **Always include Authorization header**
2. **Handle rate limit errors gracefully**
3. **Save correlation IDs from responses**
4. **Report issues with correlation ID**

### For Developers:
1. **Use `logAudit()` for all financial operations**
2. **Include `req` parameter to capture correlation ID**
3. **Validate input before processing**
4. **Use atomic operations for balance updates**

### For Operations:
1. **Monitor rate limiter triggers**
2. **Review audit logs weekly**
3. **Rotate JWT_SECRET quarterly**
4. **Test backups monthly**

---

## Common Issues & Solutions

### Issue: "Too many financial operations"
**Cause:** Hit rate limit (50 req/15min) 
**Solution:** Wait 15 minutes or contact support for limit increase

### Issue: "Validation failed"
**Cause:** Invalid input data 
**Solution:** Check error details, fix validation errors

### Issue: "Fund not found"
**Cause:** Invalid fundId 
**Solution:** Verify fund exists, check ID format

### Issue: Transaction succeeded but stats wrong
**Cause:** Stats recalculation delayed 
**Solution:** Wait 1-2 seconds, refresh dashboard

---

## Getting Help

### Include This Info:
1. **Correlation ID** (from error response or headers)
2. **Endpoint** you called
3. **Request body** (without sensitive data)
4. **Error message** received
5. **Timestamp** of issue

### Example Support Ticket:
```
Subject: Deposit failed - Correlation ID: abc-123-def

Details:
- Endpoint: POST /api/finance/deposits
- Time: 2026-04-07 10:30 AM
- Error: "Fund not found"
- Correlation ID: abc-123-def-456-789

Request (sanitized):
{
 "amount": 100,
 "memberId": "VALID_ID",
 "fundId": "INVALID_ID"
}
```

---

## Quick Reference

### Environment Variables Required:
```bash
MONGO_URI=mongodb://...
JWT_SECRET=minimum-32-characters-long
PORT=5000
NODE_ENV=production
```

### Important Endpoints:
```
GET /api/health - System health check
POST /api/finance/deposits - Create deposit
POST /api/finance/expenses - Create expense
POST /api/finance/earnings - Create earning
POST /api/finance/transfer - Transfer funds
POST /api/finance/dividends - Distribute dividends
GET /api/audit/logs - View audit logs
```

### Rate Limits:
```
Auth endpoints: 20 requests / 15 min
Financial ops: 50 requests / 15 min
General API: 500 requests / 15 min
```

### Response Headers:
```
X-Correlation-ID: Unique request ID
X-RateLimit-Limit: Max requests allowed
X-RateLimit-Remaining: Requests remaining
X-RateLimit-Reset: When limit resets (Unix timestamp)
```

---

## Related Documentation

- [Phase 1 Security Fixes](SECURITY_FIXES_APPLIED.md) - Detailed implementation
- [Phase 2 Enhancements](PHASE_2_ENHANCEMENTS.md) - Correlation IDs & more
- [Complete Summary](IMPLEMENTATION_SUMMARY.md) - Executive overview

---

**Last Updated:** April 7, 2026 
**Version:** 2.0 
**Status:** Production Ready 
