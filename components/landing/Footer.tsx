import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Mail, Phone, Globe, Twitter, Linkedin, Github } from 'lucide-react';

const Footer: React.FC = () => {
    return (
        <footer className="bg-[#050806] pt-24 pb-12 border-t border-white/5">
            <div className="max-w-7xl mx-auto px-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-20">
                    {/* Brand */}
                    <div className="space-y-8">
                        <Link to="/" className="flex items-center gap-3">
                            <div className="p-1.5 bg-brand rounded-xl">
                                <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
                                    <rect width="32" height="32" rx="8" className="fill-dark" />
                                    <path d="M6 20 L13 12 L18 17 L28 5" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                                </svg>
                            </div>
                            <span className="text-xl font-black text-white tracking-tight">
                                Invest<span className="text-brand">Wise</span>
                            </span>
                        </Link>
                        <p className="text-gray-500 font-medium text-sm leading-relaxed max-w-xs">
                            Enterprise-grade wealth management platform. Empowering investment firms with precision, security, and automated growth.
                        </p>
                        <div className="flex items-center gap-4">
                            {[
                                { Icon: Twitter, label: 'Twitter' },
                                { Icon: Linkedin, label: 'LinkedIn' },
                                { Icon: Github, label: 'GitHub' }
                            ].map(({ Icon, label }, i) => (
                                <a
                                    key={i}
                                    href="#"
                                    className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-gray-400 hover:text-brand hover:border-brand/40 transition-all"
                                    aria-label={label}
                                >
                                    <Icon size={18} />
                                </a>
                            ))}
                        </div>
                    </div>

                    {/* Links */}
                    {['Platform', 'Resources', 'Legal'].map((title, i) => (
                        <div key={i}>
                            <h4 className="text-white font-black uppercase tracking-widest text-xs mb-8">{title}</h4>
                            <ul className="space-y-4">
                                {['Transactions', 'Project Tracking', 'Member Portal', 'Security'].slice(0, 4).map((link, j) => (
                                    <li key={j}>
                                        <a href="#" className="text-gray-500 hover:text-brand text-sm font-medium transition-colors">{link}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Global Stats */}
                <div className="py-12 border-y border-white/5 grid grid-cols-2 lg:grid-cols-4 gap-8">
                    {[
                        { label: "Assets Managed", val: "৳1.4B+" },
                        { label: "Active Investors", val: "12,800+" },
                        { label: "Venture Liquidity", val: "94.2%" },
                        { label: "System Uptime", val: "99.99%" }
                    ].map((stat, i) => (
                        <div key={i}>
                            <div className="text-white font-black text-2xl mb-1">{stat.val}</div>
                            <div className="text-gray-600 font-bold uppercase tracking-widest text-[10px]">{stat.label}</div>
                        </div>
                    ))}
                </div>

                {/* Bottom */}
                <div className="mt-12 flex flex-col md:flex-row items-center justify-between gap-6">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
                        © 2026 INVESTWISE ENTERPRISE. ALL RIGHTS RESERVED.
                    </p>
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-700">
                            <Globe size={12} />
                            EN-US / BDT
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-500">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            SYSTEMS OPERATIONAL
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
