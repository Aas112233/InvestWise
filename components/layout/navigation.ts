import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  HandCoins,
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
import type { TenantModuleKey } from "@/lib/tenant-modules";

export interface NavItem {
  id: string;
  labelKey: string;
  route: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /**
   * Tenant module entitlement this screen belongs to (lib/tenant-modules).
   * The sidebar hides the item and the AppShell 403-gates the route when the
   * tenant is not licensed for it — mirroring the API's per-route module
   * check, so UI and backend cannot disagree. Absent = not licensable
   * (dashboard, fiscal, the users directory).
   */
  module?: TenantModuleKey;
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
      { id: "MEMBERS", labelKey: "nav.members", route: "/members", icon: Users, module: "members" },
      { id: "USERS", labelKey: "nav.users", route: "/users", icon: UserCog },
      { id: "MEETINGS", labelKey: "nav.meetings", route: "/meetings", icon: Calendar, module: "meetings" },
      { id: "GOVERNANCE", labelKey: "nav.governance", route: "/governance", icon: ShieldCheck, module: "governance" },
      { id: "GOALS", labelKey: "nav.goals", route: "/goals", icon: Target, module: "goals" },
    ],
  },
  {
    groupKey: "nav.operations",
    items: [
      { id: "DEPOSITS", labelKey: "nav.deposits", route: "/deposits", icon: Wallet, module: "deposits" },
      {
        id: "REQUEST_DEPOSIT",
        labelKey: "nav.requestDeposit",
        route: "/deposits/request",
        icon: PlusCircle,
        module: "requestDeposit",
      },
      {
        id: "TRANSACTIONS",
        labelKey: "nav.transactions",
        route: "/transactions",
        icon: ArrowLeftRight,
        module: "transactions",
      },
      {
        id: "TRANSACTIONS_DELETED",
        labelKey: "nav.deletedTransactions",
        route: "/transactions/deleted",
        icon: Trash2,
        module: "transactions",
      },
      { id: "DIVIDENDS", labelKey: "nav.dividends", route: "/dividends", icon: PieChart, module: "dividends" },
      // Exit settlements for suspended members. Licensable under the dividends
      // module (both are member disbursements) but gated by its own PAYOUTS
      // screen permission, so a treasurer can pay dividends without being able
      // to settle a member out.
      { id: "PAYOUTS", labelKey: "nav.payouts", route: "/payouts", icon: HandCoins, module: "dividends" },
      { id: "FISCAL", labelKey: "nav.fiscal", route: "/fiscal", icon: Calendar },
      { id: "EXPENSES", labelKey: "nav.expenses", route: "/expenses", icon: CreditCard, module: "expenses" },
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
        module: "projects",
      },
      { id: "FUNDS_MANAGEMENT", labelKey: "nav.fundsMgmt", route: "/funds", icon: PiggyBank, module: "funds" },
      { id: "ANALYSIS", labelKey: "nav.analysis", route: "/analysis", icon: BarChart3, module: "analysis" },
      { id: "REPORTS", labelKey: "nav.reports", route: "/reports", icon: FileText, module: "reports" },
      { id: "AUDIT", labelKey: "nav.audit", route: "/audit", icon: History, module: "audit" },
      { id: "SETTINGS", labelKey: "nav.settings", route: "/settings", icon: Settings, module: "settings" },
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
