/**
 * API Smoke Test — runs through all critical flows.
 * Usage: npx tsx src/__tests__/api-smoke.test.ts
 */
export {};

const BASE = 'http://localhost:5004/api';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: unknown;
}

const results: TestResult[] = [];
let ACCESS_TOKEN = '';
let REFRESH_TOKEN = '';
let TEST_MEMBER_ID = '';
let TEST_FUND_ID = '';
let TEST_PROJECT_ID = '';
let TEST_TXN_ID = '';

function record(name: string, passed: boolean, error?: string, data?: unknown) {
  results.push({ name, passed, error, data });
  const icon = passed ? '[OK]' : '[ERROR]';
  console.log(`${icon} ${name}${error ? ` — ${error}` : ''}`);
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ACCESS_TOKEN) headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, data: json };
}

// ──────────────────────────────────────────────────
// 1. HEALTH CHECK
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/health');
  record('Health check', status === 200 && data.status === 'healthy', undefined, data);
} catch (e: any) {
  record('Health check', false, e.message);
}

// ──────────────────────────────────────────────────
// 2. AUTH — LOGIN
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('POST', '/auth/login', {
    email: 'admin@investwise.com',
    password: 'Admin@123456',
  });
  if (status === 200 && data.accessToken) {
    ACCESS_TOKEN = data.accessToken;
    REFRESH_TOKEN = data.refreshToken;
    record('Login', true, undefined, { user: data.user?.email, role: data.user?.role });
  } else {
    record('Login', false, `Status ${status}: ${JSON.stringify(data)}`);
  }
} catch (e: any) {
  record('Login', false, e.message);
}

if (!ACCESS_TOKEN) {
  console.log('\n[WARN]  Cannot continue without auth token. Trying to register...');
  // Can't register without admin token — dead end
  console.log('[ERROR] Cannot proceed with tests without valid login.');
  console.log('   Check that users exist in the database and JWT_REFRESH_SECRET is set.');
  process.exit(1);
}

// ──────────────────────────────────────────────────
// 3. GET PROFILE
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/auth/profile');
  record('Get Profile', status === 200, undefined, { name: data.name, email: data.email });
} catch (e: any) {
  record('Get Profile', false, e.message);
}

// ──────────────────────────────────────────────────
// 4. LIST MEMBERS (paginated)
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/members?page=1&limit=5');
  const ok = status === 200 && data.data && Array.isArray(data.data);
  if (ok && data.data.length > 0) TEST_MEMBER_ID = data.data[0].id || data.data[0]._id;
  record('List Members', ok, undefined, { count: data.data?.length, total: data.meta?.total });
} catch (e: any) {
  record('List Members', false, e.message);
}

// ──────────────────────────────────────────────────
// 5. CREATE MEMBER
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('POST', '/members', {
    name: 'Test Member ' + Date.now().toString().slice(-4),
    email: `test${Date.now()}@test.com`,
    phone: '01712345678',
    role: 'Associate Member',
    shares: 10,
    status: 'active',
  });
  const ok = status === 201 || status === 200;
  if (ok) TEST_MEMBER_ID = data.id || data._id || data.member?.id || TEST_MEMBER_ID;
  record('Create Member', ok, undefined, { id: TEST_MEMBER_ID });
} catch (e: any) {
  record('Create Member', false, e.message);
}

// ──────────────────────────────────────────────────
// 6. LIST FUNDS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/funds');
  const ok = status === 200 && data.data && Array.isArray(data.data);
  if (ok && data.data.length > 0) TEST_FUND_ID = data.data[0].id || data.data[0]._id;
  record('List Funds', ok, undefined, { count: data.data?.length });
} catch (e: any) {
  record('List Funds', false, e.message);
}

// ──────────────────────────────────────────────────
// 7. CREATE FUND (if none exist)
// ──────────────────────────────────────────────────
if (!TEST_FUND_ID) {
  try {
    const { status, data } = await api('POST', '/funds', {
      name: 'Test Primary Fund',
      type: 'DEPOSIT',
      status: 'ACTIVE',
      initialBalance: 100000,
    });
    const ok = status === 201 || status === 200;
    if (ok) TEST_FUND_ID = data.id || data._id || (data.fund?.id);
    record('Create Fund', ok, undefined, { id: TEST_FUND_ID });
  } catch (e: any) {
    record('Create Fund', false, e.message);
  }
} else {
  record('Create Fund (skip)', true, 'Fund already exists');
}

