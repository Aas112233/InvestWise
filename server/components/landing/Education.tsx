import React from 'react';
import { motion } from 'framer-motion';
import { PieChart, Repeat, Globe, Wallet } from 'lucide-react';

const Education: React.FC = () => {
    const strategies = [
        {
            title: "The 70/30 Allocation",
            desc: "Move 30% of enterprise reserves into high-yield ventures while maintaining 70% liquidity. Our app tracks this ratio in real-time.",
            icon: <PieChart size={24} className="text-brand" />,
            tag: "STRATEGY"
        },
        {
            title: "Compound Re-investment",
            desc: "Roll your dividends back into new projects automatically. Watch your capital accelerate through consistent venture re-allocation.",
            icon: <Repeat size={24} className="text-emerald-400" />,
            tag: "GROWTH"
        },
        {
            title: "Risk Diversification",
            desc: "Split funds across different sectors (Real Estate, Tech, Commodities). Monitor your exposure with our Project Categories.",
            icon: <Globe size={24} className="text-cyan-400" />,
            tag: "SECURITY"
        },
        {
            title: "Automated Reserve",
            desc: "Set aside a percentage of every payout for tax or emergency funds before distribution happens. Total financial peace of mind.",
            icon: <Wallet size={24} className="text-amber-400" />,
            tag: "FINANCE"
        }
    ];

    return (
        <section id="trust" className="py-24 bg-white dark:bg-[#0A0F0C]">
            <div className="max-w-7xl mx-auto px-6">
                <div className="flex flex-col lg:flex-row items-end justify-between mb-16 gap-8">
                    <div className="max-w-2xl">
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="text-4xl lg:text-6xl font-black text-dark dark:text-white tracking-tighter mb-6 leading-[0.9]"
                        >
                            The Wealth <br />
                            <span className="text-brand">Accelerator Engine.</span>
                        </motion.h2>
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.1 }}
                            className="text-gray-500 dark:text-gray-400 font-medium text-lg leading-relaxed"
                        >
                            We don't just provide software; we provide the blueprint for enterprise growth.
                            Learn the strategies used by the top 1% of investment managers.
                        </motion.p>
                    </div>
                    <div className="hidden lg:block">
                        <div className="px-6 py-3 border border-brand/30 rounded-full text-brand font-black text-xs tracking-widest uppercase">
                            Free Investment Guide Included
                        </div>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {strategies.map((s, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            whileHover={{ y: -10 }}
                            className="p-8 rounded-[32px] bg-gray-50 dark:bg-white/2 border border-gray-100 dark:border-white/5 flex flex-col h-full group"
                        >
                            <div className="mb-8 w-14 h-14 rounded-2xl bg-white dark:bg-white/5 shadow-sm flex items-center justify-center group-hover:bg-brand/20 transition-colors">
                                {s.icon}
                            </div>
                            <span className="text-[10px] font-black tracking-widest text-brand mb-3 uppercase">
                                {s.tag}
                            </span>
                            <h3 className="text-xl font-black text-dark dark:text-white mb-4 leading-tight">
                                {s.title}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium leading-relaxed flex-1">
                                {s.desc}
                            </p>
                        </motion.div>
                    ))}
                </div>

                {/* Action Card */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    className="mt-20 p-12 rounded-[40px] bg-dark relative overflow-hidden flex flex-col lg:flex-row items-center justify-between gap-10"
                >
                    <div className="absolute top-0 right-0 w-1/2 h-full bg-brand/5 blur-[120px] -z-0" />
                    <div className="relative z-10 max-w-xl">
                        <h3 className="text-3xl lg:text-4xl font-black text-white tracking-tighter mb-4">
                            Ready to automate your <span className="text-brand">wealth journey?</span>
                        </h3>
                        <p className="text-gray-400 font-medium">
                            Join 12,000+ investors who replaced spreadsheets with InvestWise.
                        </p>
                    </div>
                    <div className="relative z-10 w-full lg:w-auto">
                        <button className="w-full lg:w-auto px-10 py-5 bg-brand text-dark font-black rounded-2xl hover:scale-105 active:scale-95 transition-all">
                            START YOUR PORTFOLIO NOW
                        </button>
                    </div>
                </motion.div>
            </div>
        </section>
    );
};

export default Education;
