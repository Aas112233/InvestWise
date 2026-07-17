import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#04070d] border-t border-white/[0.04] relative overflow-hidden">
      {/* Subtle gradient accent */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[300px] bg-brand/[0.03] rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 pt-16 pb-8 relative z-10">
        {/* Top row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 lg:gap-12 mb-16">
          {/* Brand */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0"
          >
            <Link to="/" className="flex items-center gap-2.5 mb-5 group">
              <motion.svg
                whileHover={{ rotate: -8, scale: 1.05 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                viewBox="0 0 36 36"
                fill="none"
                className="w-8 h-8"
              >
                <rect width="36" height="36" rx="10" fill="white" />
                <path d="M10 22 L16 16 L20 20 L26 12" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="26" cy="12" r="2.5" fill="#2563EB" />
              </motion.svg>
              <span className="text-[17px] font-extrabold text-white tracking-[-0.02em]">
                Invest<span className="text-brand">Wise</span>
              </span>
            </Link>
            <p className="text-[13px] text-gray-500 font-medium leading-[1.7] max-w-[280px]">
              Enterprise wealth management for investment groups. Built in Dhaka, trusted globally.
            </p>

            {/* Social icons */}
            <div className="flex items-center gap-2 mt-6">
              {['X', 'Li', 'Gh'].map((label, i) => (
                <motion.a
                  key={i}
                  href="#"
                  whileHover={{ y: -2, scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-gray-500 hover:text-brand hover:border-brand/30 transition-colors text-[11px] font-bold"
                >
                  {label}
                </motion.a>
              ))}
            </div>
          </motion.div>

          {/* Links */}
          {[
            {
              title: 'Product',
              links: ['Features', 'Pricing', 'Security', 'Changelog', 'API Docs'],
            },
            {
              title: 'Company',
              links: ['About Us', 'Blog', 'Careers', 'Contact', 'Press Kit'],
            },
            {
              title: 'Resources',
              links: ['Documentation', 'Help Center', 'Community', 'Partners', 'Status'],
            },
            {
              title: 'Legal',
              links: ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR'],
            },
          ].map((col, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 + i * 0.05 }}
            >
              <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400 mb-5">
                {col.title}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link, j) => (
                  <li key={j}>
                    <motion.a
                      href="#"
                      whileHover={{ x: 3 }}
                      className="text-[13px] font-medium text-gray-500 hover:text-white transition-colors inline-block"
                    >
                      {link}
                    </motion.a>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="pt-8 border-t border-white/[0.04] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[11px] font-medium text-gray-600 tracking-wide">
            &copy; 2026 InvestWise. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-[11px] font-medium text-gray-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              All Systems Operational
            </div>
            <div className="text-[11px] font-medium text-gray-600">
              Made in Bangladesh
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
