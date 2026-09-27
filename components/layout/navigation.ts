import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  LayoutDashboard,
  PiggyBank,
  PieChart,
  PlusCircle,
  Settings,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  id: string;
  labelKey: string;
  route: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

export interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

// Port of client/constants.tsx NAVIGATION_ITEMS + Sidebar getRoute mapping.
export const NAVIGATION: NavGroup[] = [
  {
    groupKey: "nav.management",
    items: [
      { id: "DASHBOARD", labelKey: "nav.dashboard", route: "/", icon: LayoutDashboard },
      { id: "MEMBERS", labelKey: "nav.members", route: "/members", icon: Users },
      { id: "MEETINGS", labelKey: "nav.meetings", route: "/meetings", icon: Calendar },
      { id: "GOVERNANCE", labelKey: "nav.governance", route: "/governance", icon: ShieldCheck },
      { id: "GOALS", labelKey: "nav.goals", route: "/goals", icon: Target },
    ],
  },
  {
    groupKey: "nav.operations",
    items: [
      { id: "DEPOSITS", labelKey: "nav.deposits", route: "/deposits", icon: Wallet },
      {
        id: "REQUEST_DEPOSIT",
        labelKey: "nav.requestDeposit",
        route: "/deposits/request",
        icon: PlusCircle,
      },
      {
        id: "TRANSACTIONS",
        labelKey: "nav.transactions",
        route: "/transactions",
        icon: ArrowLeftRight,
      },
      { id: "DIVIDENDS", labelKey: "nav.dividends", route: "/dividends", icon: PieChart },
      { id: "EXPENSES", labelKey: "nav.expenses", route: "/expenses", icon: CreditCard },
    ],
  },
  {
    groupKey: "nav.strategy",
    items: [
      {
        id: "PROJECT_MANAGEMENT",
        labelKey: "nav.projectMgmt",
        route: "/projects",
        icon: Briefcase,
      },
      { id: "FUNDS_MANAGEMENT", labelKey: "nav.fundsMgmt", route: "/funds", icon: PiggyBank },
      { id: "ANALYSIS", labelKey: "nav.analysis", route: "/analysis", icon: BarChart3 },
      { id: "REPORTS", labelKey: "nav.reports", route: "/reports", icon: FileText },
      { id: "SETTINGS", labelKey: "nav.settings", route: "/settings", icon: Settings },
    ],
  },
];
