import React from 'react';
import { motion } from 'framer-motion';

const logos = [
  'Dhanmondi Complex',
  'Gulshan Holdings',
  'Banani Residences',
  'Uttara Ventures',
  'Mirpur Capital',
  'Baridhara Group',
  'Motijheel Partners',
  'Tejgaon Industries',
];

const Marquee: React.FC = () => {
  return (
    <section className="py-16 bg-[#fafbfc] dark:bg-[#040810] border-y border-gray-100 dark:border-white/[0.04] overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 mb-8">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500"
        >
          Trusted by leading investment groups across Bangladesh
        </motion.p>
      </div>

      {/* Marquee track */}
      <div className="relative">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#fafbfc] dark:from-[#040810] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#fafbfc] dark:from-[#040810] to-transparent z-10 pointer-events-none" />

        <div className="animate-marquee flex gap-12 whitespace-nowrap">
          {[...logos, ...logos].map((name, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-6 py-3 rounded-xl border border-gray-100 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] shrink-0"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-[11px] font-bold text-gray-500 dark:text-gray-400">
                {name.charAt(0)}
              </div>
              <span className="text-[13px] font-bold text-gray-500 dark:text-gray-400 tracking-tight">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const testimonials = [
  {
    quote: "We went from 3 hours of weekly spreadsheet reconciliation to zero. InvestWise doesn't just track — it thinks.",
    name: 'Rahim Ahmed',
    role: 'Managing Partner, Gulshan Holdings',
    initials: 'RA',
    color: 'bg-brand',
  },
  {
    quote: "Our 14-partner group had complete chaos before this. Now everyone sees their exact share in real-time. No more trust issues.",
    name: 'Fatima Khan',
    role: 'Director, Banani Residences',
    initials: 'FK',
    color: 'bg-emerald-500',
  },
  {
    quote: "The auto-dividend feature alone saved us 40 hours per quarter. The ROI on this tool is absurd.",
    name: 'Karim Hassan',
    role: 'CFO, Dhanmondi Complex',
    initials: 'KH',
    color: 'bg-amber-500',
  },
];

const Testimonials: React.FC = () => {
  return (
    <section className="py-24 lg:py-32 bg-white dark:bg-[#060a14] relative">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand mb-4"
          >
            What Partners Say
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ delay: 0.05, duration: 0.7 }}
            className="text-[clamp(2rem,4vw,3.5rem)] font-extrabold text-dark dark:text-white tracking-[-0.03em] leading-[1.05]"
          >
            Trusted by people who
            <br />
            manage real money.
          </motion.h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -6 }}
              className="group p-7 rounded-2xl bg-gray-50/80 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.05] hover:border-gray-200 dark:hover:border-white/[0.12] hover:bg-white dark:hover:bg-white/[0.04] transition-all duration-500 cursor-default"
            >
              {/* Quote mark */}
              <div className="text-[48px] font-extrabold text-gray-100 dark:text-white/[0.04] leading-none mb-2 select-none">"</div>

              <p className="text-[15px] text-gray-600 dark:text-gray-300 leading-[1.7] font-medium mb-8">
                {t.quote}
              </p>

              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-white text-[12px] font-bold`}>
                  {t.initials}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-dark dark:text-white">{t.name}</div>
                  <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export { Marquee, Testimonials };
