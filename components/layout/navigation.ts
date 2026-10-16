import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  PiggyBank,
  PieChart,
  PlusCircle,
  Settings,
  ShieldCheck,
  Target,
  Trash2,
  UserCog,
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
      { id: "USERS", labelKey: "nav.users", route: "/users", icon: UserCog },
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
      {
        id: "TRANSACTIONS_DELETED",
        labelKey: "nav.deletedTransactions",
        route: "/transactions/deleted",
        icon: Trash2,
      },
      { id: "DIVIDENDS", labelKey: "nav.dividends", route: "/dividends", icon: PieChart },
      { id: "FISCAL", labelKey: "nav.fiscal", route: "/fiscal", icon: Calendar },
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
      { id: "AUDIT", labelKey: "nav.audit", route: "/audit", icon: History },
      { id: "SETTINGS", labelKey: "nav.settings", route: "/settings", icon: Settings },
    ],
  },
];

// Route → nav item. Derived from
// NAVIGATION so the mapping can never drift from the sidebar. Longest prefix
// wins and only full segments match: "/deposits/request" is REQUEST_DEPOSIT
// (not DEPOSITS), "/members/123" is MEMBERS, "/depositsX" matches nothing.
const EXTRA_ROUTE_SCREENS: Record<string, string> = {
  // Alias route for the same member-facing request screen.
  "/request-deposit": "REQUEST_DEPOSIT",
};

export function navItemForRoute(pathname: string): NavItem | null {
  let bestRoute = "";
  let bestItem: NavItem | null = null;
  const consider = (route: string, item: NavItem | null) => {
    const matches = pathname === route || pathname.startsWith(route + "/");
    if (matches && route.length > bestRoute.length) {
      bestRoute = route;
      bestItem = item;
    }
  };
  for (const group of NAVIGATION) {
    for (const item of group.items) consider(item.route, item);
  }
  for (const [route, screen] of Object.entries(EXTRA_ROUTE_SCREENS)) {
    // The alias has no nav entry of its own; borrow the screen it renders.
    consider(route, NAVIGATION.flatMap((g) => g.items).find((item) => item.id === screen) ?? null);
  }
  return bestItem;
}

/** Route → screen id for the AppShell access gate (403 screen) and tab title. */
export function screenForRoute(pathname: string): string | null {
  return navItemForRoute(pathname)?.id ?? null;
}
