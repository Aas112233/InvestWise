import { Deposit, Transaction, Expense, Project, Member, Fund } from '../types';
import { formatDate } from './formatters';
import { numberToWords } from './numberToWords';

export interface VoucherLineItem {
  description: string;
  quantity?: string | number;
  rate?: string | number;
  amount: number;
}

export interface DividendScheduleItem {
  sl: number;
  memberName: string;
  memberId: string;
  shares: number;
  sharePercentage: number;
  grossProfit: number;
  deductionsOrLoss: number;
  netPayout: number;
}

export interface DividendBreakdownSummary {
  totalPoolAmount: number;
  totalPoolShares: number;
  ratePerShare: number;
  memberShares: number;
  memberShareRatio: string;
  grossProfit: number;
  lossOrDeductions: number;
  netPayout: number;
  sourceType: string;
  sourceName: string;
  projectRevenue?: number;
  projectExpenses?: number;
  projectSurplus?: number;
}

export interface VoucherDocument {
  voucherNo: string;
  voucherType: 'DEPOSIT' | 'EXPENSE' | 'TRANSACTION' | 'DIVIDEND' | 'PROJECT';
  title: string;
  date: string;
  period?: string;
  status: string;
  
  // Primary Party Details
  entityName: string;
  entityId?: string;
  entitySubtitle?: string;
  entityDetails?: { label: string; value: string }[];

  // Financial Vault / Account Details
  fundName?: string;
  fundAccount?: string;
  paymentMethod?: string;

  // Financial Amounts
  amount: number;
  amountFormatted: string;
  amountInWords: string;
  currency: string;
  items: VoucherLineItem[];

  // Enhanced Breakdown Metrics (for Dividend / Settlements)
  breakdownSummary?: DividendBreakdownSummary;

  // Full Multi-Member Distribution Schedule (for Batch Roll / Statements)
  distributionSchedule?: DividendScheduleItem[];

  // Metadata & Audit
  notes?: string;
  preparedBy: string;
  authorizedBy: string;
  receivedBy: string;
  verificationCode: string;
}

/**
 * Format numerical amount with currency code (e.g., "BDT 50,000" or "USD 50,000")
 */
function formatWithCurrency(amount: number, currencyCode: string): string {
  return `${currencyCode} ${Number(amount || 0).toLocaleString('en-US')}`;
}

/**
 * Generate a clean Money Receipt for Deposits.
 */
