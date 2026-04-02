
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { User, AppScreen, AccessLevel } from './types';
import { Language } from './i18n/translations';
import { GlobalStateProvider } from './context/GlobalStateContext';
import { Sparkles } from 'lucide-react';
import { authService, isNetworkError } from './services/api';
import ConnectionBanner from './components/ConnectionBanner';
import ErrorBoundary from './components/ErrorBoundary';
import SessionTimeoutDialog from './components/SessionTimeoutDialog';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';

// Layout Components (Lazy)
const Sidebar = React.lazy(() => import('./components/Sidebar'));
const Header = React.lazy(() => import('./components/Header'));
const AIAdvisorSidebar = React.lazy(() => import('./components/AIAdvisorSidebar'));
const Forbidden = React.lazy(() => import('./components/Forbidden'));
const NotFound = React.lazy(() => import('./components/NotFound'));
const Login = React.lazy(() => import('./components/Login'));

// Static Components
import ProtectedRoute from './components/ProtectedRoute';

// Lazy Loaded Route Components
const LandingPage = React.lazy(() => import('./components/landing/LandingPage'));
const Dashboard = React.lazy(() => import('./components/Dashboard'));
const Members = React.lazy(() => import('./components/Members'));
const Deposits = React.lazy(() => import('./components/Deposits'));
const RequestDeposit = React.lazy(() => import('./components/RequestDeposit'));
const ProjectManagement = React.lazy(() => import('./components/ProjectManagement'));
const FundsManagement = React.lazy(() => import('./components/FundsManagement'));
const Transactions = React.lazy(() => import('./components/Transactions'));
const Expenses = React.lazy(() => import('./components/Expenses'));
const Analysis = React.lazy(() => import('./components/Analysis'));
const Reports = React.lazy(() => import('./components/Reports'));
const Settings = React.lazy(() => import('./components/Settings'));
const DividendManagement = React.lazy(() => import('./components/DividendManagement'));
const Goals = React.lazy(() => import('./components/Goals'));

// Extracted AppLayout component
const AppLayout = ({ children, user, lang, isDarkMode, toggleTheme, setLang, onLogout }: {
  children: React.ReactNode,
  user: User | null,
  lang: Language,
  isDarkMode: boolean,
  toggleTheme: () => void,
  setLang: (l: Language) => void,
  onLogout: () => void
}) => {
  const [isAISidebarOpen, setIsAISidebarOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] dark:bg-[#111814] overflow-hidden transition-colors duration-300">
      <Sidebar lang={lang} currentUser={user} />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <ConnectionBanner />
        <Header
          user={user}
          onLogout={onLogout}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          lang={lang}
          setLang={setLang}
        />
        <main className="flex-1 overflow-y-auto p-10">
          <div className="max-w-[1600px] mx-auto pb-20">
            {children}
          </div>
        </main>

        <button
          onClick={() => setIsAISidebarOpen(true)}
          className="fixed bottom-10 right-10 w-20 h-20 bg-dark dark:bg-brand text-white dark:text-dark rounded-[2.5rem] shadow-2xl shadow-brand/20 flex items-center justify-center hover:scale-110 active:scale-95 transition-all group z-[90]"
          aria-label="Open AI Advisor"
        >
          <div className="absolute inset-0 bg-brand/20 rounded-[2.5rem] animate-ping group-hover:animate-none opacity-40"></div>
          <Sparkles size={32} strokeWidth={3} className="relative z-10" />
        </button>

        <AIAdvisorSidebar
          isOpen={isAISidebarOpen}
          onClose={() => setIsAISidebarOpen(false)}
          lang={lang}
        />
      </div>
    </div>
  );
};

