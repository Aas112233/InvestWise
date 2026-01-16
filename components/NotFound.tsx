
import React from 'react';
import { SearchX, LayoutDashboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const NotFound: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center p-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-24 h-24 bg-gray-100 dark:bg-white/5 rounded-[2.5rem] flex items-center justify-center mb-8">
                <SearchX size={48} className="text-gray-400" strokeWidth={1.5} />
            </div>

            <div className="text-[12rem] font-black text-gray-100 dark:text-white/5 leading-none absolute -z-10 select-none">
                404
            </div>

            <h1 className="text-5xl font-black text-dark dark:text-white uppercase tracking-tighter mb-4 relative z-10">
                Page Not Found
            </h1>

            <p className="text-gray-500 dark:text-gray-400 font-medium max-w-md mb-10 leading-relaxed relative z-10">
                The requested resource could not be located on the server. The link might be broken or the page has been moved.
            </p>

            <button
                onClick={() => navigate('/dashboard')}
                className="px-10 py-5 bg-dark dark:bg-brand text-white dark:text-dark rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-3 shadow-xl relative z-10"
            >
                <LayoutDashboard size={18} /> Return Home
            </button>
        </div>
    );
};

export default NotFound;
