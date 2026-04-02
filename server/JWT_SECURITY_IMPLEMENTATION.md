# JWT Security & Session Timeout Implementation

## Overview
This document describes the comprehensive JWT security enhancements and automatic session timeout feature implemented for production readiness.

---

## 🔐 **JWT Security Enhancements**

### 1. Token Architecture

**Before:**
- Single long-lived token (30 days)
- No token rotation
- No revocation mechanism

**After:**
- **Access Token**: 15 minutes (short-lived)
- **Refresh Token**: 7 days (long-lived)
- Token rotation on refresh
- Token blacklisting for revocation

### 2. Token Structure

```javascript
// Access Token (15 min)
{
  id: "user_id",
  type: "access",
  exp: 1234567890  // 15 minutes from issuance
}

// Refresh Token (7 days)
{
  id: "user_id",
  type: "refresh",
  exp: 1234567890  // 7 days from issuance
}
```

### 3. Backend Changes

#### Files Modified:
- `server/utils/generateToken.js` - Token generation with separate access/refresh tokens
- `server/controllers/authController.js` - Updated login, added refresh/logout endpoints
- `server/routes/authRoutes.js` - New routes for refresh and logout
- `server/middleware/authMiddleware.js` - Blacklist checking and token type validation

#### New Files:
- `server/models/BlacklistedToken.js` - MongoDB model for revoked tokens

#### New API Endpoints:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/refresh` | POST | No | Refresh access token |
| `/api/auth/logout` | POST | Yes | Logout and blacklist token |
| `/api/auth/logout-all` | POST | Yes | Logout from all devices |

### 4. Frontend Changes

#### Files Modified:
- `services/api.ts` - Auto token refresh on 401, request queuing
- `components/Login.tsx` - Session expiry handling
- `App.tsx` - Session timeout dialog integration

#### Auto Token Refresh Flow:
```
1. Request fails with 401 (access token expired)
2. Frontend detects expired token
3. Uses refresh token to get new token pair
4. Retries original request with new access token
5. User never notices the interruption
```

### 5. Token Blacklisting

**When tokens are blacklisted:**
- User logout (refresh token added to blacklist)
- Password change (all user tokens blacklisted)
- Security concern (admin can blacklist all user tokens)
- Logout from all devices

**Auto-cleanup:**
- MongoDB TTL index automatically removes expired blacklisted tokens
- No manual cleanup required

---

## ⏱️ **Session Timeout Feature**

### 1. Inactivity Detection

**Configuration:**
- **Inactivity Period**: 2 minutes (120 seconds)
- **Warning Duration**: 60 seconds countdown
- **Total Time Before Logout**: 3 minutes

**Tracked User Activities:**
- Mouse movements
- Keyboard input
- Scroll events
- Touch events
- Click events

### 2. User Experience Flow

```
User is active → User stops activity
       ↓
[2 minutes pass]
       ↓
Show timeout warning dialog
       ↓
60-second countdown starts
       ↓
┌──────────────┴──────────────┐
│                             │
User clicks           Timer reaches
"Stay Logged In"          00:00
│                             │
↓                             ↓
Token refreshed         Auto logout
Dialog closed           Redirect to login
Session extended        with message
```

### 3. Warning Dialog Features

**Visual Elements:**
- 🔒 Security shield icon
- ⏱️ Live countdown timer (MM:SS format)
- 📊 Progress bar (green → yellow → red)
- Two action buttons:
  - "Logout Now" - Immediate logout
  - "Stay Logged In" - Extend session

**Design:**
- Modal with backdrop blur
- Gradient header (amber-orange)
- Responsive layout
- Dark mode support
- Smooth animations

### 4. Session Extension

When user clicks "Stay Logged In":
1. Frontend calls `/api/auth/refresh` with refresh token
2. Backend validates refresh token
3. Returns new token pair
4. Updates localStorage
5. Resets inactivity timer
6. Closes dialog

### 5. Auto Logout

When timer reaches zero:
1. Call logout API (blacklist tokens)
2. Clear localStorage
3. Redirect to `/login?session=timeout`
4. Show session expired message

---

## 📋 **Configuration Options**

### Backend (`server/utils/generateToken.js`)

```javascript
const ACCESS_TOKEN_EXPIRE = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRE = '7d';   // 7 days
```

### Frontend (`App.tsx`)

```javascript
const { showWarning, timeRemaining, extendSession, logout } = useInactivityTimeout({
  timeoutMs: 2 * 60 * 1000,      // 2 minutes before warning
  warningDurationMs: 60 * 1000,   // 60 seconds warning
  onLogout: handleLogout,
  enabled: !!user,
});
```

---

## 🔒 **Security Benefits**

### 1. Reduced Attack Surface
- Short-lived access tokens limit exposure window
- Even if stolen, token expires in 15 minutes
- Refresh tokens are only used once (rotation)

### 2. Token Revocation
- Blacklist prevents use of revoked tokens
- Immediate effect on logout/password change
- Auto-cleanup via MongoDB TTL

### 3. Session Management
- Automatic logout prevents unauthorized access
- User gets warning before logout
- Option to extend session seamlessly

