import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, AlertCircle, WifiOff, XCircle, Loader2, ArrowRight } from "lucide-react";
import { User as UserType } from "../types";
import { Language } from "../i18n/translations";
import { authService, isNetworkError } from "../services/api";

interface LoginProps {
  onLogin: (user: UserType) => void;
  lang: Language;
}

type ErrorType = "credentials" | "network" | "server" | "validation" | null;
interface LoginError { type: ErrorType; message: string; details?: string; }

const LogoMark = () => (
  <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
    <rect width="28" height="28" rx="6" fill="#1e293b" />
    <rect x="5" y="18" width="3" height="5" rx="0.5" fill="#2563eb" opacity="0.4" />
    <rect x="9.5" y="14" width="3" height="9" rx="0.5" fill="#2563eb" opacity="0.6" />
    <rect x="14" y="16" width="3" height="7" rx="0.5" fill="#2563eb" opacity="0.8" />
    <rect x="18.5" y="9" width="3" height="14" rx="0.5" fill="#2563eb" />
    <path d="M5 18 L11 11 L16 15 L23 7" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [shake, setShake] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const from = location.state?.from?.pathname || new URLSearchParams(location.search).get("redirect") || "/dashboard";

  React.useEffect(() => {
    const s = new URLSearchParams(location.search).get("session");
    if (s === "timeout" || s === "expired") {
      setError({ type: "server", message: "Session expired", details: "You were logged out due to inactivity. Please sign in again." });
      navigate("/login", { replace: true });
    }
  }, [location.search, navigate]);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 500); };

  const validate = (): boolean => {
    if (!identifier.trim()) { setError({ type: "validation", message: "Email is required", details: "Enter your registered email address." }); triggerShake(); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) { setError({ type: "validation", message: "Invalid email format", details: "Please enter a valid email address." }); triggerShake(); return false; }
    if (!password) { setError({ type: "validation", message: "Password is required", details: "Enter your password to continue." }); triggerShake(); return false; }
    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!validate()) return;
    setIsLoading(true);
    try {
      const data = await authService.login(identifier.trim(), password);
      setTimeout(() => { onLogin(data); navigate(from, { replace: true }); }, 200);
    } catch (err: any) {
      setIsLoading(false); triggerShake();
      if (isNetworkError(err)) setError({ type: "network", message: "Connection failed", details: "Unable to reach the server. Check your internet connection." });
      else if (err.response?.status === 401) setError({ type: "credentials", message: "Invalid credentials", details: "The email or password you entered is incorrect." });
      else if (err.response?.status === 429) setError({ type: "server", message: "Too many attempts", details: "Please wait a few minutes and try again." });
      else if (err.response?.status === 403) setError({ type: "server", message: "Access denied", details: "Your account has been suspended." });
      else if (err.response?.status >= 500) setError({ type: "server", message: "Server error", details: "Something went wrong. Please try again later." });
      else setError({ type: "server", message: err.response?.data?.message || "Authentication failed", details: "An unexpected error occurred." });
    }
  };

  const inputCls = `w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-blue-500 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-colors`;
  const errCls = `border-red-400 dark:border-red-500`;
  const isFieldErr = error?.type === "credentials" || error?.type === "validation";

  const kpis = [
    { label: "Total Deposits", value: "৳847M", note: "+12.4% YoY" },
    { label: "Active Projects", value: "24", note: "+3 this month" },
    { label: "Net Profit", value: "৳124M", note: "+8.1% YoY" },
    { label: "Annual Returns", value: "31.2%", note: "vs 24.8% last yr" },
  ];
  const bars = [38, 52, 41, 68, 59, 73, 61, 82, 70, 88, 76, 95];

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950">

      {/* ─ Left: Form ─ */}
      <div className={`w-full lg:w-[460px] xl:w-[500px] flex flex-col justify-center px-8 sm:px-12 xl:px-14 py-12 border-r border-gray-100 dark:border-gray-800 ${shake ? "animate-shake" : ""}`}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <LogoMark />
          <span className="text-sm font-semibold text-gray-900 dark:text-white tracking-tight">
            Invest<span className="text-blue-600">Wise</span>
          </span>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight mb-1.5">
            Sign in to your account
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter your credentials to access the platform.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className={`flex items-start gap-2.5 px-3.5 py-3 rounded border text-sm mb-6 ${
            error.type === "network"
              ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
              : error.type === "validation"
              ? "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400"
              : "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
          }`}>
            <span className="mt-0.5 flex-shrink-0">
              {error.type === "network" ? <WifiOff size={14} /> : error.type === "credentials" ? <XCircle size={14} /> : <AlertCircle size={14} />}
            </span>
            <div>
              <p className="font-medium">{error.message}</p>
              {error.details && <p className="text-xs mt-0.5 opacity-75">{error.details}</p>}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Email address</label>
            <input
              id="login-email"
              type="email"
              name="login-email"
              autoComplete="email"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); if (isFieldErr) setError(null); }}
              placeholder="you@company.com"
              className={`${inputCls} ${isFieldErr ? errCls : ""}`}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Password</label>
              <button type="button" className="text-xs text-blue-600 dark:text-blue-400 hover:opacity-75 transition-opacity">Forgot password?</button>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                name="login-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (isFieldErr) setError(null); }}
                placeholder="••••••••"
                className={`${inputCls} pr-10 ${isFieldErr ? errCls : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">Keep me signed in</span>
          </label>

          <button
            id="login-submit"
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <><Loader2 size={14} className="animate-spin" /><span>Signing in…</span></>
            ) : (
              <><span>Sign in</span><ArrowRight size={14} /></>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-12 pt-5 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <p className="text-[11px] text-gray-400 dark:text-gray-600">InvestWise Enterprise v2.0</p>
          <div className="flex gap-4">
            <a href="#" className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Security</a>
            <a href="#" className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Privacy</a>
          </div>
        </div>
      </div>

      {/* ─ Right: Brand panel ─ */}
      <div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-gray-950 relative overflow-hidden px-12">
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        {/* Glows */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 w-full max-w-xs space-y-8">
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {kpis.map((k) => (
              <div key={k.label} className="bg-white/[0.04] border border-white/[0.07] rounded-lg p-4">
                <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">{k.label}</p>
                <p className="text-lg font-semibold text-white leading-none mb-1.5">{k.value}</p>
                <span className="text-[10px] text-emerald-400">{k.note}</span>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div>
            <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-2.5">Monthly performance</p>
            <div className="flex items-end gap-1 h-14">
              {bars.map((h, i) => (
                <div key={i} className="flex-1 rounded-sm bg-blue-600" style={{ height: `${h}%`, opacity: 0.35 + i * 0.05 }} />
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m) => (
                <span key={m} className="text-[8px] text-gray-700">{m}</span>
              ))}
            </div>
          </div>

          {/* Tagline */}
          <div className="border-t border-white/[0.06] pt-6">
            <p className="text-sm font-medium text-white/70 leading-relaxed">
              Enterprise-grade portfolio management for growing investment firms.
            </p>
            <p className="text-xs text-gray-600 mt-1.5">Trusted by 200+ fund managers worldwide.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
