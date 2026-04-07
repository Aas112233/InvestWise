import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Breadcrumb Navigation Component
 * Auto-generates breadcrumbs from route path
 */

interface BreadcrumbItem {
 label: string;
 path: string;
 isCurrent?: boolean;
}

interface BreadcrumbProps {
 items?: BreadcrumbItem[];
 className?: string;
}

const routeLabels: Record<string, string> = {
 'dashboard': 'Dashboard',
 'members': 'Members',
 'deposits': 'Deposits',
 'request-deposit': 'Request Deposit',
 'transactions': 'Transactions',
 'expenses': 'Expenses',
 'projects': 'Projects',
 'dividends': 'Dividends',
 'funds': 'Funds',
 'analysis': 'Analysis',
 'reports': 'Reports',
 'settings': 'Settings',
 'goals': 'Goals'
};

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className = '' }) => {
 const location = useLocation();

 const generateBreadcrumbs = (): BreadcrumbItem[] => {
 if (items && items.length > 0) return items;

 const pathnames = location.pathname.split('/').filter(Boolean);
 const breadcrumbs: BreadcrumbItem[] = [];

 pathnames.forEach((segment, index) => {
 const path = `/${pathnames.slice(0, index + 1).join('/')}`;
 const label = routeLabels[segment] || segment.replace(/-/g, ' ');
 const isCurrent = index === pathnames.length - 1;

 breadcrumbs.push({
 label,
 path,
 isCurrent
 });
 });

 return breadcrumbs;
 };

 const breadcrumbs = generateBreadcrumbs();

 if (breadcrumbs.length === 0) return null;

 return (
 <nav 
 className={`text-[11px] font-black text-gray-500 dark:text-gray-400 flex items-center gap-2 uppercase tracking-widest ${className}`}
 aria-label="Breadcrumb"
 >
 {/* Home Link */}
 <Link
 to="/dashboard"
 className="flex items-center gap-1 hover:text-brand transition-colors"
 aria-label="Go to dashboard"
 >
 <Home size={12} />
 </Link>

 {breadcrumbs.map((breadcrumb, index) => (
 <React.Fragment key={breadcrumb.path}>
 <ChevronRight size={12} className="opacity-30" />
 
 {breadcrumb.isCurrent ? (
 <span className="text-brand" aria-current="page">
 {breadcrumb.label}
 </span>
 ) : (
 <Link
 to={breadcrumb.path}
 className="hover:text-brand transition-colors"
 >
 {breadcrumb.label}
 </Link>
 )}
 </React.Fragment>
 ))}
 </nav>
 );
};

export default Breadcrumb;
