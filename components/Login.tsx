import React, { useState } from 'react';
import { Shield, Lock, User, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { User as UserType } from '../types';
import { Language, t } from '../i18n/translations';
import { authService } from '../services/api';
import Toast, { ToastType } from './Toast';

interface LoginProps {
  onLogin: (user: UserType) => void;
  lang: Language;
}

const Login: React.FC<LoginProps> = ({ onLogin, lang }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success'
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
    if (type !== 'error') {
      setTimeout(() => setToast(prev => ({ ...prev, isVisible: false })), 3000);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) {
      showNotification("Please enter both email and password.", "warning");
      return;
    }

    setIsLoading(true);

    try {
      const data = await authService.login(identifier, password);
      // Data contains token and user profile
      showNotification(`Welcome back, ${data.name}!`, 'success');

      // Allow toast to show briefly before navigation
      setTimeout(() => {
        onLogin(data); // This triggers App to navigate
      }, 800);

    } catch (err: any) {
      console.error(err);
      const errorMessage = err.response?.data?.message || err.message || 'Authentication failed. Access denied.';
      showNotification(errorMessage, 'error');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-dark p-6 overflow-hidden relative">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      {/* Background Decorative Elements */}
      <div className="absolute top-0 right-0 p-80 bg-brand/5 rounded-full -mr-40 -mt-40 blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-0 left-0 p-80 bg-brand/5 rounded-full -ml-40 -mb-40 blur-[120px] animate-pulse delay-700"></div>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="bg-[#1A221D] p-12 rounded-[4rem] border border-white/5 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)]">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-brand rounded-[2rem] shadow-2xl shadow-brand/20 mb-8 animate-bounce-slow">
              <Shield className="text-dark" size={36} strokeWidth={3} />
            </div>
            <h1 className="text-4xl font-black text-white uppercase tracking-tighter leading-none mb-3">InvestWise<span className="text-brand">.</span></h1>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.5em]">{t('auth.terminal', lang)}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/30 uppercase tracking-widest px-2">{t('auth.identifier', lang)}</label>
              <div className="relative group">
                <input
                  required
                  type="email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full bg-white/5 border border-white/5 px-8 py-5 rounded-3xl text-sm font-bold text-white outline-none focus:ring-2 focus:ring-brand focus:bg-white/10 transition-all placeholder:text-white/10"
                />
                <User className="absolute right-6 top-1/2 -translate-y-1/2 text-white/10 group-focus-within:text-brand transition-colors" size={18} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/30 uppercase tracking-widest px-2">{t('auth.passphrase', lang)}</label>
              <div className="relative group">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/5 px-8 py-5 rounded-3xl text-sm font-bold text-white outline-none focus:ring-2 focus:ring-brand focus:bg-white/10 transition-all placeholder:text-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-white/10 hover:text-brand transition-colors outline-none"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              disabled={isLoading}
              type="submit"
              className="w-full bg-brand text-dark py-6 rounded-[2.5rem] font-black text-sm uppercase tracking-widest shadow-2xl shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>{t('auth.authorize', lang)} <ArrowRight size={18} strokeWidth={3} /></>
              )}
            </button>
          </form>

          <div className="mt-10 text-center">
            <button type="button" className="text-[10px] font-black text-white/20 uppercase tracking-widest hover:text-brand transition-colors">{t('auth.recover', lang)}</button>
          </div>
        </div>

        <p className="mt-12 text-center text-[10px] font-black text-white/20 uppercase tracking-[0.4em]">{t('auth.version', lang)}</p>
      </div>
    </div>
  );
};

export default Login;
