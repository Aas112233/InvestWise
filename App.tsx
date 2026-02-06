
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Members from './components/Members';
import Deposits from './components/Deposits';
import RequestDeposit from './components/RequestDeposit';
import ProjectManagement from './components/ProjectManagement';
import FundsManagement from './components/FundsManagement';
import Transactions from './components/Transactions';
import Expenses from './components/Expenses';
import Analysis from './components/Analysis';
import Reports from './components/Reports';
import Settings from './components/Settings';
import Login from './components/Login';
import LandingPage from './components/landing/LandingPage';
import ProtectedRoute from './components/ProtectedRoute';
import DividendManagement from './components/DividendManagement';
import AIAdvisorSidebar from './components/AIAdvisorSidebar';
import Goals from './components/Goals';
import Forbidden from './components/Forbidden';
import NotFound from './components/NotFound';
import { User, AppScreen, AccessLevel } from './types';
import { Language } from './i18n/translations';
import { GlobalStateProvider } from './context/GlobalStateContext';
import { Sparkles } from 'lucide-react';
import { authService, isNetworkError } from './services/api';
import ConnectionBanner from './components/ConnectionBanner';

const AppContent: React.FC<{ user: User | null; setUser: (u: User | null) => void; isLoading: boolean }> = ({ user, setUser, isLoading }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [isAISidebarOpen, setIsAISidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
  );
};

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
    <GlobalStateProvider user={user}>
      <Router>
        <AppContent user={user} setUser={setUser} isLoading={isLoading} />
      </Router>
    </GlobalStateProvider>
  );
};

export default App;
