import React from 'react';
import { SearchX, LayoutDashboard, Compass, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const NotFound: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="relative flex flex-col items-center justify-center min-h-[85vh] text-center p-8 overflow-hidden">
            {/* Giant Background Watermark */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[24rem] font-black text-gray-200/20 dark:text-white/[0.02] leading-none select-none -z-10 tracking-tighter">
                404
            </div>

            {/* Background Decorative Elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand/5 dark:bg-brand/10 rounded-full blur-[120px] -z-10 animate-pulse"></div>
            <div className="absolute top-1/3 left-2/3 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl -z-10"></div>

            {/* Central Iconography */}
            <div className="relative mb-12 animate-in slide-in-from-bottom-8 duration-700">
                <div className="absolute inset-0 bg-brand/20 blur-[40px] rounded-full scale-150 animate-pulse"></div>
                <div className="relative w-32 h-32 bg-white dark:bg-[#1A221D] rounded-[3rem] shadow-2xl flex items-center justify-center border border-brand/20 dark:border-brand/30">
                    <div className="absolute inset-0 bg-gradient-to-br from-brand/10 to-transparent rounded-[3rem]"></div>
                    <SearchX size={56} className="text-brand relative z-10" strokeWidth={1.5} />

                    {/* Floating compass accent */}
                    <div className="absolute -top-2 -left-2 w-12 h-12 bg-dark dark:bg-brand rounded-2xl flex items-center justify-center shadow-xl border-4 border-[#F8FAFC] dark:border-[#111814] animate-spin duration-[10000ms]">
                        <Compass size={18} className="text-white dark:text-dark font-bold" />
                    </div>
                </div>
            </div>

            {/* Content Container */}
            <div className="max-w-xl space-y-6 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
                <div className="space-y-2">
                    <p className="text-[11px] font-black text-brand uppercase tracking-[0.3em]">Resource Error 404</p>
                    <h1 className="text-6xl md:text-7xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">
                        Path <span className="text-brand">Vanished</span>
                    </h1>
                </div>

                <div className="h-px w-24 bg-gradient-to-r from-transparent via-gray-200 dark:via-white/10 to-transparent mx-auto"></div>

                <p className="text-gray-500 dark:text-gray-400 font-medium text-lg leading-relaxed max-w-md mx-auto">
                    The intelligence node you are searching for is outside the current index.
                    <span className="block mt-2 text-sm font-bold opacity-60 uppercase tracking-widest text-dark dark:text-white">Registry: Resource_Not_Found_Exception</span>
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-5 pt-8">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full sm:w-auto px-10 py-5 bg-dark dark:bg-brand text-white dark:text-dark rounded-[2.5rem] font-black text-[11px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-brand/20"
                    >
                        <LayoutDashboard size={18} />
                        Return to Terminal
                    </button>

                    <button
                        onClick={() => window.location.reload()}
                        className="group w-full sm:w-auto px-10 py-5 bg-white dark:bg-white/5 text-dark dark:text-white rounded-[2.5rem] font-black text-[11px] uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-3 border border-gray-100 dark:border-white/5 shadow-xl"
                    >
                        Re-Scan Path
                    </button>
                </div>
            </div>

            {/* Bottom Info */}
            <div className="absolute bottom-12 flex items-center gap-3 opacity-30 animate-in fade-in duration-1000 delay-700">
                <HelpCircle size={14} />
                <p className="text-[9px] font-black uppercase tracking-widest text-dark dark:text-white">
                    System Intelligence Indexing v2.4.0
                </p>
            </div>
        </div>
    );
};

export default NotFound;
