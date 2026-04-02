import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Play, Shield, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

const Hero: React.FC = () => {
    return (
        <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
            {/* Background Orbs */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand/10 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 rounded-full blur-[100px] animate-pulse" />
            </div>

            <div className="max-w-7xl mx-auto px-6 relative z-10">
                <div className="flex flex-col lg:flex-row items-center gap-16">
                    {/* Content */}
                    <div className="flex-1 text-center lg:text-left">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6 }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 mb-8"
                        >
                            <span className="flex h-2 w-2 rounded-full bg-brand animate-ping" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                                Enterprise Wealth Intelligence v2.0
                            </span>
                        </motion.div>

                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.1 }}
                            className="text-5xl lg:text-7xl xl:text-8xl font-black text-dark dark:text-white tracking-tighter leading-[0.9] mb-8"
                        >
                            Stop Tracking. <br />
                            <span className="text-brand">Start Scaling.</span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                            className="text-lg lg:text-xl text-gray-500 dark:text-gray-400 font-medium max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed"
                        >
                            Upgrade from fragile spreadsheets to an immutable enterprise-grade investment powerhouse.
                            Manage partners, projects, and millions in capital with 100% precision.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.3 }}
                            className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4"
                        >
                            <Link
                                to="/login"
                                className="w-full sm:w-auto px-8 py-5 bg-dark dark:bg-brand text-white dark:text-dark rounded-2xl font-black text-lg shadow-2xl shadow-brand/20 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3"
                            >
                                Get Enterprise Access <ArrowRight size={20} strokeWidth={3} />
                            </Link>
                            <button className="w-full sm:w-auto px-8 py-5 bg-white dark:bg-white/5 text-dark dark:text-white border border-gray-200 dark:border-white/10 rounded-2xl font-black text-lg hover:bg-gray-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center">
                                    <Play size={14} fill="currentColor" className="text-brand ml-0.5" />
                                </div>
                                Watch Demo
                            </button>
                        </motion.div>

                        {/* Trust Badges */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 1, delay: 0.6 }}
                            className="mt-16 pt-8 border-t border-gray-100 dark:border-white/5 flex flex-wrap justify-center lg:justify-start gap-8"
                        >
                            <div className="flex items-center gap-2 text-gray-400">
                                <Shield size={18} className="text-brand" />
                                <span className="text-xs font-black uppercase tracking-widest">Bank-Grade Security</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-400">
                                <TrendingUp size={18} className="text-emerald-500" />
                                <span className="text-xs font-black uppercase tracking-widest">31.2% Avg. Returns</span>
                            </div>
                        </motion.div>
                    </div>

                    {/* Asset Preview */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        transition={{ duration: 1, delay: 0.4 }}
                        className="flex-1 relative"
                    >
                        <div className="relative z-10 bg-white dark:bg-[#0A0F0C] p-4 rounded-[40px] border border-gray-200 dark:border-white/10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.3)] dark:shadow-none overflow-hidden">
                            <div className="aspect-[4/3] bg-[#121814] rounded-[32px] overflow-hidden relative">
                                {/* Mock UI Elements */}
                                <div className="p-8 h-full flex flex-col">
                                    <div className="flex justify-between items-center mb-12">
                                        <div className="h-4 w-32 bg-white/5 rounded-full" />
                                        <div className="h-10 w-10 bg-brand/20 rounded-xl" />
                                    </div>
                                    <div className="flex-1 flex gap-4 items-end">
                                        {[40, 70, 45, 90, 65, 80, 55, 95].map((h, i) => (
                                            <motion.div
                                                key={i}
                                                initial={{ height: 0 }}
                                                animate={{ height: `${h}%` }}
                                                transition={{ duration: 1, delay: 1 + (i * 0.1) }}
                                                className="flex-1 bg-gradient-to-t from-brand/40 to-brand/10 rounded-t-xl"
                                            />
                                        ))}
                                    </div>
                                    <div className="mt-8 flex justify-between items-end">
                                        <div>
                                            <div className="h-3 w-20 bg-white/5 rounded-full mb-2" />
                                            <div className="h-8 w-40 bg-brand/20 rounded-lg" />
                                        </div>
                                        <div className="h-12 w-12 bg-white/5 rounded-full" />
                                    </div>
                                </div>
                                {/* Glass overlay */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[60%] bg-white/5 backdrop-blur-3xl rounded-3xl border border-white/10 shadow-2xl z-20 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="text-brand font-black text-4xl mb-2">৳847.2M</div>
                                        <div className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Total Assets Managed</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Decorative Elements */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-brand/20 rounded-full blur-3xl animate-bounce-slow" />
                        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl animate-float" />
                    </motion.div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