export function generateDepositReceipt(
  deposit: Deposit,
  members: Member[] = [],
  funds: Fund[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const depositId = deposit.id || deposit._id || 'DEP-000';
  const shortId = depositId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const voucherNo = `RCP-${shortId}`;

  // Resolve member
  const member = members.find(
    (m) => m.id === deposit.memberMongoId || m.id === deposit.memberId || m.memberId === deposit.memberId
  );

  const fund = funds.find((f) => f.id === deposit.fundId || (f as any)._id === deposit.fundId);
  const amount = Number(deposit.amount) || 0;

  return {
    voucherNo,
    voucherType: 'DEPOSIT',
    title: 'OFFICIAL MONEY RECEIPT',
    date: deposit.date ? formatDate(deposit.date) : formatDate(new Date().toISOString()),
    status: deposit.status || 'Completed',
    entityName: deposit.memberName || member?.name || 'Member',
    entityId: deposit.memberId || member?.memberId || undefined,
    entitySubtitle: member?.phone ? `Contact: ${member.phone}` : undefined,
    entityDetails: [
      { label: 'Depositor', value: deposit.memberName || member?.name || 'N/A' },
      { label: 'Member ID', value: deposit.memberId || member?.memberId || 'N/A' },
      { label: 'Fund Account', value: fund?.name || 'Main Vault' },
      { label: 'Deposit Method', value: deposit.depositMethod || 'Cash' },
      { label: 'Fiscal Month', value: deposit.depositMonth || 'Current' },
      { label: 'Posting Date', value: formatDate(deposit.date) },
    ],
    fundName: fund?.name || 'General Investment Pool',
    fundAccount: fund?.accountNumber || 'VAULT-01',
    paymentMethod: deposit.depositMethod || 'Cash',
    amount,
    amountFormatted: formatWithCurrency(amount, currencyCode),
    amountInWords: numberToWords(amount, currencyCode),
    currency: currencyCode,
    items: [
      {
        description: `Monthly Capital Contribution - ${deposit.depositMonth || 'General'}`,
        quantity: deposit.shareNumber ? `${deposit.shareNumber} Units` : '1 Unit',
        rate: formatWithCurrency(amount, currencyCode),
        amount,
      },
    ],
    notes: deposit.description || '',
    preparedBy: deposit.cashierName || 'Cashier Desk',
    authorizedBy: 'Investment Board',
    receivedBy: deposit.memberName || member?.name || 'Depositor Signature',
    verificationCode: `IVW-${shortId}`,
  };
}

/**
 * Generate a clean Transaction Voucher.
 */
export function generateTransactionVoucher(
  txn: Transaction,
  members: Member[] = [],
  funds: Fund[] = [],
  projects: Project[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const txnId = txn.id || (txn as any)._id || 'TXN-000';
  const shortId = txnId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const voucherNo = `VCH-${shortId}`;

  const member = members.find((m) => m.id === txn.memberId || m.memberId === txn.memberId);
  const fund = funds.find((f) => f.id === txn.fundId || (f as any)._id === txn.fundId);
  const project = projects.find((p) => p.id === txn.projectId || (p as any)._id === txn.projectId);

  const amount = Number(txn.amount) || 0;
  const isDebit = txn.type === 'Expense' || txn.type === 'Project-Disbursement';

  return {
    voucherNo,
    voucherType: 'TRANSACTION',
    title: isDebit ? 'DEBIT VOUCHER' : 'CREDIT VOUCHER',
    date: txn.date ? formatDate(txn.date) : formatDate(new Date().toISOString()),
    period: txn.depositMonth || undefined,
    status: txn.status || 'Completed',
    entityName: txn.memberName || member?.name || project?.title || 'General Account',
    entityId: txn.memberId || member?.memberId || undefined,
    entitySubtitle: txn.type,
    entityDetails: [
      { label: 'Type', value: txn.type },
      { label: 'Fund', value: txn.fundName || fund?.name || 'General Fund' },
      { label: 'Project', value: project?.title || 'N/A' },
      { label: 'Status', value: txn.status || 'Completed' },
    ],
    fundName: txn.fundName || fund?.name || 'General Fund',
    fundAccount: fund?.accountNumber || 'VAULT-01',
    paymentMethod: txn.paymentMethod || 'Ledger',
    amount,
    amountFormatted: formatWithCurrency(amount, currencyCode),
    amountInWords: numberToWords(amount, currencyCode),
    currency: currencyCode,
    items: [
      {
        description: txn.description || `${txn.type} Transaction`,
        amount,
      },
    ],
    notes: txn.notes || (txn.description !== txn.type ? txn.description : ''),
    preparedBy: txn.handlingOfficer || 'Accounts Officer',
    authorizedBy: 'Authorized Officer',
    receivedBy: txn.memberName || member?.name || 'Receiver',
    verificationCode: `IVW-${shortId}`,
  };
}

/**
 * Generate a clean Payment Voucher for Expenses.
 */
export function generateExpenseVoucher(
  expense: Expense,
  funds: Fund[] = [],
  projects: Project[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const expId = expense.id || (expense as any)._id || 'EXP-000';
  const shortId = expId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const voucherNo = `EXP-${shortId}`;

  const fund = funds.find((f) => f.id === expense.sourceFundId || (f as any)._id === expense.sourceFundId);
  const project = projects.find((p) => p.id === expense.projectId || (p as any)._id === expense.projectId);
  const amount = Number(expense.amount) || 0;

  return {
    voucherNo,
    voucherType: 'EXPENSE',
    title: 'PAYMENT DISBURSEMENT VOUCHER',
    date: expense.date ? formatDate(expense.date) : formatDate(new Date().toISOString()),
    status: expense.status || 'Approved',
    entityName: expense.claimant || 'Official Payee',
    entitySubtitle: expense.category ? `Category: ${expense.category}` : undefined,
    entityDetails: [
      { label: 'Payee / Claimant', value: expense.claimant || 'N/A' },
      { label: 'Category', value: expense.category || 'General Operations' },
      { label: 'Funding Source', value: fund?.name || 'Operations Fund' },
      { label: 'Linked Project', value: project?.title || 'Operational Cost' },
      { label: 'Payment Method', value: expense.paymentMethod || 'Bank Transfer' },
    ],
    fundName: fund?.name || 'Operations Fund',
    fundAccount: fund?.accountNumber || 'VAULT-02',
    paymentMethod: expense.paymentMethod || 'Bank Transfer',
    amount,
    amountFormatted: formatWithCurrency(amount, currencyCode),
    amountInWords: numberToWords(amount, currencyCode),
    currency: currencyCode,
    items: [
      {
        description: expense.description || 'Administrative / Operational Disbursement',
        amount,
      },
    ],
    notes: expense.notes || '',
    preparedBy: expense.claimant || 'Prepared By',
    authorizedBy: 'Authorized Officer',
    receivedBy: 'Payee Signature',
    verificationCode: `IVW-${shortId}`,
  };
}

/**
 * Generate a comprehensive, verified Dividend Distribution Slip for an individual member.
 */
export function generateDividendVoucher(
  record: any,
  members: Member[] = [],
  projects: Project[] = [],
  funds: Fund[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const divId = record.id || record._id || 'DIV-000';
  const shortId = divId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const voucherNo = `DIV-${shortId}`;

  const member = members.find(
    (m) => m.id === record.memberId || m.memberId === record.memberId || m.id === record.memberId?.id || m.memberId === record.memberId?.memberId
  );
  const project = projects.find((p) => p.id === record.projectId || (p as any)._id === record.projectId);
  const fund = funds.find((f) => f.id === record.fundId || (f as any)._id === record.fundId);
  const netAmount = Number(record.amount) || 0;

  const memberShares = Number(member?.shares) || 1;
  const activeMembers = members.filter((m) => m.status === 'active');
  const totalPoolShares = activeMembers.reduce((sum, m) => sum + (Number(m.shares) || 0), 0) || memberShares;
  const ownershipPercentage = totalPoolShares > 0 ? (memberShares / totalPoolShares) * 100 : 100;
  const ratePerShare = memberShares > 0 ? netAmount / memberShares : netAmount;
  const estimatedTotalPool = ratePerShare * totalPoolShares;

  const projectEarnings = Number(project?.totalEarnings) || 0;
  const projectExpenses = Number(project?.totalExpenses) || 0;
  const projectInvestment = Number(project?.initialInvestment) || 0;
  const projectSurplus = Math.max(0, projectEarnings - projectExpenses - projectInvestment);

  const items: VoucherLineItem[] = [
    {
      description: `Dividend Profit Payout (${memberShares} Share Units @ ${currencyCode} ${ratePerShare.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/Unit)`,
      quantity: `${memberShares} Units`,
      rate: `${currencyCode} ${ratePerShare.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      amount: netAmount,
    },
    {
      description: `Equity Proportion: ${ownershipPercentage.toFixed(2)}% of ${totalPoolShares} Total Pool Shares`,
      amount: 0,
    },
    {
      description: `Distribution Source: ${project ? `Project: ${project.title}` : `Global Treasury: ${fund?.name || 'Main Reserve'}`}`,
      amount: 0,
    },
  ];

  if (project) {
    items.push({
      description: `Project Financials: Realized Revenue ${currencyCode} ${projectEarnings.toLocaleString()} | Overhead/Loss ${currencyCode} ${projectExpenses.toLocaleString()}`,
      amount: 0,
    });
  }

  const breakdownSummary: DividendBreakdownSummary = {
    totalPoolAmount: estimatedTotalPool,
    totalPoolShares: totalPoolShares,
    ratePerShare: ratePerShare,
    memberShares: memberShares,
    memberShareRatio: `${ownershipPercentage.toFixed(2)}%`,
    grossProfit: netAmount,
    lossOrDeductions: 0,
    netPayout: netAmount,
    sourceType: project ? 'Project Venture' : 'Global Treasury Pool',
    sourceName: project?.title || fund?.name || 'General Dividend Pool',
    projectRevenue: projectEarnings,
    projectExpenses: projectExpenses,
    projectSurplus: projectSurplus,
  };

  const partnerName = record.memberName || member?.name || record.memberId?.name || 'Shareholding Partner';
  const partnerId = record.memberId?.memberId || member?.memberId || record.memberId || 'N/A';

  return {
    voucherNo,
    voucherType: 'DIVIDEND',
    title: 'MEMBER DIVIDEND SETTLEMENT SLIP',
    date: record.date ? formatDate(record.date) : formatDate(new Date().toISOString()),
    status: record.status || 'Disbursed',
    entityName: partnerName,
    entityId: partnerId !== 'N/A' ? partnerId : undefined,
    entitySubtitle: `${memberShares} Shares (${ownershipPercentage.toFixed(2)}% Equity Ratio)`,
    entityDetails: [
      { label: 'Partner Name', value: partnerName },
      { label: 'Partner ID', value: partnerId },
      { label: 'Member Shares', value: `${memberShares} Units (${ownershipPercentage.toFixed(2)}%)` },
      { label: 'Payout Rate', value: `${currencyCode} ${ratePerShare.toFixed(2)} / Unit` },
      { label: 'Source Fund/Venture', value: project ? `Project: ${project.title}` : (fund?.name || 'General Reserve') },
      { label: 'Settlement Date', value: formatDate(record.date) },
    ],
    fundName: fund?.name || (project ? `Project: ${project.title}` : 'Dividend Reserve'),
    fundAccount: fund?.accountNumber || 'VAULT-DIV-01',
    paymentMethod: 'Direct Account Credit',
    amount: netAmount,
    amountFormatted: formatWithCurrency(netAmount, currencyCode),
    amountInWords: numberToWords(netAmount, currencyCode),
    currency: currencyCode,
    items,
    breakdownSummary,
    notes: record.description || `Verified dividend disbursement according to registered partnership equity shares.`,
    preparedBy: 'Financial Officer',
    authorizedBy: 'Managing Trustee',
    receivedBy: partnerName,
    verificationCode: `IVW-${shortId}`,
  };
}

/**
 * Generate a Consolidated Dividend Distribution Roll / Statement covering all members.
 */
export function generateDividendBatchStatement(
  batchData: {
    type: 'Global' | 'Project' | string;
    amount: number;
    projectId?: string;
    sourceFundId?: string;
    description?: string;
    date?: string;
    referenceNumber?: string;
  },
  members: Member[] = [],
  projects: Project[] = [],
  funds: Fund[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const shortId = (batchData.referenceNumber || Date.now().toString()).slice(-6).toUpperCase();
  const voucherNo = `DIV-ROLL-${shortId}`;
  const totalAmount = Number(batchData.amount) || 0;

  const project = projects.find((p) => p.id === batchData.projectId || (p as any)._id === batchData.projectId);
  const fund = funds.find((f) => f.id === batchData.sourceFundId || (f as any)._id === batchData.sourceFundId);

  const activeMembers = members.filter((m) => m.status === 'active');
  const totalShares = activeMembers.reduce((sum, m) => sum + (Number(m.shares) || 0), 0) || 1;
  const ratePerShare = totalShares > 0 ? totalAmount / totalShares : 0;

  const schedule: DividendScheduleItem[] = activeMembers.map((m, idx) => {
    const shares = Number(m.shares) || 0;
    const sharePercentage = totalShares > 0 ? (shares / totalShares) * 100 : 0;
    const payout = Math.floor(shares * ratePerShare * 100) / 100;
    return {
      sl: idx + 1,
      memberName: m.name,
      memberId: m.memberId || m.id,
      shares,
      sharePercentage,
      grossProfit: payout,
      deductionsOrLoss: 0,
      netPayout: payout,
    };
  });

  const projectEarnings = Number(project?.totalEarnings) || 0;
  const projectExpenses = Number(project?.totalExpenses) || 0;
  const projectSurplus = Math.max(0, projectEarnings - projectExpenses - (Number(project?.initialInvestment) || 0));

  const items: VoucherLineItem[] = [
    {
      description: `Total Distributable Dividend Pool (${activeMembers.length} Partners • ${totalShares} Total Shares)`,
      quantity: `${totalShares} Units`,
      rate: `${currencyCode} ${ratePerShare.toFixed(2)}/Unit`,
      amount: totalAmount,
    },
    {
      description: `Distribution Channel: ${project ? `Project: ${project.title}` : `Fund: ${fund?.name || 'General Reserve'}`}`,
      amount: 0,
    },
  ];

  return {
    voucherNo,
    voucherType: 'DIVIDEND',
    title: 'CONSOLIDATED DIVIDEND DISTRIBUTION ROLL',
    date: batchData.date ? formatDate(batchData.date) : formatDate(new Date().toISOString()),
    status: 'Authorized & Disbursed',
    entityName: project ? project.title : (fund?.name || 'All Active Partners'),
    entitySubtitle: `${activeMembers.length} Partners • ${totalShares} Shares • Rate: ${currencyCode} ${ratePerShare.toFixed(2)}/Share`,
    entityDetails: [
      { label: 'Distribution Mode', value: batchData.type === 'Project' ? 'Project Venture Yield' : 'Global Partnership Pool' },
      { label: 'Source', value: project ? `Project: ${project.title}` : (fund?.name || 'Main Fund') },
      { label: 'Total Partners', value: `${activeMembers.length} Active Partners` },
      { label: 'Total Shares', value: `${totalShares} Units` },
      { label: 'Rate Per Share', value: `${currencyCode} ${ratePerShare.toFixed(4)}` },
      { label: 'Execution Date', value: formatDate(batchData.date || new Date().toISOString()) },
    ],
    fundName: fund?.name || (project ? `Project: ${project.title}` : 'Dividend Reserve'),
    fundAccount: fund?.accountNumber || 'VAULT-DIV-MASTER',
    paymentMethod: 'Batch Ledger Distribution',
    amount: totalAmount,
    amountFormatted: formatWithCurrency(totalAmount, currencyCode),
    amountInWords: numberToWords(totalAmount, currencyCode),
    currency: currencyCode,
    items,
    breakdownSummary: {
      totalPoolAmount: totalAmount,
      totalPoolShares: totalShares,
      ratePerShare: ratePerShare,
      memberShares: totalShares,
      memberShareRatio: '100%',
      grossProfit: totalAmount,
      lossOrDeductions: 0,
      netPayout: totalAmount,
      sourceType: project ? 'Project Venture' : 'Global Fund',
      sourceName: project?.title || fund?.name || 'Treasury Pool',
      projectRevenue: projectEarnings,
      projectExpenses: projectExpenses,
      projectSurplus: projectSurplus,
    },
    distributionSchedule: schedule,
    notes: batchData.description || `Consolidated distribution record for all registered active stakeholders.`,
    preparedBy: 'Financial Controller',
    authorizedBy: 'Board of Trustees',
    receivedBy: 'Partner Equity Ledger',
    verificationCode: `IVW-ROLL-${shortId}`,
  };
}

/**
 * Generate a clean Project Capital Certificate.
 */
export function generateProjectCertificate(
  project: Project,
  funds: Fund[] = [],
  currencyCode = 'BDT'
): VoucherDocument {
  const prjId = project.id || (project as any)._id || 'PRJ-000';
  const shortId = prjId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const voucherNo = `PRJ-${shortId}`;

  const fund = funds.find((f) => f.id === project.sourceFundId || (f as any)._id === project.sourceFundId);
  const amount = Number(project.initialInvestment) || 0;

  return {
    voucherNo,
    voucherType: 'PROJECT',
    title: 'PROJECT CAPITAL ALLOCATION',
    date: project.startDate ? formatDate(project.startDate) : formatDate(new Date().toISOString()),
    status: project.status || 'Active',
    entityName: project.title,
    entitySubtitle: `Category: ${project.category} • ROI: ${project.expectedRoi}%`,
    entityDetails: [
      { label: 'Project', value: project.title },
      { label: 'Category', value: project.category },
      { label: 'Expected ROI', value: `${project.expectedRoi}%` },
      { label: 'Fund', value: fund?.name || 'Investment Fund' },
    ],
    fundName: fund?.name || 'Investment Fund',
    fundAccount: fund?.accountNumber || 'VAULT-03',
    paymentMethod: 'Capital Allocation',
    amount,
    amountFormatted: formatWithCurrency(amount, currencyCode),
    amountInWords: numberToWords(amount, currencyCode),
    currency: currencyCode,
    items: [
      {
        description: `Initial Capital Allocation for ${project.title}`,
        amount,
      },
    ],
    notes: project.description || '',
    preparedBy: project.manager || 'Project Manager',
    authorizedBy: 'Authorized Officer',
    receivedBy: 'Project Lead',
    verificationCode: `IVW-${shortId}`,
  };
}