// ──────────────────────────────────────────────────
// 8. CREATE DEPOSIT
// ──────────────────────────────────────────────────
try {
  if (TEST_MEMBER_ID && TEST_FUND_ID) {
    const today = new Date();
    const { status, data } = await api('POST', '/finance/deposits', {
      memberId: TEST_MEMBER_ID,
      fundId: TEST_FUND_ID,
      amount: 5000,
      description: 'Smoke test deposit',
      depositMonth: `${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()}`,
      depositMethod: 'Cash',
    });
    const ok = status === 201 || status === 200;
    if (ok) TEST_TXN_ID = data.id || data._id;
    record('Create Deposit', ok, undefined, { amount: 5000, id: TEST_TXN_ID });
  } else {
    record('Create Deposit', false, 'No member or fund available');
  }
} catch (e: any) {
  record('Create Deposit', false, e.message);
}

// ──────────────────────────────────────────────────
// 9. CREATE EXPENSE
// ──────────────────────────────────────────────────
try {
  if (TEST_FUND_ID) {
    const { status, data } = await api('POST', '/finance/expenses', {
      fundId: TEST_FUND_ID,
      amount: 1000,
      description: 'Smoke test expense — office supplies',
      category: 'Operational',
    });
    record('Create Expense', status === 201 || status === 200, undefined, { amount: 1000 });
  } else {
    record('Create Expense', false, 'No fund available');
  }
} catch (e: any) {
  record('Create Expense', false, e.message);
}

// ──────────────────────────────────────────────────
// 10. CREATE EARNING
// ──────────────────────────────────────────────────
try {
  if (TEST_FUND_ID) {
    const { status, data } = await api('POST', '/finance/earnings', {
      fundId: TEST_FUND_ID,
      amount: 3000,
      description: 'Smoke test earning — interest income',
      category: 'Income',
    });
    record('Create Earning', status === 201 || status === 200, undefined, { amount: 3000 });
  } else {
    record('Create Earning', false, 'No fund available');
  }
} catch (e: any) {
  record('Create Earning', false, e.message);
}

// ──────────────────────────────────────────────────
// 11. LIST TRANSACTIONS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/finance/transactions?limit=5');
  const ok = status === 200 && data.data && Array.isArray(data.data);
  record('List Transactions', ok, undefined, { count: data.data?.length, total: data.meta?.total });
} catch (e: any) {
  record('List Transactions', false, e.message);
}

// ──────────────────────────────────────────────────
// 12. GET ANALYTICS STATS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/analytics/stats');
  const ok = status === 200 && typeof data.totalMembers === 'number';
  record('Analytics Stats', ok, undefined, {
    members: data.totalMembers,
    deposits: data.totalDeposits,
    capital: data.investedCapital,
    yield: data.yieldIndex,
  });
} catch (e: any) {
  record('Analytics Stats', false, e.message);
}

// ──────────────────────────────────────────────────
// 13. CREATE PROJECT
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('POST', '/projects', {
    title: `Smoke Test Project ${Date.now().toString().slice(-4)}`,
    category: 'Technology',
    description: 'Automated test project',
    initialInvestment: 25000,
    budget: 50000,
    expectedRoi: 15,
    totalShares: 100,
    status: 'In Progress',
    health: 'Stable',
    startDate: new Date().toISOString(),
    involvedMembers: TEST_MEMBER_ID ? [{
      memberId: TEST_MEMBER_ID,
      sharesInvested: 50,
    }] : [],
  });
  const ok = status === 201 || status === 200;
  if (ok) TEST_PROJECT_ID = data.id || data._id;
  record('Create Project', ok, undefined, { id: TEST_PROJECT_ID, title: data.title });
} catch (e: any) {
  record('Create Project', false, e.message);
}

// ──────────────────────────────────────────────────
// 14. LIST PROJECTS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/projects');
  const ok = status === 200 && data.data && Array.isArray(data.data);
  record('List Projects', ok, undefined, { count: data.data?.length });
} catch (e: any) {
  record('List Projects', false, e.message);
}

// ──────────────────────────────────────────────────
// 15. GET SETTINGS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/settings');
  record('Get Settings', status === 200, undefined, { shareValue: data.shareValueBdt });
} catch (e: any) {
  record('Get Settings', false, e.message);
}

// ──────────────────────────────────────────────────
// 16. UPDATE SETTINGS
// ──────────────────────────────────────────────────
try {
  const { status } = await api('PUT', '/settings', {
    financial: { withdrawalLimitPercent: 30, withdrawalNoticeDays: 45 },
  });
  record('Update Settings', status === 200);
} catch (e: any) {
  record('Update Settings', false, e.message);
}

