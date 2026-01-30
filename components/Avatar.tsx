
import React from 'react';

interface AvatarProps {
    name: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Avatar: React.FC<AvatarProps> = ({ name, className = '', size = 'md' }) => {
    const getInitials = (n: string) => {
        if (!n) return '?';
        const parts = n.split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return n.substring(0, 2).toUpperCase();
    };

    const getColor = (n: string) => {
        // Return default color if name is undefined/null
        if (!n) {
            return 'bg-gradient-to-br from-gray-400 to-gray-600 text-white';
        }

        const colors = [
            'bg-gradient-to-br from-brand to-lime-400 text-dark',
            'bg-gradient-to-br from-indigo-500 to-blue-600 text-white',
            'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
            'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
            'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
            'bg-gradient-to-br from-slate-800 to-black text-white dark:from-white/10 dark:to-white/5 dark:text-brand',
            'bg-gradient-to-br from-cyan-500 to-blue-500 text-white',
            'bg-gradient-to-br from-purple-500 to-violet-600 text-white',
        ];

        // Simple hash function to consistently get the same color for the same name
        let hash = 0;
        for (let i = 0; i < n.length; i++) {
            hash = n.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % colors.length;
        return colors[index];
    };

    const sizeStyles = {
        sm: 'w-8 h-8 text-[10px]',
        md: 'w-12 h-12 text-sm',
        lg: 'w-14 h-14 text-base',
        xl: 'w-24 h-24 text-2xl',
    };

    const initials = getInitials(name);
    const colorClass = getColor(name);

    return (
        <div
            className={`
        ${sizeStyles[size]} 
        ${colorClass} 
        ${className} 
        flex items-center justify-center font-black tracking-tighter rounded-2xl shadow-sm border border-black/5 dark:border-white/5 overflow-hidden transition-all
      `}
            title={name}
        >
            {initials}
        </div>
    );
};

export default Avatar;
