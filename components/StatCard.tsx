
import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string; // Keep as string to allow prefixes like $ or suffixes like M/BDT
  change: string;
  isPositive?: boolean;
  variant?: 'dark' | 'light' | 'brand';
}

const CountUp: React.FC<{ target: string }> = ({ target }) => {
  const [count, setCount] = useState(0);

  // Extract numeric part, prefix and suffix
  const match = target.match(/^([^0-9.]*)([0-9.]+)(.*)$/);
  const prefix = match ? match[1] : '';
  const numericStr = match ? match[2] : '0';
  const suffix = match ? match[3] : '';
  const targetNum = parseFloat(numericStr);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const duration = 1500; // 1.5 seconds animation

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // Easing function: easeOutExpo
      const easedProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      setCount(easedProgress * targetNum);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [targetNum]);

  // Format the count to match the original precision
  const decimalPlaces = numericStr.includes('.') ? numericStr.split('.')[1].length : 0;
  const formattedCount = count.toFixed(decimalPlaces);

  return (
    <span>{prefix}{formattedCount}{suffix}</span>
  );
};

const StatCard: React.FC<StatCardProps> = ({ label, value, change, isPositive = true, variant = 'light' }) => {
  const isDarkVariant = variant === 'dark';
  const isBrandVariant = variant === 'brand';

  let cardClass = "";
  if (isBrandVariant) {
    cardClass = "bg-brand text-dark shadow-[0_40px_80px_-20px_rgba(191,243,0,0.3)] border-dark/5";
  } else if (isDarkVariant) {
    cardClass = "bg-dark text-white dark:bg-brand dark:text-dark shadow-[0_30px_60px_-15px_rgba(0,0,0,0.4)] border-transparent";
  } else {
    cardClass = "bg-white dark:bg-[#1A221D] text-dark dark:text-white border-gray-100 dark:border-white/5 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)]";
  }

  return (
    <div
      className={`relative p-6 xl:p-8 rounded-[3.5rem] min-w-[240px] flex-1 transition-all duration-700 hover:-translate-y-3 hover:rotate-x-12 perspective-2000 group cursor-default border overflow-hidden ${cardClass}`}
    >
      {/* 3D Depth Layer - Dynamic Glow */}
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none bg-gradient-to-tr ${isBrandVariant ? 'from-white/40 to-transparent' :
        isDarkVariant ? 'from-brand/10 to-transparent' : 'from-brand/5 to-transparent'
        }`} />

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-6">
          <span className={`text-[10px] font-black px-4 py-2 rounded-full uppercase tracking-[0.2em] shadow-inner transition-colors ${isBrandVariant ? 'bg-dark/10 text-dark/70' :
            isDarkVariant ? 'bg-white/10 dark:bg-dark/10 text-white/60 dark:text-dark/60' :
              'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400'
            }`}>
            {label}
          </span>
          <div className={`flex items-center gap-1.5 text-[11px] font-black drop-shadow-sm ${isPositive ? (isBrandVariant ? 'text-dark/80' : 'text-emerald-500') : 'text-rose-500'
            }`}>
            {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {change}
          </div>
        </div>

        <div className="mb-8 transform-gpu transition-transform group-hover:translate-z-20 group-hover:scale-105 duration-700 origin-left">
          <h3 className={`font-black tracking-tighter leading-none drop-shadow-2xl break-all ${value.length > 12 ? 'text-2xl sm:text-3xl' :
            value.length > 10 ? 'text-3xl sm:text-4xl' :
              value.length > 8 ? 'text-4xl sm:text-5xl' :
                'text-5xl sm:text-6xl'
            }`}>
            <CountUp target={value} />
          </h3>
        </div>

        {/* Animated 3D Bar Visualizer with depth */}
        <div className="h-14 w-full flex items-end gap-[6px]">
          {[45, 75, 55, 90, 60, 100, 80, 110].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-2xl transition-all duration-1000 delay-[${i * 40}ms] group-hover:translate-y-[-8px] group-hover:shadow-2xl ${isBrandVariant ? 'bg-dark/20' :
                isDarkVariant ? 'bg-brand/30 dark:bg-dark/30' :
                  'bg-gray-200/50 dark:bg-brand/20'
                }`}
              style={{ height: `${Math.min(h, 100)}%`, opacity: (i + 1) / 8 }}
            />
          ))}
        </div>
      </div>

      {/* Premium depth sheen */}
      <div className="absolute top-[-100%] left-[-100%] w-[300%] h-[300%] bg-gradient-to-br from-white/20 via-transparent to-transparent rotate-45 translate-y-[100%] group-hover:translate-y-[-100%] transition-transform duration-[2000ms] pointer-events-none" />
    </div>
  );
};

export default StatCard;
