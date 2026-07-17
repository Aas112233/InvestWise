import React, { useRef } from 'react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const steps = [
  {
    num: '01',
    title: 'Create Your Portfolio',
    desc: 'Add your investment projects — real estate, tech ventures, commodities. Each gets its own tracking space with partner allocations.',
    visual: (
      <div className="space-y-3">
        {['Dhanmondi Complex', 'Gulshan Tech Hub', 'Banani Residences'].map((name, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 + i * 0.1 }}
            whileHover={{ x: 6, scale: 1.01 }}
            className="flex items-center gap-3 p-3.5 bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] cursor-pointer transition-shadow hover:shadow-md"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-bold ${['bg-brand', 'bg-emerald-500', 'bg-amber-500'][i]}`}>
              {name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-dark dark:text-white truncate">{name}</div>
              <div className="text-[10px] text-gray-400 font-medium">{['Active', 'Funding', 'Completed'][i]}</div>
            </div>
            <div className="text-[12px] font-bold text-dark dark:text-white">{['৳42M', '৳28M', '৳15M'][i]}</div>
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    num: '02',
    title: 'Invite Partners & Set Splits',
    desc: 'Add co-investors, define ownership percentages, and configure who sees what. Permissions scale from 2 people to 200.',
    visual: (
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: 'Rahim', pct: '40%', color: 'bg-brand' },
          { name: 'Karim', pct: '35%', color: 'bg-emerald-500' },
          { name: 'Fatima', pct: '15%', color: 'bg-amber-500' },
          { name: 'Nadia', pct: '10%', color: 'bg-violet-500' },
        ].map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 300 }}
            whileHover={{ y: -4, scale: 1.04 }}
            className="p-3.5 bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] text-center cursor-pointer transition-shadow hover:shadow-lg"
          >
            <div className={`w-11 h-11 mx-auto rounded-full ${p.color} flex items-center justify-center text-white text-[13px] font-bold mb-2 shadow-lg`}>
              {p.name.charAt(0)}
            </div>
            <div className="text-[12px] font-bold text-dark dark:text-white">{p.name}</div>
            <div className="text-[18px] font-extrabold text-dark dark:text-white mt-1">{p.pct}</div>
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    num: '03',
    title: 'Track, Auto-Calculate, Report',
    desc: 'Deposits flow in, dividends calculate automatically, reports generate themselves. Your entire investment lifecycle — on autopilot.',
    visual: (
      <div className="space-y-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="p-3.5 bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06]"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Auto-Dividend Run</span>
            <motion.span
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.6, type: 'spring' }}
              className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"
            >
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Completed
            </motion.span>
          </div>
          <div className="text-[13px] font-bold text-dark dark:text-white">৳12.4M distributed to 4 partners</div>
        </motion.div>
        <div className="grid grid-cols-2 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            whileHover={{ y: -2 }}
            className="p-3.5 bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] cursor-pointer"
          >
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Payout</div>
            <div className="text-[16px] font-extrabold text-dark dark:text-white">৳84.7M</div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 }}
            whileHover={{ y: -2 }}
            className="p-3.5 bg-white dark:bg-white/[0.04] rounded-xl border border-gray-100 dark:border-white/[0.06] cursor-pointer"
          >
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Avg. Return</div>
            <div className="text-[16px] font-extrabold text-emerald-500">+31.2%</div>
          </motion.div>
        </div>
      </div>
    ),
  },
];

const HowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 bg-[#fafbfc] dark:bg-[#040810] relative overflow-hidden">
      {/* Subtle background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand/[0.02] rounded-full blur-[200px] pointer-events-none" />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 relative z-10">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16 lg:mb-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand mb-4"
          >
            How It Works
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ delay: 0.05, duration: 0.7 }}
            className="text-[clamp(2rem,4vw,3.5rem)] font-extrabold text-dark dark:text-white tracking-[-0.03em] leading-[1.05] mb-5"
          >
            Three steps to
            <br />
            financial clarity.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-gray-500 dark:text-gray-400 text-[17px] leading-[1.7] font-medium"
          >
            No onboarding calls. No consultants. Just sign up, set up, and start
            managing your investments like the enterprise you are.
          </motion.p>
        </div>

        {/* Steps */}
        <div className="space-y-12 lg:space-y-20">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className={`grid lg:grid-cols-2 gap-8 lg:gap-16 items-center ${
                i % 2 === 1 ? 'lg:[direction:rtl]' : ''
              }`}
            >
              {/* Text */}
              <div className={i % 2 === 1 ? 'lg:[direction:ltr]' : ''}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                  className="text-[56px] lg:text-[72px] font-extrabold text-gray-100 dark:text-white/[0.03] tracking-[-0.04em] leading-none mb-4 select-none"
                >
                  {step.num}
                </motion.div>
                <motion.h3
                  initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15, duration: 0.6 }}
                  className="text-[clamp(1.5rem,2.5vw,2rem)] font-extrabold text-dark dark:text-white tracking-[-0.02em] mb-4"
                >
                  {step.title}
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2, duration: 0.6 }}
                  className="text-gray-500 dark:text-gray-400 text-[16px] leading-[1.7] font-medium max-w-md"
                >
                  {step.desc}
                </motion.p>
              </div>

              {/* Visual */}
              <motion.div
                initial={{ opacity: 0, x: i % 2 === 0 ? 30 : -30, rotateY: i % 2 === 0 ? 5 : -5 }}
                whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className={`${i % 2 === 1 ? 'lg:[direction:ltr]' : ''} p-5 bg-gray-50 dark:bg-white/[0.02] rounded-2xl border border-gray-100 dark:border-white/[0.05] hover:border-gray-200 dark:hover:border-white/[0.1] transition-colors duration-500`}
              >
                {step.visual}
              </motion.div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-20 lg:mt-28 text-center"
        >
          <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} className="inline-block">
            <Link
              to="/login"
              className="mag-btn ripple group inline-flex items-center gap-2 px-8 py-4 bg-dark dark:bg-white text-white dark:text-dark text-[15px] font-bold rounded-2xl"
            >
              Try It Free — No Credit Card
              <ArrowUpRight
                size={16}
                strokeWidth={2.5}
                className="opacity-50 group-hover:opacity-100 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] transition-all duration-300"
              />
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default HowItWorks;