### 4. Audit Trail
- All authentication events logged
- Login, logout, failed attempts tracked
- Token refresh events auditable

---

## 🧪 **Testing Checklist**

### Token Refresh
- [ ] Login and verify both tokens received
- [ ] Wait 15 minutes, make API request
- [ ] Verify auto-refresh happens seamlessly
- [ ] Check new tokens stored in localStorage
- [ ] Verify API request succeeds with new token

### Logout
- [ ] Click logout button
- [ ] Verify tokens cleared from localStorage
- [ ] Check refresh token blacklisted in DB
- [ ] Verify redirect to login page
- [ ] Try using old token - should fail

### Session Timeout
- [ ] Login successfully
- [ ] Stop interacting with app for 2 minutes
- [ ] Verify warning dialog appears
- [ ] Watch countdown timer
- [ ] Click "Stay Logged In" - verify session extends
- [ ] Let timer reach 00:00 - verify auto logout
- [ ] Check redirect URL has `?session=timeout`
- [ ] Verify login page shows timeout message

### Token Blacklisting
- [ ] Login on multiple devices/tabs
- [ ] Logout from one device
- [ ] Verify other device still works (access token valid)
- [ ] Wait for access token to expire
- [ ] Verify other device can't refresh (blacklisted)
- [ ] Test "Logout All Devices" functionality

---

## 🚨 **Edge Cases Handled**

### 1. Multiple Concurrent Refresh Requests
- **Problem**: Multiple 401s trigger multiple refresh requests
- **Solution**: Request queue with lock (`isRefreshing` flag)
- **Behavior**: Only one refresh, others wait and reuse result

### 2. Network Failure During Refresh
- **Problem**: Refresh request fails due to network
- **Solution**: Retry logic + fallback to logout
- **Behavior**: User logged out gracefully with message

### 3. Refresh Token Also Expired
- **Problem**: Both tokens expired (7+ days inactive)
- **Solution**: Detect and logout immediately
- **Behavior**: Redirect to login with "expired" message

### 4. Tab Left Open Overnight
- **Problem**: User leaves tab open, comes back next day
- **Solution**: Inactivity timer + token expiry
- **Behavior**: Dialog appears on interaction, or auto logout

---

## 📊 **Database Schema**

### BlacklistedToken Collection

```javascript
{
  _id: ObjectId,
  token: String,           // JWT token string
  type: "access"|"refresh", // Token type
  userId: ObjectId,        // User who owns token
  expiresAt: Date,         // When token naturally expires
  blacklistedAt: Date,     // When blacklisted
  reason: String,          // logout|password_change|security|user_request
  createdAt: Date,
  updatedAt: Date
}
```

**TTL Index:**
```javascript
// Auto-delete when expiresAt is reached
{ expiresAt: 1 }, { expireAfterSeconds: 0 }
```

---

## 🎯 **Production Recommendations**

### 1. Environment Variables
```bash
# JWT Configuration
JWT_SECRET=your_super_secret_key_here
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Session Timeout (optional override)
SESSION_TIMEOUT_MS=120000
SESSION_WARNING_MS=60000
```

### 2. Monitoring
- Track token refresh rate (high rate = short access token expiry)
- Monitor blacklist size (should be manageable)
- Alert on unusual logout patterns
- Track session timeout frequency

### 3. Performance
- Index on `token` field for fast blacklist lookup
- TTL index auto-cleans old records
- Consider Redis for blacklist if high scale

### 4. Customization
- Adjust timeout values based on security requirements
- Financial apps: Shorter timeout (1-2 min)
- Internal tools: Longer timeout (10-15 min)

---

## 📝 **API Response Examples**

### Login Success
```json
{
  "_id": "user123",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "Admin",
  "permissions": { "DASHBOARD": "WRITE" },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900
}
```

### Token Refresh
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900
}
```

### Logout Success
```json
{
  "message": "Logout successful"
}
```

### Blacklisted Token Error
```json
{
  "message": "Token has been revoked, please login again"
}
```

---

## 🔧 **Troubleshooting**

### Issue: Token refresh not working
**Check:**
1. Refresh token exists in localStorage
2. Backend `/api/auth/refresh` endpoint is accessible
3. JWT_SECRET matches between environments

### Issue: Session timeout not triggering
**Check:**
1. User is logged in (`enabled: !!user`)
2. Event listeners are attached (check console)
3. No errors in `useInactivityTimeout` hook

### Issue: Dialog shows but timer doesn't count down
**Check:**
1. `timeRemaining` state is updating
2. Component is not unmounting prematurely
3. Browser tab is not suspended (background tabs)

### Issue: Logout from all devices not working
**Check:**
1. `BlacklistedToken.updateMany` query is correct
2. User ID is being passed correctly
3. Check MongoDB logs for update operation

---

## ✅ **Summary**

This implementation provides enterprise-grade security with:
- ✅ Short-lived access tokens (15 min)
- ✅ Refresh token rotation
- ✅ Token revocation mechanism
- ✅ Automatic session refresh
- ✅ Inactivity-based auto logout
- ✅ User-friendly warning dialog
- ✅ Comprehensive audit logging
- ✅ Graceful error handling

**Result:** Production-ready authentication system that balances security with user experience.
