import React, { useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M4 7h16M4 12h10M4 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="19" cy="17" r="3" stroke="currentColor" strokeWidth="2" />
        <path d="M19 15v4M17 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Immutable Ledger',
    desc: 'Every entry is locked the moment it\'s recorded. Edit history lives on — auditors love us, fraudsters hate us.',
    tag: 'Precision',
    tagColor: 'text-brand bg-brand/[0.08]',
    accent: '#2563EB',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    title: 'Project Intelligence',
    desc: 'Visual dashboards per project. Know exactly how much each venture has earned, spent, and owes — in real time.',
    tag: 'Visibility',
    tagColor: 'text-emerald-600 bg-emerald-500/[0.08]',
    accent: '#10b981',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Role-Based Vault',
    desc: 'Partners see their slice. Admins see everything. Sensitive financials stay behind granular, enterprise-grade access walls.',
    tag: 'Security',
    tagColor: 'text-violet-600 bg-violet-500/[0.08]',
    accent: '#8b5cf6',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    title: 'Auto Dividends',
    desc: 'Set it once, collect forever. Dividend splits run automatically based on ownership percentages — no manual math needed.',
    tag: 'Automation',
    tagColor: 'text-amber-600 bg-amber-500/[0.08]',
    accent: '#f59e0b',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" />
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Deposit Tracking',
    desc: 'Track who paid, when, and how much — with proof. Payment requests, reminders, and reconciliation in one place.',
    tag: 'Finance',
    tagColor: 'text-rose-600 bg-rose-500/[0.08]',
    accent: '#f43f5e',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zM4 22v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Multi-Partner Scale',
    desc: 'From 2 co-founders to 200 stakeholders. Ownership splits, profit sharing, and voting — built to grow with you.',
    tag: 'Scale',
    tagColor: 'text-cyan-600 bg-cyan-500/[0.08]',
    accent: '#06b6d4',
  },
];

/* Tilt card component */
const TiltCard = ({ children, index }: { children: React.ReactNode; index: number }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: y * -8, y: x * 8 });
  };

  const handleMouseLeave = () => setTilt({ x: 0, y: 0 });

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ delay: index * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transformStyle: 'preserve-3d',
      }}
      className="group relative p-7 rounded-2xl bg-gray-50/80 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.05] hover:border-gray-200 dark:hover:border-white/[0.12] hover:bg-white dark:hover:bg-white/[0.04] transition-all duration-500 cursor-default"
    >
      {/* Hover glow */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(400px circle at 50% 50%, ${features[index].accent}08, transparent 70%)`,
        }}
      />
      {children}
    </motion.div>
  );
};

const Features: React.FC = () => {
  return (
    <section id="features" className="py-24 lg:py-32 bg-white dark:bg-[#060a14] relative">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* Section header */}
        <div className="max-w-2xl mb-16 lg:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand mb-4"
          >
            Why InvestWise
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ delay: 0.05, duration: 0.7 }}
            className="text-[clamp(2rem,4vw,3.5rem)] font-extrabold text-dark dark:text-white tracking-[-0.03em] leading-[1.05] mb-5"
          >
            Six reasons to
            <br />
            ditch your spreadsheet.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-gray-500 dark:text-gray-400 text-[17px] leading-[1.7] font-medium"
          >
            Built for investment groups managing real capital. Every feature exists
            because a real partner needed it.
          </motion.p>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <TiltCard key={i} index={i}>
              {/* Icon */}
              <motion.div
                whileHover={{ rotate: -5, scale: 1.1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                className="w-12 h-12 rounded-xl bg-white dark:bg-white/[0.06] border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-dark dark:text-white mb-5 relative z-10"
              >
                {f.icon}
              </motion.div>

              {/* Tag */}
              <span className={`inline-block text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-1 rounded-md mb-3 relative z-10 ${f.tagColor}`}>
                {f.tag}
              </span>

              {/* Content */}
              <h3 className="text-[17px] font-extrabold text-dark dark:text-white tracking-[-0.01em] mb-2 relative z-10">
                {f.title}
              </h3>
              <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-[1.65] font-medium relative z-10">
                {f.desc}
              </p>

              {/* Bottom accent line on hover */}
              <div
                className="absolute bottom-0 left-6 right-6 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: f.accent }}
              />
            </TiltCard>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
