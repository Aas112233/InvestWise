# Quick Start: Add Auto-Refresh to Any Screen

This guide shows how to add automatic data refresh to any screen component.

---

## Step 1: Import the Hook

```typescript
import { useScreenDataRefresh } from '../hooks/useScreenDataRefresh';
import { useGlobalState } from '../context/GlobalStateContext';
```

---

## Step 2: Get Refresh Function

```typescript
const MyScreen = () => {
    const { 
        refreshMembers,
        refreshProjects,
        refreshFunds,
        refreshTransactions,
        refreshAnalytics
    } = useGlobalState();
    
    // ... rest of component
};
```

---

## Step 3: Add Hook with Options

### Option A: Simple (Single Data Type)
```typescript
// Auto-refresh members when screen opens
useScreenDataRefresh(refreshMembers);
```

### Option B: Multiple Data Types
```typescript
const refreshMyScreenData = async () => {
    await Promise.all([
        refreshMembers(),
        refreshProjects()
    ]);
};

useScreenDataRefresh(refreshMyScreenData);
```

### Option C: Custom Configuration
```typescript
useScreenDataRefresh(refreshMembers, {
    immediate: true,      // Refresh on mount (default: true)
    debounceMs: 500,      // Wait 500ms (default: 300ms)
    skipPaths: ['/login'] // Don't refresh on these routes
});
```

---

## Examples by Screen

### Members Screen
```typescript
const Members = () => {
    const { refreshMembers } = useGlobalState();
    
    // Refresh members data on screen open
    useScreenDataRefresh(refreshMembers);
    
    return (
        // ... component JSX
    );
};
```

### Deposits Screen
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
    
    return (
        // ... component JSX
    );
};
```

### Projects Screen
```typescript
const ProjectManagement = () => {
    const { refreshProjects, refreshFunds } = useGlobalState();
    
    const refreshProjectData = async () => {
        await Promise.all([
            refreshProjects(),
            refreshFunds()
        ]);
    };
    
    useScreenDataRefresh(refreshProjectData);
    
    return (
        // ... component JSX
    );
};
```

### Dashboard Screen
```typescript
const Dashboard = () => {
    const { refreshAnalytics } = useGlobalState();
    
    // Already added - refreshes analytics/stats
    useScreenDataRefresh(refreshAnalytics);
    
    return (
        // ... component JSX
    );
};
```

### Funds Management Screen
```typescript
const FundsManagement = () => {
    const { refreshFunds, refreshTransactions } = useGlobalState();
    
    const refreshFundsData = async () => {
        await Promise.all([
            refreshFunds(),
            refreshTransactions()
        ]);
    };
    
    useScreenDataRefresh(refreshFundsData);
    
    return (
        // ... component JSX
    );
};
```

---

## Advanced Usage

### Conditional Refresh
```typescript
const { user } = useGlobalState();

// Only refresh if admin
const refreshAdminData = async () => {
    if (user?.role === 'Admin') {
        await refreshAllData();
    }
};

useScreenDataRefresh(refreshAdminData);
```

### With Loading State
```typescript
const [isLoading, setIsLoading] = useState(false);

const refreshWithData = async () => {
    setIsLoading(true);
    try {
        await refreshMembers();
    } finally {
        setIsLoading(false);
    }
};

useScreenDataRefresh(refreshWithData);

// Show loading indicator
if (isLoading) {
    return <Spinner />;
}
```

### Skip Certain Routes
```typescript
useScreenDataRefresh(refreshMembers, {
    skipPaths: ['/members/edit', '/members/new']
});
```

---

## Testing Your Implementation

### 1. Check Console Logs
```javascript
// Should see no errors when navigating to screen
console.log('Auto-refresh failed:', err); // If error occurs
```

### 2. Monitor Network Tab
- Open DevTools > Network
- Navigate to your screen
- Verify API call fires once
- Check response has latest data

### 3. Test Rapid Navigation
- Quickly navigate away and back
- Verify only one API call per navigation
- No duplicate requests

### 4. Test Offline Mode
- Disconnect internet
- Navigate to screen
- Verify no errors shown
- Reconnect and verify data loads

---

## Common Patterns

### Pattern 1: List + Detail Screen
```typescript
// List screen - refresh list
useScreenDataRefresh(refreshMembers);

// Detail screen - refresh single item
const refreshMemberDetail = async () => {
    await fetchMemberById(memberId);
};
useScreenDataRefresh(refreshMemberDetail);
```

### Pattern 2: Form + List
```typescript
// After form submission, refresh list
const handleSubmit = async (data) => {
    await api.post('/members', data);
    await refreshMembers(); // Refresh list
};
```

### Pattern 3: Master-Detail
```typescript
// Master screen
useScreenDataRefresh(refreshProjects);

// When clicking project, pass refresh function
<Link to={`/projects/${id}`} state={{ refreshParent: refreshProjects }}>
```

---

## Troubleshooting

### Problem: Hook not refreshing
**Solution:**
```typescript
// Make sure you're passing a function, not calling it
useScreenDataRefresh(refreshMembers); // Correct
useScreenDataRefresh(refreshMembers()); // Wrong!
```

### Problem: Too many API calls
**Solution:**
```typescript
// Increase debounce time
useScreenDataRefresh(refreshFn, {
    debounceMs: 1000 // Wait 1 second
});
```

### Problem: Stale data
**Solution:**
```typescript
// Force immediate refresh
useScreenDataRefresh(refreshFn, {
    immediate: true
});
```

---

## Checklist

Before deploying:
- [ ] Hook imported correctly
- [ ] Refresh function obtained from context
- [ ] Hook called with correct parameters
- [ ] Tested on screen mount
- [ ] Tested on route change
- [ ] Tested offline mode
- [ ] No console errors
- [ ] Performance acceptable

---

## Need Help?

See full documentation: `DATA_REFRESH_ENHANCEMENT.md`

Key files:
- `hooks/useScreenDataRefresh.ts` - The hook
- `components/DataRefreshWrapper.tsx` - Global wrapper
- `context/GlobalStateContext.tsx` - Refresh functions
