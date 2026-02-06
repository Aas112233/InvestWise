import React, { useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lock, User, ArrowRight, Loader2, Eye, EyeOff, AlertCircle, WifiOff, XCircle } from 'lucide-react';
import { User as UserType } from '../types';
import { Language, t } from '../i18n/translations';
import { authService, isNetworkError } from '../services/api';
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from 'framer-motion';

interface LoginProps {
  onLogin: (user: UserType) => void;
  lang: Language;
}

// Error types for better UX
type ErrorType = 'credentials' | 'network' | 'server' | 'validation' | null;

interface LoginError {
  type: ErrorType;
  message: string;
  details?: string;
}

// InvestWise Logo Icon Component
const LogoIcon = () => (
  <svg viewBox="0 0 32 32" fill="none" className="w-10 h-10">
    <rect width="32" height="32" rx="8" className="fill-[#151D18] dark:fill-brand" />
    <rect x="6" y="20" width="4" height="7" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.35" />
    <rect x="11" y="16" width="4" height="11" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.55" />
    <rect x="16" y="18" width="4" height="9" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.75" />
    <rect x="21" y="10" width="4" height="17" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.9" />
    <path d="M6 20 L13 12 L18 17 L28 5" className="stroke-brand dark:stroke-[#151D18]" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M24 4 H29 V9" className="stroke-brand dark:stroke-[#151D18]" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);


interface AnimatedStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  colorClass: string;
  bgClass: string;
  className: string;
  dragConstraints: React.RefObject<HTMLDivElement>;
  floatY: number[];
  floatDuration: number;
  floatDelay: number;
  index: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
}

const AnimatedStatCard: React.FC<AnimatedStatCardProps> = ({
  icon,
  label,
  value,
  prefix = "",
  suffix = "",
  colorClass,
  bgClass,
  className,
  dragConstraints,
  floatY,
  floatDuration,
  floatDelay,
  index = 0,
  top,
  left,
  right,
  bottom,
}) => {
  const count = useMotionValue(value);
  const [isBooming, setIsBooming] = React.useState(false);
  const [isBouncing, setIsBouncing] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [displayValue, setDisplayValue] = React.useState<string | number>(value);
  const rounded = useTransform(count, (latest) => {
    if (value % 1 !== 0) return latest.toFixed(1);
    return Math.round(latest);
  });

  React.useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => setDisplayValue(v));
    return () => unsubscribe();
  }, [rounded]);

  const handleClick = () => {
    if (isBooming || isBouncing) return;
    setIsBooming(true);
    count.set(0);
    animate(count, value, {
      duration: 1.5,
      ease: "easeOut",
      onComplete: () => {
        setIsBooming(false);
        setIsBouncing(true);
        setTimeout(() => setIsBouncing(false), 600);
      }
    });
  };

  return (
    <motion.div
      drag
      dragConstraints={dragConstraints}
      dragElastic={0.05}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      initial={{
        opacity: 0,
        scale: 0,
        top: "50%",
        left: "50%",
        x: "-50%",
        y: "-50%"
      }}
      animate={{
        opacity: 1,
        top: top ?? "auto",
        left: left ?? "auto",
        right: right ?? "auto",
        bottom: bottom ?? "auto",
        scale: isBooming ? [1, 1.15, 1] : (isBouncing ? [1, 1.05, 1] : 1),
        x: 0,
        y: isDragging ? 0 : (isBooming ? [0] : (isBouncing ? [0, -20, 0, -10, 0] : floatY)),
        boxShadow: isBooming
          ? ["0 0 0px rgba(191,243,0,0)", "0 0 50px rgba(191,243,0,0.4)", "0 0 0px rgba(191,243,0,0)"]
          : "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
      }}
      transition={{
        opacity: { duration: 0.5, delay: 0.8 + index * 0.1 },
        scale: isBooming
          ? { duration: 0.4 }
          : (isBouncing
            ? { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 1], ease: "easeOut" }
            : { duration: 0.6, delay: 0.8 + index * 0.1, ease: "backOut" }
          ),
        x: { duration: 0.8, delay: 0.8 + index * 0.1, ease: "circOut" },
        top: { duration: 0.8, delay: 0.8 + index * 0.1, ease: "circOut" },
        left: { duration: 0.8, delay: 0.8 + index * 0.1, ease: "circOut" },
        right: { duration: 0.8, delay: 0.8 + index * 0.1, ease: "circOut" },
        bottom: { duration: 0.8, delay: 0.8 + index * 0.1, ease: "circOut" },
        y: isBooming
          ? { duration: 0.4 }
          : (isBouncing
            ? { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 1], ease: "easeOut" }
            : (isDragging ? { duration: 0 } : {
              duration: 0.8,
              delay: 0.8 + index * 0.1,
              ease: "circOut"
            })
          )
      }}
      whileDrag={{ scale: 1.05, zIndex: 100 }}
      whileHover={{ scale: 1.02 }}
      onClick={handleClick}
      className={`absolute select-none cursor-grab active:cursor-grabbing z-20 bg-white/5 backdrop-blur-md rounded-[32px] p-6 border border-white/10 shadow-2xl transition-colors hover:bg-white/10 ${className}`}
    >
      <div className={`w-24 h-24 rounded-3xl ${bgClass} flex items-center justify-center transition-transform group-hover:scale-110`}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] text-gray-500 uppercase tracking-widest font-black">{label}</p>
        <div className="flex items-baseline">
          {prefix && <span className={`${colorClass} font-black text-3xl mr-1`}>{prefix}</span>}
          <p className={`${colorClass} font-black text-5xl tracking-tighter`}>
            {displayValue}
          </p>
          {suffix && <span className={`${colorClass} font-black text-2xl ml-0.5`}>{suffix}</span>}
        </div>
      </div>
    </motion.div>
  );
};

