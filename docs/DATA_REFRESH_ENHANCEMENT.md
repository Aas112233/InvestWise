# Data Refresh Enhancement - Implementation Guide

**Date:** April 7, 2026  
**Feature:** Automatic Data Refresh on Screen Navigation  
**Status:** IMPLEMENTED

---

## Overview

The InvestWise application now automatically fetches the latest data from the server whenever users navigate between screens or perform operations. This ensures users always see real-time, accurate information without manual refresh.

---

## What Was Implemented

### 1. **Global Data Refresh Wrapper** 
**File:** `components/DataRefreshWrapper.tsx`

A wrapper component that monitors route changes and triggers automatic data refresh:

```typescript
// Automatically refreshes when route changes
useEffect(() => {
    if (connectionStatus === 'online') {
        const timer = setTimeout(() => {
            refreshAllData(); // Fetches all data from server
        }, 100);
        return () => clearTimeout(timer);
    }
}, [location.pathname, connectionStatus]);
```

**Integration:** Wrapped around main content in `App.tsx`

---

### 2. **Screen-Specific Refresh Hook**
**File:** `hooks/useScreenDataRefresh.ts`

A reusable hook for components that need custom refresh logic:

```typescript
// Usage in any screen component
useScreenDataRefresh(refreshFunction, {
    immediate: true,      // Refresh on mount
    debounceMs: 300,      // Debounce rapid navigation
    skipPaths: ['/login'] // Skip certain routes
});
```

**Features:**
- Automatic refresh on screen open
- Debounced to prevent excessive API calls
- Configurable per-screen behavior
- Error handling (silent failures)

---

### 3. **Enhanced Global State Context**
**File:** `context/GlobalStateContext.tsx`

Added `refreshAllData()` function that fetches all core data in parallel:

```typescript
const refreshAllData = async () => {
    if (!user || connectionStatus !== 'online') return;
    
    try {
        // Parallel fetching for performance
        await Promise.all([
            fetchMembers(),
            fetchProjects(),
            fetchFunds(),
            fetchTransactions(),
            fetchAnalytics(),
            fetchSettings()
        ]);
        
        // Role-specific data
        if (user.role === 'Admin' || user.role === 'Manager') {
            await fetchSystemUsers();
        }
        if (user.role === 'Admin') {
            await fetchNotifications();
        }
    } catch (error) {
        console.error('Refresh all data failed:', error);
    }
};
```

**Performance:** All API calls run in parallel (not sequential) for faster loading

---

## How It Works

### User Journey Example:

1. **User clicks "Deposits" in sidebar**
   - Route changes to `/deposits`
   - DataRefreshWrapper detects route change
   - Calls `refreshAllData()` after 100ms delay
   - All data fetched from server in parallel
   - UI updates with fresh data

2. **User performs operation (e.g., adds deposit)**
   - Operation completes
   - Component calls specific refresh (e.g., `refreshTransactions()`)
   - Related data also refreshed (funds, members, analytics)
   - User sees updated balances immediately

3. **User navigates to Dashboard**
   - Route changes to `/dashboard`
   - DataRefreshWrapper triggers refresh
   - Dashboard's useScreenDataRefresh calls `refreshAnalytics()`
   - Charts and stats show latest numbers

---

## Benefits

### For Users:
- **Always Current Data:** No stale information
- **No Manual Refresh:** Automatic updates on navigation
- **Smooth Experience:** Background refresh doesn't block UI
- **Confidence:** Know data is always from server

### For Developers:
- **Centralized Logic:** One place controls refresh behavior
- **Easy to Extend:** Add new screens with simple hook
- **Performance Optimized:** Parallel fetching, debouncing
- **Error Resilient:** Silent failures don't break UX

---

## Configuration Options

### Global Refresh (DataRefreshWrapper):
```typescript
// In App.tsx - already configured
<DataRefreshWrapper>
    {children}
</DataRefreshWrapper>
```

**Default Behavior:**
- Refreshes on every route change
- 100ms delay for smooth animation
- Only when online
- Silent error handling

### Screen-Specific Refresh:
```typescript
// In any component
useScreenDataRefresh(refreshFn, {
    immediate: true,     // Refresh on component mount
    debounceMs: 300,     // Wait 300ms before refresh
    skipPaths: []        // Don't refresh on these paths
});
```

---

## Performance Optimizations

### 1. **Parallel Data Fetching**
Instead of:
```typescript
await fetchMembers();
await fetchProjects();
await fetchFunds();
// Total time: 300ms + 250ms + 200ms = 750ms
```

Now:
```typescript
await Promise.all([
    fetchMembers(),
    fetchProjects(),
    fetchFunds()
]);
// Total time: max(300ms, 250ms, 200ms) = 300ms
```

**Result:** 2-3x faster data loading

### 2. **Debounced Navigation**
Prevents multiple API calls during rapid navigation:
```typescript
setTimeout(() => {
    refreshAllData();
}, 100); // Wait 100ms
```

### 3. **Connection Status Check**
Only refreshes when online:
```typescript
if (connectionStatus === 'online') {
    refreshAllData();
}
```

