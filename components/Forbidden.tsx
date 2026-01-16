
import React from 'react';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Forbidden: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center p-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-24 h-24 bg-rose-50 dark:bg-rose-500/10 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-xl shadow-rose-500/10">
                <ShieldAlert size={48} className="text-rose-500" strokeWidth={1.5} />
            </div>

            <h1 className="text-5xl font-black text-dark dark:text-white uppercase tracking-tighter mb-4">
                Access Denied
            </h1>

            <p className="text-gray-500 dark:text-gray-400 font-medium max-w-md mb-10 leading-relaxed">
                You do not have the required permissions to view this module. Please contact your system administrator if you believe this is an error.
            </p>

            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate(-1)}
                    className="px-8 py-4 bg-gray-100 dark:bg-white/5 text-dark dark:text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                >
                    <ArrowLeft size={16} /> Back
                </button>

                <button
                    onClick={() => navigate('/dashboard')}
                    className="px-8 py-4 bg-dark dark:bg-brand text-white dark:text-dark rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2 shadow-xl"
                >
                    <LayoutDashboard size={16} /> Dashboard
                </button>
            </div>
        </div>
    );
};

export default Forbidden;