const Login: React.FC<LoginProps> = ({ onLogin, lang }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const illustrationRef = useRef<HTMLDivElement>(null);

  const from = location.state?.from?.pathname ||
    new URLSearchParams(location.search).get('redirect') ||
    "/dashboard";

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleIdentifierChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIdentifier(e.target.value);
    if (error?.type === 'credentials' || error?.type === 'validation') {
      setError(null);
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (error?.type === 'credentials' || error?.type === 'validation') {
      setError(null);
    }
  };

  const validateInputs = (): boolean => {
    if (!identifier.trim()) {
      setError({
        type: 'validation',
        message: 'Email address is required',
        details: 'Please enter your registered email address'
      });
      triggerShake();
      return false;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(identifier)) {
      setError({
        type: 'validation',
        message: 'Invalid email format',
        details: 'Please enter a valid email address'
      });
      triggerShake();
      return false;
    }

    if (!password) {
      setError({
        type: 'validation',
        message: 'Password is required',
        details: 'Please enter your password'
      });
      triggerShake();
      return false;
    }

    if (password.length < 4) {
      setError({
        type: 'validation',
        message: 'Password too short',
        details: 'Password must be at least 4 characters'
      });
      triggerShake();
      return false;
    }

    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateInputs()) return;

    setIsLoading(true);

    try {
      const data = await authService.login(identifier.trim(), password);
      setAttempts(0);

      setTimeout(() => {
        onLogin(data);
        navigate(from, { replace: true });
      }, 300);

    } catch (err: any) {
      console.error('Login error:', err);
      setIsLoading(false);
      setAttempts(prev => prev + 1);
      triggerShake();

      if (isNetworkError(err)) {
        setError({
          type: 'network',
          message: 'Connection failed',
          details: 'Unable to reach the server. Please check your internet connection.'
        });
      } else if (err.response?.status === 401) {
        setError({
          type: 'credentials',
          message: 'Invalid credentials',
          details: 'The email or password you entered is incorrect.'
        });
      } else if (err.response?.status === 429) {
        setError({
          type: 'server',
          message: 'Too many attempts',
          details: 'Please wait a few minutes and try again.'
        });
      } else if (err.response?.status === 403) {
        setError({
          type: 'server',
          message: 'Access denied',
          details: 'Your account has been suspended.'
        });
      } else if (err.response?.status >= 500) {
        setError({
          type: 'server',
          message: 'Server error',
          details: 'Something went wrong. Please try again later.'
        });
      } else {
        setError({
          type: 'server',
          message: err.response?.data?.message || 'Authentication failed',
          details: 'An unexpected error occurred.'
        });
      }
    }
  };

  const getErrorIcon = () => {
    switch (error?.type) {
      case 'network': return <WifiOff size={18} />;
      case 'credentials': return <XCircle size={18} />;
      default: return <AlertCircle size={18} />;
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-white dark:bg-dark">
      {/* Left Panel - Form */}
      <div className={`w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-16 relative bg-white dark:bg-[#0A0F0C] overflow-hidden ${shake ? 'animate-shake' : ''}`}>
        {/* Subtle Background Decoration for Rich Look */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand/20 to-transparent" />
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-brand/5 rounded-full blur-[100px] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full max-w-md relative z-10"
        >
          {/* Logo Section */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-12 flex items-center gap-3"
          >
            <div className="p-2.5 bg-dark dark:bg-brand rounded-2xl shadow-xl shadow-brand/10">
              <LogoIcon />
            </div>
            <div className="h-8 w-[1px] bg-gray-200 dark:bg-gray-800 hidden sm:block" />
            <span className="text-xl font-black text-dark dark:text-white tracking-tight hidden sm:block">
              Invest<span className="text-brand">Wise</span>
            </span>
          </motion.div>

          {/* Header */}
          <div className="mb-10">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-4xl lg:text-5xl font-black text-dark dark:text-white tracking-tighter mb-3 leading-tight"
            >
              Enterprise <br />
              <span className="text-brand">Wealth Control.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-gray-500 dark:text-gray-400 text-base font-medium"
            >
              Secure access to global portfolio management.
            </motion.p>
          </div>

          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className={`p-5 rounded-3xl border overflow-hidden ${error.type === 'network'
                  ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400'
                  : error.type === 'validation'
                    ? 'bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400'
                    : 'bg-rose-50 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400'
                  }`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white/50 dark:bg-black/20 flex items-center justify-center">
                    {getErrorIcon()}
                  </div>
                  <div>
                    <p className="font-bold text-sm tracking-tight">{error.message}</p>
                    <p className="text-xs opacity-70 mt-0.5">{error.details}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.form
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onSubmit={handleLogin}
            className="space-y-6"
          >
            {/* Email */}
            <div className="group space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400 group-focus-within:text-brand transition-colors ml-1">
                Management ID
              </label>
              <div className="relative">
                <input
                  type="email"
                  name="login-email"
                  autoComplete="email"
                  value={identifier}
                  onChange={handleIdentifierChange}
                  placeholder="Enter management email"
                  className={`w-full bg-gray-50 dark:bg-[#121814] border px-5 py-4 rounded-2xl text-sm text-dark dark:text-white outline-none focus:ring-4 focus:ring-brand/10 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 ${error?.type === 'credentials' || error?.type === 'validation'
                    ? 'border-rose-500/50'
                    : 'border-gray-200 dark:border-white/5 focus:border-brand shadow-sm'
                    }`}
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 transition-colors group-focus-within:text-brand">
                  <User size={16} />
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="group space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400 group-focus-within:text-brand transition-colors ml-1">
                Access Token
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="login-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="Enter security password"
                  className={`w-full bg-gray-50 dark:bg-[#121814] border px-5 py-4 pr-14 rounded-2xl text-sm text-dark dark:text-white outline-none focus:ring-4 focus:ring-brand/10 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 ${error?.type === 'credentials' || error?.type === 'validation'
                    ? 'border-rose-500/50'
                    : 'border-gray-200 dark:border-white/5 focus:border-brand shadow-sm'
                    }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-dark dark:text-gray-500 dark:hover:text-brand transition-all"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between pb-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-transparent peer-checked:bg-brand peer-checked:border-brand transition-all flex items-center justify-center">
                    <div className="w-2 h-2 bg-dark rounded-full opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400 group-hover:text-dark dark:group-hover:text-white transition-colors">
                  Keep me connected
                </span>
              </label>
              <button
                type="button"
                className="text-sm font-black text-brand hover:text-brand/80 transition-all hover:tracking-tight"
              >
                Reset Access?
              </button>
            </div>

            {/* Submit Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={isLoading}
              type="submit"
              className={`w-full py-5 rounded-[20px] font-black text-base shadow-2xl transition-all flex items-center justify-center gap-3 disabled:cursor-not-allowed ${error
                ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-500/20'
                : 'bg-brand text-dark hover:shadow-brand/30 ring-1 ring-brand/50'
                } ${isLoading ? 'opacity-70' : ''}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>DECRYPTING ACCESS...</span>
                </>
              ) : error ? (
                <>TRY AGAIN <ArrowRight size={18} strokeWidth={3} /></>
              ) : (
                <>AUTHORIZE SESSION <ArrowRight size={18} strokeWidth={3} /></>
              )}
            </motion.button>
          </motion.form>

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-14 pt-8 border-t border-gray-100 dark:border-gray-900 flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-gray-600">
              InvestWise Enterprise v2.0
            </p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-brand transition-colors">Security</a>
              <a href="#" className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-brand transition-colors">Privacy</a>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Right Panel - Decorative Illustration */}
      <div ref={illustrationRef} className="hidden lg:flex w-1/2 bg-[#151D18] relative overflow-hidden items-center justify-center">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(191,243,0,0.15)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Animated Background Gradients */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 rounded-full blur-[120px] animate-float" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-[100px] animate-float-delayed" />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px] animate-pulse-slow" />
        </div>
        {/* Decorative Elements */}
        <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
          {/* Main Illustration Container */}
          <div className="relative w-full h-full flex items-center justify-center">

            {/* Orbiting Ring - Outer */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full border border-brand/10 animate-spin-slow" />

            {/* Floating Geometric Shapes */}
            <div className="absolute top-8 right-8 w-20 h-20 bg-gradient-to-br from-brand/40 to-brand/10 rounded-2xl rotate-12 animate-float shadow-lg shadow-brand/10" />
            <div className="absolute top-16 left-12 w-14 h-14 bg-gradient-to-br from-emerald-500/30 to-transparent rounded-xl -rotate-12 animate-float-delayed" />
            <div className="absolute bottom-32 right-16 w-16 h-16 border-2 border-brand/40 rounded-xl rotate-45 animate-rotate-slow" />
            <div className="absolute bottom-16 left-20 w-12 h-12 bg-gradient-to-tr from-cyan-400/20 to-transparent rounded-lg rotate-12 animate-bounce-slow" />

            {/* Diamond Shape */}
            <div className="absolute top-1/4 right-8 w-8 h-8 bg-brand/30 rotate-45 animate-pulse" />

            {/* Triangle */}
            <svg className="absolute top-20 left-1/4 w-12 h-12 animate-float" viewBox="0 0 40 40">
              <polygon points="20,5 35,35 5,35" fill="none" stroke="rgba(191,243,0,0.3)" strokeWidth="2" />
            </svg>

            {/* Floating Coins/Circles */}
            <div className="absolute top-1/3 right-1/4">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand to-emerald-400 shadow-lg shadow-brand/30 animate-bounce-slow flex items-center justify-center">
                  <span className="text-dark font-black text-sm">$</span>
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping" />
              </div>
            </div>

            <div className="absolute bottom-1/3 left-1/6">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 shadow-lg animate-float-delayed flex items-center justify-center">
                <span className="text-dark font-bold text-xs">%</span>
              </div>
            </div>

            {/* Stats Cards - Draggable, Animatable & High Impact */}

            <AnimatedStatCard
              label="Total Deposits"
              value={847}
              prefix="৳"
              suffix="M"
              colorClass="text-brand"
              bgClass="bg-brand/20"
              top="2%"
              left="8%"
              className=""
              dragConstraints={illustrationRef}
              floatY={[0, -10, 0]}
              floatDuration={5}
              floatDelay={0}
              index={0}
              icon={
                <svg className="w-12 h-12 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
            />

            <AnimatedStatCard
              label="Active Projects"
              value={2.4}
              suffix="K"
              colorClass="text-cyan-400"
              bgClass="bg-cyan-500/20"
              top="32%"
              left="2%"
              className=""
              dragConstraints={illustrationRef}
              floatY={[0, -15, 0]}
              floatDuration={6}
              floatDelay={1}
              index={1}
              icon={
                <svg className="w-12 h-12 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 3h18v18H3zM12 8v8M8 12h8" />
                </svg>
              }
            />

            <AnimatedStatCard
              label="Net Profit"
              value={124}
              prefix="৳"
              suffix="M"
              colorClass="text-emerald-400"
              bgClass="bg-emerald-500/20"
              top="10%"
              right="8%"
              className=""
              dragConstraints={illustrationRef}
              floatY={[0, -12, 0]}
              floatDuration={5.5}
              floatDelay={0.5}
              index={2}
              icon={
                <svg className="w-12 h-12 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              }
            />

            <AnimatedStatCard
              label="Dividends Paid"
              value={56}
              prefix="৳"
              suffix="M"
              colorClass="text-amber-400"
              bgClass="bg-amber-500/20"
              top="35%"
              right="2%"
              className=""
              dragConstraints={illustrationRef}
              floatY={[0, -8, 0]}
              floatDuration={4.5}
              floatDelay={1.5}
              index={3}
              icon={
                <svg className="w-12 h-12 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              }
            />

            <AnimatedStatCard
              label="Total Members"
              value={12.8}
              suffix="K"
              colorClass="text-purple-400"
              bgClass="bg-purple-500/20"
              bottom="18%"
              left="5%"
              className=""
              dragConstraints={illustrationRef}
              floatY={[0, -10, 0]}
              floatDuration={7}
              floatDelay={0.8}
              index={4}
              icon={
                <svg className="w-12 h-12 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
            />

            <AnimatedStatCard
              label="Annual Returns"
              value={31.2}
              prefix="+"
              suffix="%"
              colorClass="text-brand"
              bgClass="bg-brand/30"
              bottom="28%"
              right="8%"
              className="!bg-gradient-to-br from-brand/20 to-emerald-500/10 border-brand/30"
              dragConstraints={illustrationRef}
              floatY={[0, -12, 0]}
              floatDuration={5}
              floatDelay={2}
              index={5}
              icon={
                <svg className="w-12 h-12 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              }
            />


            {/* Rising Bars - Larger and More Prominent */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-end gap-5 h-80">
              {[30, 50, 35, 70, 55, 85, 65, 95].map((h, i) => (
                <div
                  key={i}
                  className="w-10 rounded-t-2xl animate-bar-rise"
                  style={{
                    height: `${h}%`,
                    background: `linear-gradient(to top, rgba(191,243,0,${0.4 + i * 0.07}), rgba(191,243,0,${0.15 + i * 0.04}))`,
                    animationDelay: `${i * 100}ms`,
                    boxShadow: `0 0 25px rgba(191,243,0,${0.1 + i * 0.03})`
                  }}
                />
              ))}
            </div>

            {/* Curved Growth Line - Scaled Down Arrow/Line */}
            <div className="absolute inset-x-0 bottom-10 h-3/4 pointer-events-none scale-[0.85] origin-bottom">
              <svg className="w-full h-full" viewBox="0 0 500 500" fill="none" preserveAspectRatio="none">
                {/* Static background glow */}
                <path
                  d="M60 420 Q150 440 220 340 Q290 240 380 160 Q410 130 440 110"
                  stroke="rgba(191,243,0,0.15)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  fill="none"
                  className="blur-md"
                />
                {/* Main line */}
                <path
                  d="M60 420 Q150 440 220 340 Q290 240 380 160 Q410 130 440 110"
                  stroke="url(#lineGradient2)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  fill="none"
                  className="animate-draw-line"
                />
                {/* Moving glow effect along the path */}
                <path
                  d="M60 420 Q150 440 220 340 Q290 240 380 160 Q410 130 440 110"
                  stroke="url(#movingGlow)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  fill="none"
                  className="animate-glow-travel"
                />
                {/* Arrow head with glow */}
                <path
                  d="M425 100 L445 110 L435 130"
                  stroke="#BFF300"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blur-sm opacity-50"
                />
                <path
                  d="M425 100 L445 110 L435 130"
                  stroke="#BFF300"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="animate-fade-in-delayed"
                />
                {/* Arrow tip point */}
                <circle cx="445" cy="110" r="4" fill="#BFF300" className="animate-pulse" />

                <defs>
                  <linearGradient id="lineGradient2" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#BFF300" stopOpacity="0.2" />
                    <stop offset="50%" stopColor="#BFF300" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#BFF300" />
                  </linearGradient>
                  {/* Moving glow gradient */}
                  <linearGradient id="movingGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#BFF300" stopOpacity="0">
                      <animate attributeName="offset" values="0;0.7;1" dur="2s" repeatCount="indefinite" />
                    </stop>
                    <stop offset="15%" stopColor="#BFF300" stopOpacity="0.8">
                      <animate attributeName="offset" values="0.15;0.85;1" dur="2s" repeatCount="indefinite" />
                    </stop>
                    <stop offset="30%" stopColor="#BFF300" stopOpacity="0">
                      <animate attributeName="offset" values="0.3;1;1" dur="2s" repeatCount="indefinite" />
                    </stop>
                  </linearGradient>
                </defs>
              </svg>
            </div>

            {/* Sparkle dots */}
            <div className="absolute top-1/4 left-1/4 w-1.5 h-1.5 rounded-full bg-brand animate-twinkle" />
            <div className="absolute top-1/3 right-1/3 w-2 h-2 rounded-full bg-brand/80 animate-twinkle-delayed" />
            <div className="absolute bottom-1/4 right-1/4 w-1 h-1 rounded-full bg-white animate-twinkle" />
            <div className="absolute top-2/3 left-1/3 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-twinkle-delayed" />

            {/* Center Branding */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="relative">
                {/* Glow behind text */}
                <div className="absolute inset-0 bg-brand/20 blur-3xl rounded-full scale-150" />
                <h2 className="relative text-5xl font-black text-white tracking-tight">
                  Invest<span className="text-brand">Wise</span><span className="text-brand animate-pulse">.</span>
                </h2>
                <p className="relative text-gray-400 text-sm mt-3 font-medium tracking-widest uppercase">
                  Strategic Wealth Intelligence
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* Corner Decorations - Half-cut circles */}
        {/* Bottom Right - Large half circle */}
        <div className="absolute -bottom-32 -right-32 w-64 h-64 rounded-full bg-gradient-to-tl from-brand/20 via-brand/10 to-transparent" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 rounded-full bg-brand/10 blur-sm" />
        <div className="absolute bottom-4 right-4 w-3 h-3 rounded-full bg-brand/40 animate-pulse" />
        <div className="absolute bottom-8 right-12 w-2 h-2 rounded-full bg-brand/30" />
        <div className="absolute bottom-16 right-6 w-1.5 h-1.5 rounded-full bg-emerald-400/40" />

        {/* Top Left - Large half circle */}
        <div className="absolute -top-32 -left-32 w-64 h-64 rounded-full bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent" />
        <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full bg-emerald-500/10 blur-sm" />
        <div className="absolute top-4 left-4 w-3 h-3 rounded-full bg-emerald-400/40 animate-pulse" />
        <div className="absolute top-10 left-12 w-2 h-2 rounded-full bg-emerald-400/30" />
        <div className="absolute top-6 left-20 w-1.5 h-1.5 rounded-full bg-brand/40" />

        {/* Top Right - Small accent */}
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-cyan-500/10" />
      </div >

      {/* CSS Animations */}
      < style > {`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
        .animate-shake {
          animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(12deg); }
          50% { transform: translateY(-15px) rotate(12deg); }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0px) rotate(-12deg); }
          50% { transform: translateY(-20px) rotate(-12deg); }
        }
        .animate-float-delayed {
          animation: float-delayed 5s ease-in-out infinite;
          animation-delay: 1s;
        }
        @keyframes spin-slow {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 30s linear infinite;
        }
        @keyframes reverse-spin {
          from { transform: translate(-50%, -50%) rotate(360deg); }
          to { transform: translate(-50%, -50%) rotate(0deg); }
        }
        .animate-reverse-spin {
          animation: reverse-spin 25s linear infinite;
        }
        @keyframes rotate-slow {
          from { transform: rotate(45deg); }
          to { transform: rotate(405deg); }
        }
        .animate-rotate-slow {
          animation: rotate-slow 20s linear infinite;
        }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0) rotate(12deg); }
          50% { transform: translateY(-10px) rotate(12deg); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 3s ease-in-out infinite;
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
        @keyframes ping-slow {
          0% { transform: scale(1); opacity: 1; }
          75%, 100% { transform: scale(1.5); opacity: 0; }
        }
        .animate-ping-slow {
          animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes bar-rise {
          from { transform: scaleY(0); transform-origin: bottom; }
          to { transform: scaleY(1); transform-origin: bottom; }
        }
        .animate-bar-rise {
          animation: bar-rise 1s ease-out forwards;
        }
        @keyframes draw-line {
          from { stroke-dasharray: 1000; stroke-dashoffset: 1000; }
          to { stroke-dasharray: 1000; stroke-dashoffset: 0; }
        }
        .animate-draw-line {
          animation: draw-line 2s ease-out forwards;
        }
        @keyframes fade-in-delayed {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in-delayed {
          animation: fade-in-delayed 0.5s ease-out 1.5s forwards;
          opacity: 0;
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }
        .animate-twinkle {
          animation: twinkle 2s ease-in-out infinite;
        }
        .animate-twinkle-delayed {
          animation: twinkle 2.5s ease-in-out infinite;
          animation-delay: 0.5s;
        }
        @keyframes dash {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }
        .animate-dash {
          animation: dash 2s linear infinite;
        }
        @keyframes card-float-1 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
        .animate-card-float-1 {
          animation: card-float-1 4.5s ease-in-out infinite;
          animation-delay: 0.5s;
        }
        @keyframes card-float-2 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-18px); }
        }
        .animate-card-float-2 {
          animation: card-float-2 5.5s ease-in-out infinite;
          animation-delay: 1.5s;
        }
        @keyframes card-float-3 {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
        .animate-card-float-3 {
          animation: card-float-3 6s ease-in-out infinite;
          animation-delay: 2s;
        }
      `}</style >
    </div >
  );
};

export default Login;
