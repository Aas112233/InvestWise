import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowUpRight } from 'lucide-react';

const LogoMark = () => (
  <svg viewBox="0 0 36 36" fill="none" className="w-8 h-8">
    <rect width="36" height="36" rx="10" className="fill-dark dark:fill-white" />
    <path
      d="M10 22 L16 16 L20 20 L26 12"
      stroke="#2563EB"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="26" cy="12" r="2.5" fill="#2563EB" />
  </svg>
);

const navItems = [
  ['Features', '#features'],
  ['How it Works', '#how-it-works'],
  ['Security', '#security'],
];

const LandingHeader: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40);
      // Detect active section
      const sections = ['features', 'how-it-works', 'security'];
      for (const id of sections.reverse()) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(id);
          return;
        }
      }
      setActiveSection('');
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 ${
          isScrolled
            ? 'py-3 bg-white/70 dark:bg-[#0a0f1e]/80 backdrop-blur-2xl border-b border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_24px_rgba(0,0,0,0.3)]'
            : 'py-5 bg-transparent'
        }`}
      >
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ rotate: -8, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              <LogoMark />
            </motion.div>
            <span className="text-[17px] font-extrabold text-dark dark:text-white tracking-[-0.02em]">
              Invest<span className="text-brand">Wise</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(([label, href]) => {
              const isActive = href === `#${activeSection}`;
              return (
                <a
                  key={label}
                  href={href}
                  className={`relative px-4 py-2 text-[13px] font-semibold transition-colors rounded-lg ${
                    isActive
                      ? 'text-dark dark:text-white'
                      : 'text-gray-500 hover:text-dark dark:text-gray-400 dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  {label}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute bottom-0 left-2 right-2 h-[2px] bg-brand rounded-full"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </a>
              );
            })}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/login"
              className="px-4 py-2.5 text-[13px] font-bold text-dark dark:text-white hover:text-brand transition-colors"
            >
              Sign In
            </Link>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/login"
                className="group flex items-center gap-1.5 px-5 py-2.5 bg-dark dark:bg-white text-white dark:text-dark text-[13px] font-bold rounded-xl hover:shadow-lg transition-shadow"
              >
                Get Started
                <ArrowUpRight
                  size={14}
                  strokeWidth={2.5}
                  className="opacity-50 group-hover:opacity-100 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] transition-all duration-300"
                />
              </Link>
            </motion.div>
          </div>

          {/* Mobile Toggle */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            className="md:hidden p-2 text-dark dark:text-white"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <AnimatePresence mode="wait">
              {isMobileMenuOpen ? (
                <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <X size={22} />
                </motion.div>
              ) : (
                <motion.div key="menu" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <Menu size={22} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </motion.header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, y: 0, backdropFilter: 'blur(20px)' }}
            exit={{ opacity: 0, y: -10, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 top-[56px] z-[99] bg-white/90 dark:bg-[#0a0f1e]/90 border-b border-black/[0.06] dark:border-white/[0.06] p-6 md:hidden shadow-2xl"
          >
            <div className="flex flex-col gap-1">
              {navItems.map(([label, href], i) => (
                <motion.a
                  key={label}
                  href={href}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="py-3 px-3 text-[15px] font-semibold text-dark dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {label}
                </motion.a>
              ))}
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-4 pt-4 border-t border-gray-100 dark:border-white/5 flex flex-col gap-3"
            >
              <Link to="/login" className="py-3 text-center text-[15px] font-semibold text-gray-500 dark:text-gray-400" onClick={() => setIsMobileMenuOpen(false)}>
                Sign In
              </Link>
              <Link to="/login" className="py-3.5 bg-dark dark:bg-white text-white dark:text-dark rounded-xl font-bold text-center" onClick={() => setIsMobileMenuOpen(false)}>
                Get Started
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default LandingHeader;
