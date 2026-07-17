import React, { useRef, useEffect, useState } from 'react';
import { motion, useScroll, useTransform, useSpring, useInView } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/* Animated counter component */
const AnimatedNumber = ({ value, suffix = '', prefix = '' }: { value: number; suffix?: string; prefix?: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    let start = 0;
    const end = value;
    const duration = 1800;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.floor(eased * end));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [isInView, value]);

  return <span ref={ref}>{prefix}{display.toLocaleString()}{suffix}</span>;
};

/* Floating particle */
const Particle = ({ delay, x, y, size }: { delay: number; x: string; y: string; size: number }) => (
  <motion.div
    className="absolute rounded-full bg-brand/20 dark:bg-brand/30"
    style={{ width: size, height: size, left: x, top: y }}
    animate={{
      y: [0, -30, 0],
      opacity: [0.2, 0.6, 0.2],
    }}
    transition={{
      duration: 4 + Math.random() * 3,
      repeat: Infinity,
      delay,
      ease: 'easeInOut',
    }}
  />
);

const Hero: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.96]);

  const headingVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.08, delayChildren: 0.2 },
    },
  };

  const wordVariant = {
    hidden: { opacity: 0, y: 40, filter: 'blur(8px)' },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
    },
  };

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex items-center overflow-hidden bg-[#fafbfc] dark:bg-[#060a14]"
    >
      {/* Animated grid background */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ y: useTransform(scrollYProgress, [0, 1], [0, -60]) }}
      >
        <div
          className="absolute inset-0 opacity-[0.3] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
            backgroundSize: '80px 80px',
          }}
        />
      </motion.div>

      {/* Gradient orbs */}
      <motion.div
        className="absolute top-[-200px] right-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
          y: useTransform(scrollYProgress, [0, 1], [0, 80]),
        }}
      />
      <motion.div
        className="absolute bottom-[-100px] left-[-100px] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, transparent 70%)',
          y: useTransform(scrollYProgress, [0, 1], [0, -50]),
        }}
      />

      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[
          { x: '15%', y: '20%', size: 6, delay: 0 },
          { x: '75%', y: '30%', size: 4, delay: 1.2 },
          { x: '85%', y: '60%', size: 8, delay: 0.5 },
          { x: '25%', y: '70%', size: 5, delay: 2 },
          { x: '60%', y: '15%', size: 3, delay: 1.8 },
          { x: '40%', y: '80%', size: 7, delay: 0.8 },
        ].map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </div>

      <motion.div
        className="max-w-[1400px] mx-auto px-6 lg:px-10 pt-28 pb-20 lg:pt-36 lg:pb-28 w-full relative z-10"
        style={{ y, opacity, scale }}
      >
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-16 lg:gap-20 items-center">
          {/* Left: Content */}
          <div>
            {/* Badge with pulse */}
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 mb-8"
            >
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand/[0.08] dark:bg-brand/[0.12] text-brand text-[11px] font-bold uppercase tracking-[0.08em] border border-brand/[0.12]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand" />
                </span>
                Now Serving 12,800+ Investors
              </span>
            </motion.div>

            {/* Heading with word-by-word reveal */}
            <motion.h1
              variants={headingVariants}
              initial="hidden"
              animate="visible"
              className="text-[clamp(2.5rem,6vw,5.25rem)] font-extrabold text-dark dark:text-white tracking-[-0.035em] leading-[0.92] mb-7"
            >
              <motion.span variants={wordVariant} className="inline-block mr-[0.25em]">Your</motion.span>
              <motion.span variants={wordVariant} className="inline-block mr-[0.25em]">capital</motion.span>
              <br />
              <motion.span variants={wordVariant} className="inline-block mr-[0.25em]">deserves</motion.span>
              <motion.span variants={wordVariant} className="inline-block mr-[0.25em]">a</motion.span>
              <br />
              <motion.span variants={wordVariant} className="relative inline-block">
                <span className="text-shimmer">brain.</span>
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, delay: 1.2, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute bottom-[0.05em] left-[-0.05em] right-[-0.05em] h-[0.25em] bg-brand/15 dark:bg-brand/20 origin-left rounded-sm"
                />
              </motion.span>
            </motion.h1>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="text-lg text-gray-500 dark:text-gray-400 font-medium leading-[1.7] max-w-[500px] mb-10"
            >
              InvestWise replaces your spreadsheet chaos with an immutable
              ledger — tracking every taka across partners, projects, and
              payouts with zero room for error.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="flex flex-wrap items-center gap-3"
            >
              <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}>
                <Link
                  to="/login"
                  className="mag-btn ripple group inline-flex items-center gap-2 px-7 py-4 bg-dark dark:bg-white text-white dark:text-dark text-[15px] font-bold rounded-2xl"
                >
                  Start Free Trial
                  <ArrowUpRight
                    size={16}
                    strokeWidth={2.5}
                    className="opacity-50 group-hover:opacity-100 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] transition-all duration-300"
                  />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.98 }}>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 px-6 py-4 text-[15px] font-semibold text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white border border-gray-200 dark:border-white/10 rounded-2xl hover:border-gray-300 dark:hover:border-white/20 hover:bg-white dark:hover:bg-white/[0.03] transition-all duration-300"
                >
                  See Features
                </a>
              </motion.div>
            </motion.div>

            {/* Trust strip with animated counters */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1 }}
              className="mt-14 flex items-center gap-6 flex-wrap"
            >
              {[
                { num: 1.4, suffix: 'B+', prefix: '৳', label: 'Assets Managed', isNum: true },
                { num: 99.99, suffix: '%', prefix: '', label: 'Uptime', isNum: true },
              ].map((item, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div className="w-px h-4 bg-gray-200 dark:bg-white/10" />}
                  <div>
                    <div className="text-sm font-extrabold text-dark dark:text-white leading-none">
                      {item.isNum ? (
                        <AnimatedNumber value={item.num} suffix={item.suffix} prefix={item.prefix} />
                      ) : (
                        <>{item.prefix}{item.num}{item.suffix}</>
                      )}
                    </div>
                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      {item.label}
                    </div>
                  </div>
                </React.Fragment>
              ))}
              <div className="w-px h-4 bg-gray-200 dark:bg-white/10" />
              <div>
                <div className="text-sm font-extrabold text-dark dark:text-white leading-none">Bank-Grade</div>
                <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Encryption</div>
              </div>
            </motion.div>
          </div>

          {/* Right: Dashboard Preview */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="tilt-card bg-white dark:bg-[#0d1425] rounded-2xl border border-gray-200/80 dark:border-white/[0.08] shadow-[0_25px_80px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_80px_-12px_rgba(0,0,0,0.5)] overflow-hidden">
              {/* Browser bar */}
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-white/[0.06]">
                <div className="flex gap-1.5">
                  <motion.div whileHover={{ scale: 1.3 }} className="w-2.5 h-2.5 rounded-full bg-red-400/80 cursor-pointer" />
                  <motion.div whileHover={{ scale: 1.3 }} className="w-2.5 h-2.5 rounded-full bg-yellow-400/80 cursor-pointer" />
                  <motion.div whileHover={{ scale: 1.3 }} className="w-2.5 h-2.5 rounded-full bg-green-400/80 cursor-pointer" />
                </div>
                <div className="flex-1 mx-10">
                  <div className="bg-gray-100 dark:bg-white/[0.04] rounded-lg py-1.5 px-4 text-center">
                    <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                      app.investwise.io/dashboard
                    </span>
                  </div>
                </div>
              </div>

              {/* Dashboard content */}
              <div className="p-5 lg:p-6 bg-gray-50/50 dark:bg-[#080e1c] min-h-[420px]">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: 'Total Portfolio', value: '৳847.2M', change: '+12.4%', icon: 'portfolio' },
                    { label: 'Active Projects', value: '24', change: '+3', icon: 'projects' },
                    { label: 'This Month', value: '৳34.1M', change: '+8.7%', icon: 'growth' },
                  ].map((stat, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: 0.8 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={{ y: -3, scale: 1.02 }}
                      className="bg-white dark:bg-white/[0.03] rounded-xl p-3.5 border border-gray-100 dark:border-white/[0.05] cursor-pointer transition-shadow hover:shadow-lg"
                    >
                      <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                        {stat.label}
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <div className="text-lg font-extrabold text-dark dark:text-white tracking-tight">{stat.value}</div>
                          <div className="text-[11px] font-bold text-emerald-500 mt-0.5">{stat.change}</div>
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center opacity-40">
                          {stat.icon === 'portfolio' && (
                            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4"><rect x="1" y="6" width="3" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="6.5" y="3" width="3" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="12" y="1" width="3" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/></svg>
                          )}
                          {stat.icon === 'projects' && (
                            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                          )}
                          {stat.icon === 'growth' && (
                            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4"><path d="M2 12L6 6L9 9L14 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 3H14V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Chart */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2 }}
                  className="bg-white dark:bg-white/[0.03] rounded-xl p-4 border border-gray-100 dark:border-white/[0.05] mb-4"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Portfolio Growth</span>
                    <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 px-2 py-1 bg-gray-100 dark:bg-white/5 rounded-md">Last 12 months</span>
                  </div>
                  <svg viewBox="0 0 500 120" className="w-full h-[120px]" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <motion.path
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 2, delay: 1.4, ease: 'easeOut' }}
                      d="M0,100 C30,95 60,85 100,80 C140,75 170,90 210,70 C250,50 280,65 320,45 C360,25 400,35 440,20 C470,12 490,15 500,10"
                      fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round"
                    />
                    <path
                      d="M0,100 C30,95 60,85 100,80 C140,75 170,90 210,70 C250,50 280,65 320,45 C360,25 400,35 440,20 C470,12 490,15 500,10 L500,120 L0,120 Z"
                      fill="url(#heroGrad)"
                    />
                    <motion.circle
                      initial={{ scale: 0 }} animate={{ scale: 1 }}
                      transition={{ delay: 3.3, duration: 0.4, type: 'spring' }}
                      cx="500" cy="10" r="4" fill="#2563EB"
                    />
                    <motion.circle
                      initial={{ scale: 0 }} animate={{ scale: [0, 1.5, 1] }}
                      transition={{ delay: 3.3, duration: 0.6, type: 'spring' }}
                      cx="500" cy="10" r="8" fill="#2563EB" opacity="0.2"
                    />
                  </svg>
                </motion.div>

                {/* Transactions */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.4 }}
                  className="bg-white dark:bg-white/[0.03] rounded-xl p-4 border border-gray-100 dark:border-white/[0.05]"
                >
                  <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Recent Transactions</div>
                  {[
                    { name: 'Dhanmondi Complex', amount: '৳12.5M', type: 'Deposit', color: 'bg-emerald-500' },
                    { name: 'Gulshan Tech Hub', amount: '৳8.2M', type: 'Dividend', color: 'bg-brand' },
                    { name: 'Banani Residences', amount: '৳5.8M', type: 'Withdrawal', color: 'bg-amber-500' },
                  ].map((tx, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 1.6 + i * 0.1 }}
                      whileHover={{ x: 4, backgroundColor: 'rgba(0,0,0,0.01)' }}
                      className={`flex items-center justify-between py-2.5 cursor-pointer rounded-lg px-1 transition-colors ${i < 2 ? 'border-b border-gray-50 dark:border-white/[0.03]' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className={`w-7 h-7 rounded-lg ${tx.color}/10 flex items-center justify-center`}>
                            <div className={`w-2 h-2 rounded-full ${tx.color}`} />
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] font-bold text-dark dark:text-white">{tx.name}</div>
                          <div className="text-[10px] font-semibold text-gray-400">{tx.type}</div>
                        </div>
                      </div>
                      <span className="text-[12px] font-extrabold text-dark dark:text-white">{tx.amount}</span>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>

            {/* Floating ROI badge */}
            <motion.div
              initial={{ opacity: 0, x: -30, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 1.8, duration: 0.6, ease: [0.22, 1, 0.32, 1] }}
              className="absolute -left-6 bottom-24 hidden lg:flex"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="flex items-center gap-3 bg-white dark:bg-[#0d1425] rounded-2xl p-3.5 border border-gray-100 dark:border-white/[0.08] shadow-xl"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
                    <path d="M4 14L8 8L12 11L16 5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500">ROI This Quarter</div>
                  <div className="text-[15px] font-extrabold text-dark dark:text-white">+31.2%</div>
                </div>
              </motion.div>
            </motion.div>

            {/* Floating notification */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 2.2, duration: 0.5 }}
              className="absolute -right-4 top-16 hidden lg:block"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                className="flex items-center gap-2.5 bg-white dark:bg-[#0d1425] rounded-xl py-2.5 px-3.5 border border-gray-100 dark:border-white/[0.08] shadow-lg"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-bold text-dark dark:text-white">Dividend paid</span>
                <span className="text-[10px] font-semibold text-gray-400">2m ago</span>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em]">Scroll</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-5 h-8 rounded-full border-2 border-gray-300 dark:border-white/20 flex items-start justify-center p-1"
        >
          <motion.div
            animate={{ y: [0, 10, 0], opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-1.5 rounded-full bg-gray-400 dark:bg-white/40"
          />
        </motion.div>
      </motion.div>
    </section>
  );
};

export default Hero;
