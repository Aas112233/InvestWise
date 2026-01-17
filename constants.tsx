
import React from 'react';
import {
  LayoutDashboard,
  Users,
  Wallet,
  PlusCircle,
  ArrowLeftRight,
  Briefcase,
  PiggyBank,
  CreditCard,
  BarChart3,
  FileText,
  Target,
  Settings,
  PieChart
} from 'lucide-react';
import { AppScreen } from './types';

export const NAVIGATION_ITEMS = [
  {
    groupKey: 'nav.management',
    items: [
      { id: AppScreen.DASHBOARD, labelKey: 'nav.dashboard', icon: <LayoutDashboard size={20} /> },
      { id: AppScreen.MEMBERS, labelKey: 'nav.members', icon: <Users size={20} /> },
      { id: AppScreen.GOALS, labelKey: 'nav.goals', icon: <Target size={20} /> },
    ]
  },
  {
    groupKey: 'nav.operations',
    items: [
      { id: AppScreen.DEPOSITS, labelKey: 'nav.deposits', icon: <Wallet size={20} /> },
      { id: AppScreen.REQUEST_DEPOSIT, labelKey: 'nav.requestDeposit', icon: <PlusCircle size={20} /> },
      { id: AppScreen.TRANSACTIONS, labelKey: 'nav.transactions', icon: <ArrowLeftRight size={20} /> },
      { id: AppScreen.DIVIDENDS, labelKey: 'nav.dividends', icon: <PieChart size={20} /> },
      { id: AppScreen.EXPENSES, labelKey: 'nav.expenses', icon: <CreditCard size={20} /> },
    ]
  },
  {
    groupKey: 'nav.strategy',
    items: [
      { id: AppScreen.PROJECT_MANAGEMENT, labelKey: 'nav.projectMgmt', icon: <Briefcase size={20} /> },
      { id: AppScreen.FUNDS_MANAGEMENT, labelKey: 'nav.fundsMgmt', icon: <PiggyBank size={20} /> },
      { id: AppScreen.ANALYSIS, labelKey: 'nav.analysis', icon: <BarChart3 size={20} /> },
      { id: AppScreen.REPORTS, labelKey: 'nav.reports', icon: <FileText size={20} /> },
      { id: AppScreen.SETTINGS, labelKey: 'nav.settings', icon: <Settings size={20} /> },
    ]
  }
];
