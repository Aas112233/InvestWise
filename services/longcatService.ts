import { Language, t } from '../i18n/translations';

const LONGCAT_API_URL = 'https://api.longcat.chat/openai/v1/chat/completions';

// API key should be loaded from backend for security
// Frontend should never have direct API key access
// This is a fallback for development only - in production use backend proxy
const API_KEY = import.meta.env.VITE_LONGCAT_API_KEY || '';

// Check if API key is available
const hasApiKey = () => {
  const key = API_KEY;
  if (!key || key === '') {
    console.warn('⚠️ LongCat API key not configured. AI features will be limited.');
    console.warn('💡 Add LONGCAT_API_KEY to server/.env file');
    return false;
  }
  return true;
};

export type QueryType =
  | 'overview'
  | 'member'
  | 'project'
  | 'fund'
  | 'deposits'
  | 'expenses'
  | 'risk'
  | 'trends';

interface QueryOptions {
  type: QueryType;
  memberId?: string;
  projectId?: string;
  fundId?: string;
  searchQuery?: string;
  customInstruction?: string;
}

// Token Bucket Rate Limiter
class AIRateLimiter {
  private tokens: number = 3; // Allow 3 burst requests
  private maxTokens: number = 3;
  private refillRate: number = 1; // 1 token per refill
  private refillInterval: number = 2000; // Refill every 2 seconds
  private lastRefill: number = Date.now();
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];
  private processing: boolean = false;
  private refillTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startRefillTimer();
  }

  private startRefillTimer() {
    this.refillTimer = setInterval(() => {
      if (this.tokens < this.maxTokens) {
        this.tokens = Math.min(this.tokens + this.refillRate, this.maxTokens);
      }
      this.processQueue();
    }, this.refillInterval);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0 && this.tokens > 0) {
      const { fn, resolve, reject } = this.queue.shift()!;
      this.tokens--;

      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }
    this.processing = false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getAvailableTokens(): number {
    return this.tokens;
  }

  destroy() {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
    }
  }
}

// Create singleton rate limiter instance
const aiRateLimiter = new AIRateLimiter();

const SYSTEM_PROMPT = `You are the InvestWise AI Strategist. Provide concise, data-driven insights.
RULES:
- Use ONLY the provided data - no assumptions or hallucinations
- Be specific with numbers and names
- Max 4-5 short bullet points for standard analysis
- For custom queries, provide DIRECT answers - answer exactly what is asked
- No emojis - use professional formatting
- For tables: Use markdown table format when showing comparisons, timelines, or structured data
- Table Format: | Header 1 | Header 2 | Header 3 |
               |----------|----------|----------|
               | Row 1    | Data     | Value    |
- Language: Respond in the same language as the user's request (English or Bengali/বাংলা)
- For custom instructions: Analyze the request carefully and use the provided data to answer
- If data is insufficient, clearly state what data is missing

CUSTOM QUERY HANDLING - IMPORTANT:
- For "did not deposit" queries: Use the "MEMBERS WHO DID NOT DEPOSIT IN EACH MONTH" section directly - DO NOT list all deposits
- For "which members" queries: List specific member NAMES with their IDs
- For "show transaction IDs" queries: List ONLY the transaction IDs requested - DO NOT add analysis or insights
- For fund-specific queries: Use the "Fund Transactions" section to find transactions by fund name
- For "performance report" or "member deposit" queries: Create a markdown table showing member name, months, amounts
- For comparison queries: Show both sides with specific numbers
- For trend queries: Reference actual data points from the provided information
- Read the user's question carefully - if they ask about who did NOT do something, list ONLY those who did NOT
- BE DIRECT: If user asks for IDs, give ONLY IDs. If user asks for names, give ONLY names. No extra commentary.
- For timeline/data requests: Use tables for better readability`;

