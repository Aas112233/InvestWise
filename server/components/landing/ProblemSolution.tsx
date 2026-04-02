import React from 'react';
import { motion } from 'framer-motion';
import { XCircle, CheckCircle2, AlertTriangle, Zap, ShieldCheck, BarChart3 } from 'lucide-react';

const Comparison: React.FC = () => {
    const problems = [
        {
            title: "Fragile Formulas",
            desc: "One wrong cell entry breaks your entire 5-year ROI calculation. Zero room for error.",
            icon: <XCircle className="text-rose-500" size={24} />
        },
        {
            title: "Visibility Blindness",
            desc: "Hunting through endless tabs to find out who owns what is a waste of your time.",
            icon: <AlertTriangle className="text-amber-500" size={24} />
        },
        {
            title: "Security Risk",
            desc: "Spreadsheets are easily copied or leaked. Your enterprise data deserves a vault.",
            icon: <ShieldCheck className="text-gray-400" size={24} />
        }
    ];

    const solutions = [
        {
            title: "Immutable Ledger",
            desc: "Every transaction is locked and audit-ready. Logic is hard-coded, errors are impossible.",
            icon: <Zap className="text-brand" size={24} />
        },
        {
            title: "Instant Transparency",
            desc: "Real-time stakeholder maps. See exactly which partner holds which share in one click.",
            icon: <BarChart3 className="text-brand" size={24} />
        },
        {
            title: "Enterprise Encryption",
            desc: "Role-based access controls ensure that only authorized eyes see your capital movements.",
            icon: <CheckCircle2 className="text-brand" size={24} />
        }
    ];

    return (
        <section id="solutions" className="py-24 bg-gray-50 dark:bg-[#080C0A] relative overflow-hidden">
            <div className="max-w-7xl mx-auto px-6 relative z-10">
                <div className="text-center mb-20">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-4xl lg:text-6xl font-black text-dark dark:text-white tracking-tighter mb-6"
                    >
                        The Great <span className="text-brand">Migration</span>
                    </motion.h2>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1 }}
                        className="text-gray-500 dark:text-gray-400 font-medium max-w-2xl mx-auto text-lg"
                    >
                        Why elite firms are ditching "boring" spreadsheets for a precision intelligence engine.
                    </motion.p>
                </div>

                <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-center">
                    {/* Problem Column */}
                    <div className="space-y-8">
                        <div className="flex items-center gap-3 mb-10">
                            <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center">
                                <XCircle className="text-rose-500" size={24} />
                            </div>
                            <h3 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter">The Excel Nightmare</h3>
                        </div>
                        {problems.map((p, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="p-6 rounded-3xl bg-white dark:bg-white/2 border border-rose-500/10 hover:shadow-xl transition-all"
                            >
                                <div className="flex gap-4">
                                    <div className="mt-1">{p.icon}</div>
                                    <div>
                                        <h4 className="font-black text-dark dark:text-white mb-2">{p.title}</h4>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm font-medium leading-relaxed">{p.desc}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>

                    {/* Solution Column */}
                    <div className="space-y-8 relative">
                        <div className="absolute inset-0 bg-brand/5 blur-[100px] -z-10" />
                        <div className="flex items-center gap-3 mb-10">
                            <div className="w-12 h-12 bg-brand/10 rounded-2xl flex items-center justify-center">
                                <Zap className="text-brand" size={24} />
                            </div>
                            <h3 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter">The InvestWise Advantage</h3>
                        </div>
                        {solutions.map((s, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="p-6 rounded-3xl bg-white dark:bg-brand/5 border border-brand/20 hover:shadow-xl hover:shadow-brand/5 transition-all"
                            >
                                <div className="flex gap-4">
                                    <div className="mt-1">{s.icon}</div>
                                    <div>
                                        <h4 className="font-black text-dark dark:text-white mb-2">{s.title}</h4>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm font-medium leading-relaxed">{s.desc}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Comparison;
