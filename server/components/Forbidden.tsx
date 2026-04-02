import React from 'react';
import { ShieldOff, ArrowLeft, LayoutDashboard, Lock, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Forbidden: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="relative flex flex-col items-center justify-center min-h-[85vh] text-center p-8 overflow-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-rose-500/5 dark:bg-rose-500/10 rounded-full blur-[120px] -z-10 animate-pulse"></div>
            <div className="absolute top-1/4 left-1/3 w-32 h-32 bg-brand/5 rounded-full blur-3xl -z-10"></div>

            {/* Central Iconography */}
            <div className="relative mb-12 animate-in slide-in-from-bottom-8 duration-700">
                <div className="absolute inset-0 bg-rose-500/20 blur-[40px] rounded-full scale-150 animate-pulse"></div>
                <div className="relative w-32 h-32 bg-white dark:bg-[#1A221D] rounded-[3rem] shadow-2xl flex items-center justify-center border border-rose-500/20 dark:border-rose-500/30">
                    <div className="absolute inset-0 bg-gradient-to-br from-rose-500/10 to-transparent rounded-[3rem]"></div>
                    <ShieldOff size={56} className="text-rose-500 relative z-10" strokeWidth={1.5} />

                    {/* Small accent lock icon */}
                    <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-dark dark:bg-rose-500 rounded-2xl flex items-center justify-center shadow-xl border-4 border-[#F8FAFC] dark:border-[#111814] animate-bounce duration-[2000ms]">
                        <Lock size={18} className="text-white dark:text-dark font-bold" />
                    </div>
                </div>
            </div>

            {/* Content Container */}
            <div className="max-w-xl space-y-6 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
                <div className="space-y-2">
                    <p className="text-[11px] font-black text-rose-500 uppercase tracking-[0.3em]">Protocol Violation 403</p>
                    <h1 className="text-6xl md:text-7xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">
                        Access <span className="text-rose-500">Restricted</span>
                    </h1>
                </div>

                <div className="h-px w-24 bg-gradient-to-r from-transparent via-gray-200 dark:via-white/10 to-transparent mx-auto"></div>

                <p className="text-gray-500 dark:text-gray-400 font-medium text-lg leading-relaxed max-w-md mx-auto">
                    Your current authorization tier does not permit access to this sector.
                    <span className="block mt-2 text-sm font-bold opacity-60 uppercase tracking-widest text-dark dark:text-white">Security Ledger: Permission_Denied_Exception</span>
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-5 pt-8">
                    <button
                        onClick={() => navigate(-1)}
                        className="group w-full sm:w-auto px-10 py-5 bg-white dark:bg-white/5 text-dark dark:text-white rounded-[2.5rem] font-black text-[11px] uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-3 border border-gray-100 dark:border-white/5 shadow-xl"
                    >
                        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                        Go Back
                    </button>

                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full sm:w-auto px-10 py-5 bg-dark dark:bg-brand text-white dark:text-dark rounded-[2.5rem] font-black text-[11px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-brand/20"
                    >
                        <LayoutDashboard size={18} />
                        Security Terminal
                    </button>
                </div>
            </div>

            {/* Bottom Info */}
            <div className="absolute bottom-12 flex items-center gap-3 opacity-30 animate-in fade-in duration-1000 delay-700">
                <ShieldAlert size={14} />
                <p className="text-[9px] font-black uppercase tracking-widest text-dark dark:text-white">
                    End-to-End Enterprise Encryption Active
                </p>
            </div>
        </div>
    );
};

export default Forbidden;
