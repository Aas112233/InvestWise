import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';

const LogoIcon = () => (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
        <rect width="32" height="32" rx="8" className="fill-dark dark:fill-brand" />
        <path d="M6 20 L13 12 L18 17 L28 5" className="stroke-brand dark:stroke-dark" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M24 4 H29 V9" className="stroke-brand dark:stroke-dark" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
);

const LandingHeader: React.FC = () => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 ${isScrolled
                ? 'py-4 bg-white/80 dark:bg-dark/80 backdrop-blur-xl border-b border-gray-200 dark:border-white/5'
                : 'py-6 bg-transparent'
                }`}
        >
            <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-3 group">
                    <div className="p-1.5 bg-dark dark:bg-brand rounded-xl shadow-lg transition-transform group-hover:scale-105">
                        <LogoIcon />
                    </div>
                    <span className="text-xl font-black text-dark dark:text-white tracking-tight">
                        Invest<span className="text-brand">Wise</span>
                    </span>
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-10">
                    {['Solutions', 'Security', 'About', 'Pricing'].map((item) => (
                        <a
                            key={item}
                            href={`#${item.toLowerCase()}`}
                            className="text-sm font-bold text-gray-500 hover:text-dark dark:text-gray-400 dark:hover:text-white transition-colors relative group"
                        >
                            {item}
                            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-brand transition-all group-hover:w-full" />
                        </a>
                    ))}
                </nav>

                {/* CTA */}
                <div className="hidden md:flex items-center gap-6">
                    <Link
                        to="/login"
                        className="text-sm font-black text-dark dark:text-white hover:text-brand dark:hover:text-brand transition-colors"
                    >
                        Client Login
                    </Link>
                    <Link
                        to="/login"
                        className="px-6 py-3 bg-dark dark:bg-brand text-white dark:text-dark rounded-full font-black text-sm shadow-xl shadow-brand/10 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                    >
                        Get Access <ArrowRight size={16} strokeWidth={3} />
                    </Link>
                </div>

                {/* Mobile Toggle */}
                <button
                    className="md:hidden p-2 text-dark dark:text-white"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                >
                    {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Mobile Menu */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="absolute top-full left-0 right-0 bg-white dark:bg-dark border-b border-gray-200 dark:border-white/5 p-6 flex flex-col gap-6 md:hidden"
                    >
                        {['Solutions', 'Security', 'About', 'Pricing'].map((item) => (
                            <a
                                key={item}
                                href={`#${item.toLowerCase()}`}
                                className="text-lg font-bold text-dark dark:text-white"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                {item}
                            </a>
                        ))}
                        <hr className="border-gray-100 dark:border-white/5" />
                        <Link
                            to="/login"
                            className="text-lg font-bold text-dark dark:text-white"
                        >
                            Client Login
                        </Link>
                        <Link
                            to="/login"
                            className="w-full py-4 bg-brand text-dark rounded-2xl font-black text-center"
                        >
                            Get Access
                        </Link>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
};

export default LandingHeader;