const AppContent: React.FC<{ user: User | null; setUser: (u: User | null) => void; isLoading: boolean }> = ({ user, setUser, isLoading }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const navigate = useNavigate();
  const location = useLocation();

  // Inactivity timeout hook
  const { showWarning, timeRemaining, extendSession, logout: timeoutLogout } = useInactivityTimeout({
    timeoutMs: 2 * 60 * 1000,  // 2 minutes of inactivity before warning
    warningDurationMs: 60 * 1000,  // 60 seconds warning
    onLogout: () => {
      authService.logout();
      setUser(null);
      navigate('/login?session=timeout');
    },
    enabled: !!user,  // Only enable when user is logged in
  });

  // Handle logout with session extension
  const handleExtendSession = async () => {
    try {
      // Refresh the token to extend session
      const userInfo = localStorage.getItem('userInfo');
      if (userInfo) {
        const { refreshToken } = JSON.parse(userInfo);
        if (refreshToken) {
          await authService.refreshToken(refreshToken);
        }
      }
      extendSession();
    } catch (error) {
      console.error('Failed to extend session:', error);
      timeoutLogout();
    }
  };

  useEffect(() => {
    const getPageTitle = (path: string) => {
      switch (path) {
        case '/dashboard': return 'Dashboard';
        case '/members': return 'Members';
        case '/goals': return 'Goals';
        case '/deposits': return 'Deposits';
        case '/request-deposit': return 'Request Deposit';
        case '/transactions': return 'Transactions';
        case '/expenses': return 'Expenses';
        case '/projects': return 'Projects';
        case '/dividends': return 'Dividends';
        case '/funds': return 'Funds';
        case '/analysis': return 'Analysis';
        case '/reports': return 'Reports';
        case '/settings': return 'Settings';
        case '/login': return 'Login';
        default: return 'Strategic Wealth Intelligence';
      }
    };
    document.title = `InvestWise | ${getPageTitle(location.pathname)}`;
  }, [location]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    // Apply font-family classes to root for proper language rendering
    document.documentElement.classList.remove('lang-en', 'lang-bn');
    document.documentElement.classList.add(`lang-${lang}`);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const handleLogin = (loggedUser: User) => {
    setUser(loggedUser);
    localStorage.setItem('userInfo', JSON.stringify(loggedUser));
    // Redirection is now handled by Login.tsx
  };

  const handleLogout = () => {
    localStorage.removeItem('userInfo');
    setUser(null);
    navigate('/login');
  };

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F8FAFC] dark:bg-[#111814]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400 font-semibold">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <React.Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-[#F8FAFC] dark:bg-[#111814]">
        <div className="w-16 h-16 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      </div>
    }>
      <Routes>
        {/* Public Route */}
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" replace /> : <Login onLogin={handleLogin} lang={lang} />}
        />

        {/* Root Route - Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Protected Routes */}
        <Route path="/dashboard" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.DASHBOARD} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Dashboard isDarkMode={isDarkMode} lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/members" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.MEMBERS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Members lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/goals" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.GOALS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Goals lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/deposits" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.DEPOSITS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Deposits lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/request-deposit" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.REQUEST_DEPOSIT} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <RequestDeposit lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/transactions" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.TRANSACTIONS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Transactions lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/expenses" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.EXPENSES} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Expenses lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/projects" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.PROJECT_MANAGEMENT} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <ProjectManagement lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/dividends" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.DIVIDENDS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <DividendManagement lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/funds" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.FUNDS_MANAGEMENT} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <FundsManagement lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/analysis" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.ANALYSIS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Analysis lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/reports" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.REPORTS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Reports lang={lang} />
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute user={user} requiredScreen={AppScreen.SETTINGS} appShell={(props) => <AppLayout {...props} user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout} />} forbiddenComponent={<Forbidden />}>
            <Settings currentUser={user!} lang={lang} />
          </ProtectedRoute>
        } />

        {/* 404 Route */}
        <Route path="*" element={
          user ? (
            <AppLayout user={user} lang={lang} isDarkMode={isDarkMode} toggleTheme={toggleTheme} setLang={setLang} onLogout={handleLogout}>
              <NotFound />
            </AppLayout>
          ) : (
            <Navigate to="/login" replace />
          )
        } />
      </Routes>

      {/* Session Timeout Dialog */}
      <SessionTimeoutDialog
        isOpen={showWarning}
        timeRemaining={timeRemaining}
        onExtend={handleExtendSession}
        onLogout={timeoutLogout}
      />
    </React.Suspense>
  );
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Securely restore user session
  useEffect(() => {
    const hydrateAuth = async () => {
      const storedUser = localStorage.getItem('userInfo');
      if (storedUser) {
        try {
          // Verify with backend instead of trusting local storage
          const profile = await authService.getProfile();
          setUser(profile);
        } catch (error: any) {
          console.error("Session check failed:", error);

          if (error.response?.status === 401) {
            // Token is invalid/expired
            localStorage.removeItem('userInfo');
            setUser(null);
          } else if (isNetworkError(error) || (error.response?.status >= 500)) {
            // Network/Server error - assume offline and use cached creds
            console.warn("Network unreachable, restoring cached session");
            try {
              const cached = JSON.parse(storedUser);
              setUser(cached);
            } catch (e) {
              localStorage.removeItem('userInfo');
              setUser(null);
            }
          } else {
            // For other errors, default to safe fallback (maybe API changed but token is valid?)
            // We'll preserve session to be safe unless it's definitely unauthorized.
            try {
              const cached = JSON.parse(storedUser);
              setUser(cached);
            } catch (e) {
              setUser(null);
            }
          }
        }
      }
      setIsLoading(false);
    };

    hydrateAuth();
  }, []);

  return (
    <ErrorBoundary>
      <GlobalStateProvider user={user}>
        <Router>
          <AppContent user={user} setUser={setUser} isLoading={isLoading} />
        </Router>
      </GlobalStateProvider>
    </ErrorBoundary>
  );
};

export default App;
