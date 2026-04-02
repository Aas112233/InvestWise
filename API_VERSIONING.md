# 🔧 API Versioning Implementation

## Overview
Implemented comprehensive API versioning to ensure backward compatibility and allow for future breaking changes without affecting existing clients.

---

## ✅ Versioning Strategies Supported

### 1. **URL Path Versioning** (Recommended)
```
GET /api/v1/members
GET /api/v1/projects
POST /api/v1/auth/login
```

### 2. **Custom Header Versioning**
```
GET /api/members
X-API-Version: v1
```

### 3. **Query Parameter Versioning**
```
GET /api/members?version=v1
GET /api/projects?version=v1
```

### 4. **Default Version**
If no version specified, defaults to `v1`:
```
GET /api/members  →  Uses v1
```

---

## 🎯 How It Works

### Version Detection Priority
```
1. URL Path (/api/v1/...)     - Highest priority
2. Custom Header (X-API-Version)
3. Query Parameter (?version=)
4. Default Version (v1)        - Lowest priority
```

### Request Flow
```
Client Request: GET /api/v1/members
                    ↓
Version Middleware: Extracts "v1"
                    ↓
Validation: Check if v1 is supported
                    ↓
Route Handler: Process request
                    ↓
Response: Add version headers
```

---

## 📊 Response Headers

Every API response includes version information:

```http
HTTP/1.1 200 OK
X-API-Version: v1
X-Supported-Versions: v1
Content-Type: application/json

{
  "version": "v1",
  "timestamp": "2026-03-17T10:00:00Z",
  "data": { ... }
}
```

### Headers Explained

| Header | Value | Description |
|--------|-------|-------------|
| `X-API-Version` | `v1` | Current API version used |
| `X-Supported-Versions` | `v1, v2` | All supported versions |
| `Deprecation` | `true` | If version is deprecated |
| `Sunset` | `2026-06-01` | Date when version will be removed |
| `Warning` | `299 - "..."` | Deprecation warning message |

---

## 🆕 Available Versions

### Current Versions

| Version | Status | Released | Sunset |
|---------|--------|----------|--------|
| `v1` | ✅ Current | 2026-03-17 | - |

### Future Versions

| Version | Status | Planned | Notes |
|---------|--------|---------|-------|
| `v2` | 📋 Planned | TBA | Breaking changes |

---

## 🔧 Configuration

### Add New Version

**1. Update supported versions:**
```javascript
// server/middleware/apiVersioning.js
const SUPPORTED_VERSIONS = ['v1', 'v2']; // Add v2
```

**2. Add route handlers:**
```javascript
// server/routes/memberRoutes.js
const versionedRoute = require('../middleware/apiVersioning').versionedRoute;

router.get('/', versionedRoute({
  v1: getMembersV1,
  v2: getMembersV2,
  default: getMembersV1
}));
```

### Deprecate a Version

**1. Mark version as deprecated:**
```javascript
// server/middleware/apiVersioning.js
const DEPRECATED_VERSIONS = ['v1']; // Mark v1 as deprecated

const getDeprecationWarning = (version) => {
  return {
    v1: {
      deprecated: true,
      sunset: '2026-12-31',
      message: 'API v1 is deprecated. Please migrate to v2.',
    },
  };
};
```

**2. Clients will receive warnings:**
```http
Deprecation: true
Sunset: 2026-12-31
Warning: 299 - "API v1 is deprecated. Please migrate to v2."
```

---

## 📝 Usage Examples

### JavaScript/TypeScript (Frontend)

```javascript
// Method 1: URL Path (Recommended)
const response = await fetch('http://localhost:5000/api/v1/members');

// Method 2: Custom Header
const response = await fetch('http://localhost:5000/api/members', {
  headers: {
    'X-API-Version': 'v1'
  }
});

// Method 3: Query Parameter
const response = await fetch('http://localhost:5000/api/members?version=v1');

// Check version in response
console.log(response.headers.get('X-API-Version')); // "v1"
console.log(response.headers.get('X-Supported-Versions')); // "v1"
```

### cURL

```bash
# URL Path
curl -X GET http://localhost:5000/api/v1/members

# Custom Header
curl -X GET http://localhost:5000/api/members \
  -H "X-API-Version: v1"

# Query Parameter
curl -X GET "http://localhost:5000/api/members?version=v1"

# Check response headers
curl -I http://localhost:5000/api/v1/members
```

### Python (Requests)

```python
import requests

# URL Path
response = requests.get('http://localhost:5000/api/v1/members')

# Custom Header
response = requests.get('http://localhost:5000/api/members', 
                       headers={'X-API-Version': 'v1'})

# Check version
print(response.headers.get('X-API-Version'))  # "v1"
```

### Postman

1. **URL Path**: Use `http://localhost:5000/api/v1/members`
2. **Header**: Add `X-API-Version: v1` in Headers tab
3. **Query Param**: Add `version=v1` in Params tab

---

## 🚨 Error Responses

### Unsupported Version

**Request:**
```
GET /api/v99/members
```

**Response:**
```json
{
  "success": false,
  "error": "UNSUPPORTED_VERSION",
  "message": "API version 'v99' is not supported.",
  "supportedVersions": ["v1"]
}
```

**HTTP Status:** `400 Bad Request`

---