### 4. **Silent Error Handling**
Background refresh failures don't show errors:
```typescript
refreshAllData().catch(err => {
    console.error('Auto-refresh failed:', err);
    // No user-facing error
});
```

---

## Screens Enhanced

### Already Working:
- **Dashboard** - Analytics auto-refresh
- **All screens** - Global data refresh via wrapper

### To Add Screen-Specific Refresh:

**Example - Members Screen:**
```typescript
import { useScreenDataRefresh } from '../hooks/useScreenDataRefresh';

const Members = () => {
    const { refreshMembers } = useGlobalState();
    
    // Auto-refresh members when screen opens
    useScreenDataRefresh(refreshMembers);
    
    // ... rest of component
};
```

**Example - Deposits Screen:**
```typescript
const Deposits = () => {
    const { refreshTransactions, refreshFunds } = useGlobalState();
    
    const refreshDepositsData = async () => {
        await Promise.all([
            refreshTransactions(),
            refreshFunds()
        ]);
    };
    
    useScreenDataRefresh(refreshDepositsData);
    
    // ... rest of component
};
```

---

## Testing the Enhancement

### Manual Test Steps:

1. **Test Route Change Refresh:**
   ```
   - Open app and go to Dashboard
   - Note current member count
   - Navigate to Members screen
   - Add a new member
   - Navigate back to Dashboard
   - Verify member count updated automatically
   ```

2. **Test Operation Refresh:**
   ```
   - Go to Deposits screen
   - Create a new deposit
   - Check fund balance updated
   - Check member contribution updated
   - Check transactions list shows new deposit
   ```

3. **Test Offline Mode:**
   ```
   - Disconnect internet
   - Navigate between screens
   - Verify no errors shown
   - Reconnect internet
   - Verify data refreshes automatically
   ```

4. **Test Rapid Navigation:**
   ```
   - Quickly click through multiple screens
   - Verify only one API call per screen
   - Verify no duplicate requests
   ```

---

## Monitoring & Debugging

### Check Refresh Activity:
```javascript
// Browser console - watch for refresh logs
console.log('Data refresh triggered');
console.log('Auto-refresh failed:', err);
```

### Network Tab:
- Open DevTools > Network tab
- Navigate between screens
- Observe API calls firing on each route change
- Verify parallel requests (multiple simultaneous calls)

### Performance Metrics:
```javascript
// Measure refresh time
const start = performance.now();
await refreshAllData();
const duration = performance.now() - start;
console.log(`Refresh took ${duration}ms`);
```

---

## Troubleshooting

### Issue: Data not refreshing
**Check:**
1. Connection status is 'online'
2. User is logged in
3. API endpoints are accessible
4. No JavaScript errors in console

**Fix:**
```typescript
// Add logging
console.log('Refresh triggered, status:', connectionStatus);
```

### Issue: Too many API calls
**Solution:**
Increase debounce time:
```typescript
useScreenDataRefresh(refreshFn, {
    debounceMs: 500  // Increase from 300ms
});
```

### Issue: Slow navigation
**Solution:**
Reduce refresh scope per screen:
```typescript
// Instead of refreshAllData(), use specific refresh
useScreenDataRefresh(refreshMembers); // Only members
```

---

## Future Enhancements

### 1. **Smart Caching**
Cache data with TTL (time-to-live):
```typescript
const cache = new Map();
const CACHE_TTL = 30000; // 30 seconds

async function cachedFetch(key, fetchFn) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    const data = await fetchFn();
    cache.set(key, { data, timestamp: Date.now() });
    return data;
}
```

### 2. **Incremental Updates**
Only fetch changed data using timestamps:
```typescript
const lastSync = localStorage.getItem('lastSync');
const response = await api.get('/members', {
    params: { since: lastSync }
});
```

### 3. **WebSocket Real-time Updates**
Push updates from server:
```typescript
const ws = new WebSocket('ws://server/updates');
ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    updateLocalState(update);
};
```

### 4. **Optimistic UI Updates**
Update UI immediately, rollback on error:
```typescript
const addMember = async (member) => {
    // Optimistic update
    setMembers(prev => [member, ...prev]);
    
    try {
        await api.post('/members', member);
    } catch (error) {
        // Rollback
        setMembers(prev => prev.filter(m => m.id !== member.id));
        showError('Failed to add member');
    }
};
```

---

## Best Practices

### Do:
- Use parallel fetching (`Promise.all`)
- Implement debouncing for rapid navigation
- Handle errors silently for background refresh
- Check connection status before refreshing
- Use specific refresh functions per screen

### Don't:
- Block UI during refresh (use background updates)
- Show errors for background refresh failures
- Refresh on every keystroke (debounce!)
- Fetch unnecessary data
- Forget to cleanup timeouts on unmount

---

## Summary

The data refresh enhancement provides:

- **Automatic Updates:** Fresh data on every screen open
- **Smooth UX:** Non-blocking background refresh
- **Performance:** Parallel fetching, debouncing
- **Reliability:** Silent error handling, offline support
- **Extensibility:** Easy to add to new screens

**Result:** Users always see the latest data without manual intervention, creating a seamless, professional experience.

---

**Implementation Date:** April 7, 2026  
**Version:** 1.0  
**Next Review:** After 2 weeks in production  