// ──────────────────────────────────────────────────
// 17. WITHDRAWAL VALIDATION
// ──────────────────────────────────────────────────
if (TEST_MEMBER_ID && TEST_FUND_ID) {
  try {
    const { status, data } = await api('POST', '/finance/withdrawal/validate', {
      memberId: TEST_MEMBER_ID,
      amount: 1000,
      fundId: TEST_FUND_ID,
    });
    record('Withdrawal Validation', status === 200, undefined, data);
  } catch (e: any) {
    record('Withdrawal Validation', false, e.message);
  }
}

// ──────────────────────────────────────────────────
// 18. SURPLUS CALCULATION
// ──────────────────────────────────────────────────
try {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);
  const { status, data } = await api('POST', '/finance/surplus', {
    startDate: startDate.toISOString(),
    endDate: new Date().toISOString(),
  });
  record('Surplus Calculation', status === 200, undefined, {
    netSurplus: data.netSurplus,
    distributable: data.distributableSurplus,
  });
} catch (e: any) {
  record('Surplus Calculation', false, e.message);
}

// ──────────────────────────────────────────────────
// 19. SHARE CONSISTENCY CHECK
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/finance/share-consistency');
  record('Share Consistency', status === 200, undefined, { overall: data.overall });
} catch (e: any) {
  record('Share Consistency', false, e.message);
}

// ──────────────────────────────────────────────────
// 20. TRANSFER FUNDS
// ──────────────────────────────────────────────────
try {
  // Create a second fund for transfer test
  const { data: fund2 } = await api('POST', '/funds', {
    name: 'Test Secondary Fund',
    type: 'OTHER',
    status: 'ACTIVE',
    initialBalance: 0,
  });
  const fund2Id = fund2.id || fund2._id;

  if (TEST_FUND_ID && fund2Id) {
    const { status, data } = await api('POST', '/finance/transfer', {
      sourceFundId: TEST_FUND_ID,
      targetFundId: fund2Id,
      amount: 500,
      description: 'Smoke test transfer',
    });
    record('Fund Transfer', status === 201 || status === 200, undefined, { amount: 500 });
  } else {
    record('Fund Transfer', false, 'Could not create second fund');
  }
} catch (e: any) {
  record('Fund Transfer', false, e.message);
}

// ──────────────────────────────────────────────────
// 21. GOALS
// ──────────────────────────────────────────────────
try {
  const { status: createStatus } = await api('POST', '/goals', {
    title: 'Smoke Test Goal',
    targetAmount: 100000,
    currentAmount: 25000,
    type: 'Savings',
    status: 'In Progress',
  });
  record('Create Goal', createStatus === 201 || createStatus === 200);

  const { status: listStatus, data: goalData } = await api('GET', '/goals');
  record('List Goals', listStatus === 200, undefined, { count: goalData.data?.length || goalData.length });
} catch (e: any) {
  record('Goals', false, e.message);
}

// ──────────────────────────────────────────────────
// 22. AUDIT LOGS
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('GET', '/audit?limit=5');
  record('Audit Logs', status === 200, undefined, { count: data.data?.length || 0 });
} catch (e: any) {
  record('Audit Logs', false, e.message);
}

// ──────────────────────────────────────────────────
// 23. REPORTS
// ──────────────────────────────────────────────────
try {
  const { status } = await api('GET', '/reports?type=Funds%20Summary');
  record('Reports - Funds Summary', status === 200);
} catch (e: any) {
  record('Reports', false, e.message);
}

// ──────────────────────────────────────────────────
// 24. TOKEN REFRESH
// ──────────────────────────────────────────────────
try {
  const { status, data } = await api('POST', '/auth/refresh', {
    refreshToken: REFRESH_TOKEN,
  });
  if (status === 200) {
    ACCESS_TOKEN = data.accessToken;
    REFRESH_TOKEN = data.refreshToken;
  }
  record('Token Refresh', status === 200, status !== 200 ? `Status ${status}` : undefined);
} catch (e: any) {
  record('Token Refresh', false, e.message);
}

// ──────────────────────────────────────────────────
// 25. LOGOUT
// ──────────────────────────────────────────────────
try {
  const { status } = await api('POST', '/auth/logout', {
    refreshToken: REFRESH_TOKEN,
  });
  record('Logout', status === 200);
} catch (e: any) {
  record('Logout', false, e.message);
}

// ──────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (failed > 0) {
  console.log('\n[ERROR] Failures:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`   - ${r.name}: ${r.error || 'Unknown error'}`);
  });
}