const buildContext = (state: any, options: QueryOptions) => {
  const { type, memberId, projectId, fundId, searchQuery, customInstruction } = options;

  const totalFunds = state.funds.reduce((acc: number, f: any) => acc + f.balance, 0);
  const activeProjects = state.projects.filter((p: any) => p.status === 'In Progress');
  const totalDeposits = state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0);
  const totalExpenses = state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0);

  // Build member deposit activity map for custom queries
  const memberDepositActivity = state.members.map((m: any) => {
    const memberDeposits = state.deposits.filter((d: any) => d.memberId === m.id);
    const depositMonths = [...new Set(memberDeposits.map((d: any) => d.depositMonth))];
    const totalContribution = memberDeposits.reduce((acc: number, d: any) => acc + d.amount, 0);
    return {
      id: m.id,
      name: m.name,
      memberId: m.memberId,
      role: m.role,
      shares: m.shares || 0,
      totalContribution,
      depositCount: memberDeposits.length,
      depositMonths,
      hasDepositedInMonth: (month: string) => depositMonths.includes(month),
    };
  });

  // Pre-compute members who did NOT deposit in each month
  const allDepositMonths = [...new Set(state.deposits.map((d: any) => d.depositMonth))];
  const membersNotDepositedByMonth: Record<string, any[]> = {};
  allDepositMonths.forEach(month => {
    membersNotDepositedByMonth[month] = memberDepositActivity.filter(m => !m.depositMonths.includes(month));
  });

  // Build fund transaction mapping
  const fundTransactions: Record<string, any[]> = {};
  state.deposits.forEach((d: any) => {
    const fundName = state.funds.find((f: any) => f.id === d.fundId)?.name || `Fund ${d.fundId}`;
    if (!fundTransactions[fundName]) {
      fundTransactions[fundName] = [];
    }
    fundTransactions[fundName].push({
      id: d.id,
      txId: d.id,
      memberId: d.memberId,
      memberName: state.members.find((m: any) => m.id === d.memberId)?.name || 'Unknown',
      amount: d.amount,
      depositMonth: d.depositMonth,
      date: d.date,
    });
  });

  let contextData = {
    overview: {
      totalFunds: totalFunds.toLocaleString(),
      activeProjects: activeProjects.length,
      totalProjects: state.projects.length,
      members: state.members.length,
      totalDeposits: totalDeposits.toLocaleString(),
      totalExpenses: totalExpenses.toLocaleString(),
      netPosition: (totalDeposits - totalExpenses).toLocaleString(),
      topProjects: activeProjects.length > 0 ? activeProjects.slice(0, 3).map((p: any) => `${p.title}: BDT ${p.budget?.toLocaleString() || 0}`) : ['No active projects'],
      recentExpenses: state.expenses.length > 0 ? state.expenses.slice(0, 3).map((e: any) => `${e.category}: BDT ${e.amount.toLocaleString()}`) : ['No recent expenses'],
    },
    member: null as any,
    project: null as any,
    fund: null as any,
    deposits: null as any,
    expenses: null as any,
    risk: null as any,
    trends: null as any,
    // Enhanced data for custom queries
    allMembers: memberDepositActivity,
    allDeposits: state.deposits.map((d: any) => ({
      id: d.id,
      memberId: d.memberId,
      memberName: state.members.find((m: any) => m.id === d.memberId)?.name || 'Unknown',
      amount: d.amount,
      depositMonth: d.depositMonth,
      date: d.date,
      fundId: d.fundId,
    })),
    allProjects: state.projects.map((p: any) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      budget: p.budget || 0,
      spent: state.expenses.filter((e: any) => e.projectId === p.id).reduce((acc: number, e: any) => acc + e.amount, 0),
    })),
    allFunds: state.funds.map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      balance: f.balance,
      initialBalance: f.initialBalance || 0,
    })),
    // Pre-computed negative queries
    membersNotDepositedByMonth: membersNotDepositedByMonth,
    inactiveMembers: memberDepositActivity.filter(m => m.depositCount === 0),
    // Fund transaction mapping
    fundTransactions: fundTransactions,
  };

  if (type === 'member' && memberId) {
    const member = state.members.find((m: any) => m.id === memberId || m._id === memberId);
    if (member) {
      const memberDeposits = state.deposits.filter((d: any) =>
        d.memberId === memberId || d.memberId === member.memberId || d.memberId?._id === memberId
      );
      const totalContribution = memberDeposits.reduce((acc: number, d: any) => acc + (d.amount || 0), 0);
      contextData.member = {
        name: member.name || 'Unknown',
        memberId: member.memberId || member.id || 'N/A',
        role: member.role || 'Member',
        totalContribution: totalContribution.toLocaleString(),
        depositCount: memberDeposits.length || 0,
        shares: member.shares || 0,
        recentDeposits: memberDeposits.slice(0, 3).map((d: any) => `${d.depositMonth || 'N/A'}: BDT ${(d.amount || 0).toLocaleString()}`),
      };
    }
  }

  if (type === 'project' && projectId) {
    const project = state.projects.find((p: any) => p.id === projectId || p._id === projectId);
    if (project) {
      const projectExpenses = state.expenses.filter((e: any) =>
        e.projectId === projectId || e.projectId?._id === projectId
      );
      const totalSpent = projectExpenses.reduce((acc: number, e: any) => acc + (e.amount || 0), 0);
      contextData.project = {
        title: project.title || 'Unknown Project',
        status: project.status || 'Unknown',
        budget: (project.budget || 0).toLocaleString(),
        totalSpent: totalSpent.toLocaleString(),
        remaining: ((project.budget || 0) - totalSpent).toLocaleString(),
        expenseCount: projectExpenses.length || 0,
        roi: project.roi || 'N/A',
        recentExpenses: projectExpenses.slice(0, 3).map((e: any) => `${e.category || 'General'}: BDT ${(e.amount || 0).toLocaleString()}`),
      };
    }
  }

  if (type === 'fund' && fundId) {
    const fund = state.funds.find((f: any) => f.id === fundId || f._id === fundId);
    if (fund) {
      contextData.fund = {
        name: fund.name || 'Unknown Fund',
        type: fund.type || 'General',
        balance: (fund.balance || 0).toLocaleString(),
        initialBalance: (fund.initialBalance || 0).toLocaleString(),
        change: (fund.balance - (fund.initialBalance || 0)).toLocaleString(),
        officer: fund.handlingOfficer || 'N/A',
      };
    }
  }

  if (type === 'deposits') {
    const depositsByMonth: Record<string, number> = {};
    state.deposits?.forEach((d: any) => {
      depositsByMonth[d.depositMonth] = (depositsByMonth[d.depositMonth] || 0) + d.amount;
    });
    const topContributors = [...state.members]
      .map(m => ({
        name: m.name,
        total: state.deposits?.filter((d: any) => d.memberId === m.id).reduce((acc: number, d: any) => acc + d.amount, 0) || 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    contextData.deposits = {
      total: totalDeposits.toLocaleString(),
      count: state.deposits?.length || 0,
      byMonth: Object.entries(depositsByMonth).slice(0, 6).map(([month, amount]) => `${month}: BDT ${amount.toLocaleString()}`),
      topContributors: topContributors.map(c => `${c.name}: BDT ${c.total.toLocaleString()}`),
    };
  }

  if (type === 'expenses') {
    const expensesByCategory: Record<string, number> = {};
    state.expenses?.forEach((e: any) => {
      expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + e.amount;
    });
    contextData.expenses = {
      total: totalExpenses.toLocaleString(),
      count: state.expenses?.length || 0,
      byCategory: Object.entries(expensesByCategory).map(([cat, amount]) => `${cat}: BDT ${amount.toLocaleString()}`),
      recent: state.expenses?.slice(0, 5).map((e: any) => `${e.description}: BDT ${e.amount.toLocaleString()}`) || [],
    };
  }

  if (type === 'risk') {
    const lowFunds = state.funds.filter((f: any) => f.balance < 100000);
    const overBudgetProjects = state.projects.filter((p: any) => {
      const spent = state.expenses?.filter((e: any) => e.projectId === p.id).reduce((acc: number, e: any) => acc + e.amount, 0) || 0;
      return p.budget && spent > p.budget;
    });
    const inactiveMembers = state.members.filter((m: any) => {
      return (state.deposits?.filter((d: any) => d.memberId === m.id).length || 0) === 0;
    }).slice(0, 5);
    contextData.risk = {
      lowFunds: lowFunds.map((f: any) => `${f.name}: BDT ${f.balance.toLocaleString()}`),
      overBudgetProjects: overBudgetProjects.map((p: any) => `${p.title}: Exceeded by BDT ${(state.expenses?.filter((e: any) => e.projectId === p.id).reduce((acc: number, e: any) => acc + e.amount, 0) || 0) - (p.budget || 0)}`),
      inactiveMembers: inactiveMembers.map((m: any) => m.name),
      highExpenses: (state.expenses?.filter((e: any) => e.amount > 50000).slice(0, 3) || []).map((e: any) => `${e.description}: BDT ${e.amount.toLocaleString()}`),
    };
  }

  if (type === 'trends') {
    const monthlyDeposits = state.deposits?.reduce((acc: number, d: any) => acc + d.amount, 0) || 0;
    const monthlyExpenses = state.expenses?.reduce((acc: number, e: any) => acc + e.amount, 0) || 0;
    const savingsRate = monthlyDeposits > 0 ? ((monthlyDeposits - monthlyExpenses) / monthlyDeposits * 100).toFixed(1) : '0';
    const avgDeposit = (state.deposits?.length || 0) > 0 ? (monthlyDeposits / state.deposits.length).toFixed(0) : '0';
    const avgExpense = (state.expenses?.length || 0) > 0 ? (monthlyExpenses / state.expenses.length).toFixed(0) : '0';
    contextData.trends = {
      netFlow: (monthlyDeposits - monthlyExpenses).toLocaleString(),
      savingsRate: `${savingsRate}%`,
      avgDeposit: avgDeposit.toLocaleString(),
      avgExpense: avgExpense.toLocaleString(),
      depositGrowth: (state.deposits?.length || 0) > 0 ? `+${state.deposits.length} transactions` : 'No data',
      expenseRatio: monthlyDeposits > 0 ? `${((monthlyExpenses / monthlyDeposits) * 100).toFixed(0)}% of income` : 'N/A',
    };
  }

  return contextData;
};

const buildPrompt = (type: QueryType, data: any, lang: Language, customInstruction?: string) => {
  const languageInstruction = lang === 'bn'
    ? 'IMPORTANT: Respond in Bengali (বাংলা) language only.'
    : 'IMPORTANT: Respond in English language only.';

  const customInstructionText = customInstruction
    ? `\n\nUSER CUSTOM INSTRUCTION: ${customInstruction}\n\nIMPORTANT: Answer this custom query using the detailed data provided below. Analyze carefully and provide specific names, amounts, and facts from the data.`
    : '';

  // Add detailed data section for custom queries
  const detailedDataSection = `

DETAILED DATA FOR CUSTOM QUERIES:
- All Members: ${data.allMembers.map((m: any) => `${m.name} (ID: ${m.memberId}, Shares: ${m.shares}, Total: BDT ${m.totalContribution.toLocaleString()}, Deposits: ${m.depositCount}, Months: ${m.depositMonths.join(', ')})`).join('; ')}
- All Deposits: ${data.allDeposits.map((d: any) => `TX: ${d.id} | ${d.memberName}: BDT ${d.amount.toLocaleString()} in ${d.depositMonth}`).join('; ')}
- All Projects: ${data.allProjects.map((p: any) => `${p.title} - Status: ${p.status}, Budget: BDT ${p.budget.toLocaleString()}, Spent: BDT ${p.spent.toLocaleString()}`).join('; ')}
- All Funds: ${data.allFunds.map((f: any) => `${f.name} (${f.type}): BDT ${f.balance.toLocaleString()}`).join('; ')}
- Fund Transactions: ${Object.entries(data.fundTransactions).map(([fundName, txs]: [string, any[]]) => `${fundName}: ${txs.map((t: any) => `TX-${t.id} (${t.memberName}, BDT ${t.amount}, ${t.depositMonth})`).join(', ')}`).join('; ')}
- Inactive Members (0 deposits): ${data.inactiveMembers.length > 0 ? data.inactiveMembers.map((m: any) => `${m.name} (${m.memberId})`).join('; ') : 'None'}
`;

  // Add specific section for "did not deposit" queries
  const didNotDepositSection = Object.keys(data.membersNotDepositedByMonth).length > 0
    ? `\n\nMEMBERS WHO DID NOT DEPOSIT IN EACH MONTH:\n` + Object.entries(data.membersNotDepositedByMonth).map(([month, members]: [string, any[]]) =>
        `${month}: ${members.length > 0 ? members.map((m: any) => `${m.name} (${m.memberId})`).join(', ') : 'All members deposited'}`
      ).join('\n')
    : '';

  const prompts: Record<QueryType, string> = {
    overview: `Analyze overall financial health:
- Funds: BDT ${data.overview.totalFunds}
- Active Projects: ${data.overview.activeProjects}/${data.overview.totalProjects}
- Members: ${data.overview.members}
- Total Deposits: BDT ${data.overview.totalDeposits}
- Total Expenses: BDT ${data.overview.totalExpenses}
- Net Position: BDT ${data.overview.netPosition}
- Top Projects: ${data.overview.topProjects.join(', ')}
- Recent Expenses: ${data.overview.recentExpenses.join(', ')}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide key insights on capital efficiency and growth opportunities.`,

    member: data.member ? `Analyze member:
- Name: ${data.member.name}
- ID: ${data.member.memberId}
- Role: ${data.member.role}
- Total Contribution: BDT ${data.member.totalContribution}
- Deposits: ${data.member.depositCount}
- Shares: ${data.member.shares}
- Recent: ${data.member.recentDeposits.join('; ')}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide contribution analysis and engagement assessment.` : lang === 'bn'
      ? 'সদস্য পাওয়া যায়নি। অনুগ্রহ করে সদস্য আইডি পরীক্ষা করে আবার চেষ্টা করুন।'
      : 'Member not found. Please check the member ID and try again.',

    project: data.project ? `Analyze project:
- Title: ${data.project.title}
- Status: ${data.project.status}
- Budget: BDT ${data.project.budget}
- Spent: BDT ${data.project.totalSpent}
- Remaining: BDT ${data.project.remaining}
- Transactions: ${data.project.expenseCount}
- ROI: ${data.project.roi}
- Recent Expenses: ${data.project.recentExpenses.join('; ')}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide budget health and performance insights.` : lang === 'bn'
      ? 'প্রজেক্ট পাওয়া যায়নি। অনুগ্রহ করে প্রজেক্ট আইডি পরীক্ষা করে আবার চেষ্টা করুন।'
      : 'Project not found. Please check the project ID and try again.',

    fund: data.fund ? `Analyze fund:
- Name: ${data.fund.name}
- Type: ${data.fund.type}
- Current Balance: BDT ${data.fund.balance}
- Initial Balance: BDT ${data.fund.initialBalance}
- Change: BDT ${data.fund.change}
- Officer: ${data.fund.officer}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide fund health and liquidity recommendations.` : lang === 'bn'
      ? 'ফান্ড পাওয়া যায়নি। অনুগ্রহ করে ফান্ড আইডি পরীক্ষা করে আবার চেষ্টা করুন।'
      : 'Fund not found. Please check the fund ID and try again.',

    deposits: data.deposits ? `Analyze deposit trends:
- Total Deposits: BDT ${data.deposits.total}
- Transactions: ${data.deposits.count}
- Monthly Breakdown: ${data.deposits.byMonth.join('; ')}
- Top Contributors: ${data.deposits.topContributors.join('; ')}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide insights on contribution patterns and member engagement.` : lang === 'bn'
      ? 'কোন ডিপোজিট ডেটা উপলব্ধ নেই।'
      : 'No deposit data available.',

    expenses: data.expenses ? `Analyze expense patterns:
- Total Expenses: BDT ${data.expenses.total}
- Transactions: ${data.expenses.count}
- By Category: ${data.expenses.byCategory.join('; ')}
- Recent: ${data.expenses.recent.join('; ')}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide spending analysis and cost optimization recommendations.` : lang === 'bn'
      ? 'কোন খরচের ডেটা উপলব্ধ নেই।'
      : 'No expense data available.',

    risk: data.risk ? `Risk assessment:
- Low Balance Funds: ${data.risk.lowFunds.length > 0 ? data.risk.lowFunds.join('; ') : 'None'}
- Over-Budget Projects: ${data.risk.overBudgetProjects.length > 0 ? data.risk.overBudgetProjects.join('; ') : 'None'}
- Inactive Members: ${data.risk.inactiveMembers.length > 0 ? data.risk.inactiveMembers.join(', ') : 'None'}
- High Expenses: ${data.risk.highExpenses.length > 0 ? data.risk.highExpenses.join('; ') : 'None'}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Identify critical risks and recommend immediate actions.` : lang === 'bn'
      ? 'কোন ঝুঁকির ডেটা উপলব্ধ নেই।'
      : 'No risk data available.',

    trends: data.trends ? `Analyze financial trends:
- Net Cash Flow: BDT ${data.trends.netFlow}
- Savings Rate: ${data.trends.savingsRate}
- Avg Deposit: BDT ${data.trends.avgDeposit}
- Avg Expense: BDT ${data.trends.avgExpense}
- Activity: ${data.trends.depositGrowth}
- Expense Ratio: ${data.trends.expenseRatio}
${detailedDataSection}${didNotDepositSection}
${languageInstruction}${customInstructionText}
Provide trend analysis and forward-looking recommendations.` : lang === 'bn'
      ? 'কোন ট্রেন্ডের ডেটা উপলব্ধ নেই।'
      : 'No trend data available.',
  };

  return prompts[type];
};

export const getAdvancedFinancialAdvice = async (
  state: any,
  lang: Language = 'en',
  model: string = 'LongCat-Flash-Lite',
  options?: QueryOptions
): Promise<string> => {
  try {
    const queryType: QueryType = options?.type || 'overview';

    // Validate required data for specific query types
    if (queryType === 'member' && !options?.memberId) {
      return lang === 'bn'
        ? 'কোন সদস্য নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে সদস্য নির্বাচন করুন অথবা নাম/আইডি দিয়ে খুঁজুন।'
        : 'No member selected. Please select a member from the dropdown or search by name/ID.';
    }
    if (queryType === 'project' && !options?.projectId) {
      return lang === 'bn'
        ? 'কোন প্রজেক্ট নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে প্রজেক্ট নির্বাচন করুন অথবা নাম দিয়ে খুঁজুন।'
        : 'No project selected. Please select a project from the dropdown or search by name.';
    }
    if (queryType === 'fund' && !options?.fundId) {
      return lang === 'bn'
        ? 'কোন ফান্ড নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে ফান্ড নির্বাচন করুন অথবা নাম দিয়ে খুঁজুন।'
        : 'No fund selected. Please select a fund from the dropdown or search by name.';
    }

    // Check if state data is available
    if (!state?.members || !state?.funds || !state?.deposits) {
      return lang === 'bn'
        ? 'ডেটা লোড হচ্ছে... অনুগ্রহ করে অপেক্ষা করুন অথবা পেজ রিফ্রেশ করুন।'
        : 'Loading data... Please wait for data to load or refresh the page.';
    }

    const contextData = buildContext(state, options || { type: 'overview' });
    const languageName = lang === 'bn' ? 'Bengali' : 'English';

    const userPrompt = buildPrompt(queryType, contextData, lang, options?.customInstruction);

    // Wrap API call with rate limiter
    return await aiRateLimiter.execute(async () => {
      const requestBody = {
        model: model,
        messages: [
          {
            role: 'system',
            content: `${SYSTEM_PROMPT}\nLanguage: ${languageName}`
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_tokens: model === 'LongCat-Flash-Thinking-2601' || model === 'LongCat-Flash-Omni-2603' ? 500 : 300,
        temperature: 0.5,
        stream: false
      };

      const response = await fetch(LONGCAT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('LongCat API Error:', errorData);
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const advice = data.choices?.[0]?.message?.content || '';

      return advice || (lang === 'bn'
        ? 'বিশ্লেষণের জন্য পর্যাপ্ত ডেটা নেই। অনুগ্রহ করে নিশ্চিত করুন যে ডেটা সঠিকভাবে লোড হয়েছে।'
        : 'Insufficient data for analysis. Please ensure data is properly loaded.');
    });
  } catch (error) {
    console.error("LongCat AI Error:", error);
    return lang === 'bn'
      ? 'এআই সার্ভিস পাওয়া যাচ্ছে না। অনুগ্রহ করে আপনার সংযোগ পরীক্ষা করুন এবং আবার চেষ্টা করুন।\n\nম্যানুয়াল পর্যালোচনা:\n- এপিআই সংযোগ পরীক্ষা করুন\n- ডেটা লোড হয়েছে কিনা যাচাই করুন\n- ম্যানুয়ালি মেট্রিক্স পর্যালোচনা করুন'
      : 'AI service unavailable. Please check your connection and try again.\n\nManual Review Recommended:\n- Check API connection\n- Verify data loaded\n- Review metrics manually';
  }
};

export const getMemberAnalysis = async (state: any, memberId: string, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'member', memberId, customInstruction });
};

export const getProjectAnalysis = async (state: any, projectId: string, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'project', projectId, customInstruction });
};

export const getFundAnalysis = async (state: any, fundId: string, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'fund', fundId, customInstruction });
};

export const getRiskAssessment = async (state: any, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'risk', customInstruction });
};

export const getDepositAnalysis = async (state: any, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'deposits', customInstruction });
};

export const getExpenseAnalysis = async (state: any, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'expenses', customInstruction });
};

export const getTrendAnalysis = async (state: any, lang: Language = 'en', model: string = 'LongCat-Flash-Lite', customInstruction?: string) => {
  return getAdvancedFinancialAdvice(state, lang, model, { type: 'trends', customInstruction });
};

// Export rate limiter status for UI
export const getRateLimiterStatus = () => ({
  queueLength: aiRateLimiter.getQueueLength(),
  availableTokens: aiRateLimiter.getAvailableTokens(),
  isQueued: aiRateLimiter.getQueueLength() > 0,
});
