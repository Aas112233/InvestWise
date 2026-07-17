import React, { useRef, useEffect, useState } from 'react';
import { motion, useInView } from 'framer-motion';

/* Animated counter */
const Counter = ({ value, suffix = '' }: { value: string; suffix?: string }) => {
  return (
    <span className="font-extrabold text-dark dark:text-white tracking-tight">
      {value}{suffix}
    </span>
  );
};

const pillars = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'AES-256 Encryption',
    desc: 'Every byte of your financial data is encrypted at rest and in transit. The same standard used by central banks.',
    color: '#2563EB',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Zero-Trust Architecture',
    desc: 'No implicit trust. Every request is verified, every session is scoped, every action is logged.',
    color: '#8b5cf6',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    title: 'Immutable Audit Trail',
    desc: 'Every transaction, every edit, every view — timestamped and tamper-proof. Full accountability, zero gaps.',
    color: '#10b981',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Granular Permissions',
    desc: 'Partners see their share. Admins see everything. Board members get read-only. No one sees what they shouldn\'t.',
    color: '#f59e0b',
  },
];

const SecuritySection: React.FC = () => {
  return (
    <section id="security" className="py-24 lg:py-32 bg-white dark:bg-[#060a14] relative overflow-hidden">
      {/* Subtle background accent */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand/[0.02] rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-16 lg:gap-20 items-start">
          {/* Left: Copy + Stats */}
          <div className="lg:sticky lg:top-32">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand mb-4"
            >
              Security
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
              whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              viewport={{ once: true }}
              transition={{ delay: 0.05, duration: 0.7 }}
              className="text-[clamp(2rem,4vw,3.5rem)] font-extrabold text-dark dark:text-white tracking-[-0.03em] leading-[1.05] mb-5"
            >
              Your data is<br />
              not a suggestion.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-gray-500 dark:text-gray-400 text-[17px] leading-[1.7] font-medium max-w-md mb-10"
            >
              We treat your financial data like a bank treats vault gold —
              encrypted, audited, and behind layers of access control that
              make penetration tests boring.
            </motion.p>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: '99.99%', label: 'Uptime SLA', color: 'text-emerald-500' },
                { value: '0', label: 'Data Breaches', color: 'text-dark dark:text-white' },
                { value: 'SOC 2', label: 'Compliance', color: 'text-brand' },
                { value: '<50ms', label: 'API Latency', color: 'text-dark dark:text-white' },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + i * 0.06 }}
                  whileHover={{ y: -3, scale: 1.02 }}
                  className="p-4 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] cursor-pointer transition-shadow hover:shadow-lg"
                >
                  <div className={`text-[22px] ${stat.color} tracking-tight`}>
                    <Counter value={stat.value} />
                  </div>
                  <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-1">
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Right: Security pillars */}
          <div className="space-y-4">
            {pillars.map((p, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ x: 6 }}
                className="group relative p-6 rounded-2xl bg-gray-50/80 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.05] hover:border-gray-200 dark:hover:border-white/[0.12] hover:bg-white dark:hover:bg-white/[0.04] transition-all duration-500 cursor-default overflow-hidden"
              >
                {/* Accent glow on hover */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: `radial-gradient(300px circle at 20% 50%, ${p.color}08, transparent 70%)`,
                  }}
                />

                <div className="flex gap-5 relative z-10">
                  <motion.div
                    whileHover={{ rotate: -8, scale: 1.1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    className="w-12 h-12 rounded-xl bg-white dark:bg-white/[0.06] border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-dark dark:text-white shrink-0"
                  >
                    {p.icon}
                  </motion.div>
                  <div>
                    <h3 className="text-[16px] font-extrabold text-dark dark:text-white tracking-[-0.01em] mb-1.5">
                      {p.title}
                    </h3>
                    <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-[1.65] font-medium">
                      {p.desc}
                    </p>
                  </div>
                </div>

                {/* Left accent bar on hover */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: p.color }}
                />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SecuritySection;