## 🔄 Migration Strategy

### When to Create v2

Create a new version when you need to:
- ✅ Change response structure
- ✅ Remove or rename fields
- ✅ Change authentication method
- ✅ Modify validation rules
- ✅ Break backward compatibility

### Maintaining Multiple Versions

```javascript
// v1 Controller
export const getMembersV1 = async (req, res) => {
  const members = await Member.find();
  res.json({
    version: 'v1',
    data: members
  });
};

// v2 Controller (example future changes)
export const getMembersV2 = async (req, res) => {
  const members = await Member.find();
  res.json({
    version: 'v2',
    data: {
      items: members,  // Changed structure
      meta: {          // Added metadata
        total: members.length,
        page: 1
      }
    }
  });
};
```

### Version-Specific Routes

```javascript
import { versionedRoute } from '../middleware/apiVersioning.js';

router.get('/', versionedRoute({
  v1: getMembersV1,
  v2: getMembersV2,
  default: getMembersV1  // Fallback
}));
```

---

## 📈 Benefits

### For API Consumers

✅ **No Breaking Changes**
- Existing clients continue working
- Migrate to new version at your own pace

✅ **Clear Migration Path**
- Deprecation warnings
- Sunset dates for planning

✅ **Version Transparency**
- Always know which version you're using
- Easy to test new versions

### For API Providers

✅ **Safe Evolution**
- Add breaking changes in new version
- Maintain old version temporarily

✅ **Better Documentation**
- Clear version history
- Migration guides per version

✅ **Analytics**
- Track version adoption
- Plan deprecation timeline

---

## 🧪 Testing

### Test All Versions

```bash
# Test v1
curl http://localhost:5000/api/v1/members

# Test default (should be v1)
curl http://localhost:5000/api/members

# Test unsupported version
curl http://localhost:5000/api/v99/members
# Expected: 400 Bad Request
```

### Check Headers

```bash
curl -I http://localhost:5000/api/v1/members

# Expected headers:
# X-API-Version: v1
# X-Supported-Versions: v1
```

### Test Deprecation

```javascript
// Mark v1 as deprecated in config
DEPRECATED_VERSIONS = ['v1'];

// Make request
const response = await fetch('http://localhost:5000/api/v1/members');

// Check deprecation headers
console.log(response.headers.get('Deprecation')); // "true"
console.log(response.headers.get('Sunset')); // "2026-12-31"
console.log(response.headers.get('Warning')); // '299 - "API v1 is deprecated..."'
```

---

## 🎯 Best Practices

### For API Consumers

1. **Always specify version explicitly**
   ```javascript
   // ✅ Good
   fetch('/api/v1/members')
   
   // ❌ Bad (relies on default)
   fetch('/api/members')
   ```

2. **Monitor deprecation headers**
   ```javascript
   const response = await fetch('/api/v1/members');
   if (response.headers.get('Deprecation') === 'true') {
     console.warn('API version is deprecated!');
   }
   ```

3. **Plan migration before sunset date**
   - Subscribe to API changelog
   - Test new version in staging
   - Migrate before sunset

### For API Providers

1. **Maintain at least 2 versions**
   - Current (v2)
   - Previous (v1)

2. **Provide migration guides**
   - Document breaking changes
   - Provide code examples
   - Offer migration support

3. **Give sufficient deprecation notice**
   - Minimum 3 months
   - Clear communication
   - Gradual rollout

4. **Monitor version usage**
   ```javascript
   // Log version usage
   app.use((req, res, next) => {
     console.log(`API Version: ${req.apiVersion}`);
     next();
   });
   ```

---

## 📚 API Reference

### Root Endpoint

```
GET /
```

**Response:**
```json
{
  "name": "InvestWise API",
  "version": "v1",
  "supportedVersions": ["v1"],
  "status": "running",
  "documentation": "/api/docs",
  "health": "/api/health"
}
```

### Health Check

```
GET /api/health
GET /api/v1/health
```

**Response:**
```json
{
  "status": "OK",
  "database": {
    "state": "connected",
    "status": "healthy"
  },
  "version": "v1"
}
```

---

## 🔍 Troubleshooting

### Issue: Getting "UNSUPPORTED_VERSION" error

**Solution:** Check supported versions
```bash
curl http://localhost:5000/
# Check "supportedVersions" in response
```

### Issue: Version headers not showing

**Solution:** Check CORS exposed headers
```javascript
// In server/index.js
exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-API-Version', 'X-Supported-Versions']
```

### Issue: Default version not working

**Solution:** Verify API_VERSION constant
```javascript
// server/middleware/apiVersioning.js
const API_VERSION = 'v1'; // Should be 'v1'
```

---

## 📖 References

- [API Versioning Best Practices](https://apisyouwonthate.com/blog/api-versioning)
- [RFC 7231 - HTTP/1.1 Semantics](https://tools.ietf.org/html/rfc7231)
- [Deprecation Header RFC](https://tools.ietf.org/html/rfc8631)
- [Sunset Header RFC](https://tools.ietf.org/html/rfc8594)

---

**Status**: ✅ **IMPLEMENTED**  
**Current Version**: 🔵 **v1**  
**Supported Versions**: v1  
**Versioning Strategy**: URL Path + Header + Query Param  
**Backward Compatible**: ✅ **YES**
