import React, { useState, useEffect } from 'react';
import { Search, Filter, Calendar, Clock, User, FileText, Download, ShieldAlert, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { Language, t } from '../../i18n/translations';
import { User as UserType } from '../../types';

interface AuditLog {
    _id: string;
    user: { _id: string; name: string; email: string; role: string } | null;
    userName: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details: any;
    ipAddress: string;
    status: string;
    createdAt: string;
}

interface AuditLogsProps {
    lang: Language;
    currentUser: UserType | null;
}

const AuditLogs: React.FC<AuditLogsProps> = ({ lang, currentUser }) => {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('');
    const [resourceFilter, setResourceFilter] = useState('');

    const [metadata, setMetadata] = useState<{ actions: string[]; resources: string[] }>({ actions: [], resources: [] });

    useEffect(() => {
        fetchMetadata();
    }, []);

    useEffect(() => {
        const handler = setTimeout(() => {
            fetchLogs();
        }, 500);
        return () => clearTimeout(handler);
    }, [page, searchTerm, actionFilter, resourceFilter]);

    const fetchMetadata = async () => {
        try {
            const { data } = await api.get('/audit/metadata');
            setMetadata(data);
        } catch (error) {
            console.error('Failed to fetch audit metadata:', error);
        }
    };

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', page.toString());
            if (searchTerm) params.append('search', searchTerm);
            if (actionFilter) params.append('action', actionFilter);
            if (resourceFilter) params.append('resourceType', resourceFilter);

            const { data } = await api.get(`/audit?${params.toString()}`);
            setLogs(data.logs);
            setTotalPages(data.pages);
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch audit logs:', error);
            setLoading(false);
        }
    };

    const formatDetailValue = (val: any): string => {
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return String(val);
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
                <div className="flex justify-between items-start mb-10">
                    <div>
                        <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">System Audit Ledger</h3>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Immutable Timeline of all administrative actions</p>
                    </div>
                    <div className="p-4 bg-orange-500/10 text-orange-500 rounded-2xl shadow-2xl shadow-orange-500/20">
                        <ShieldAlert size={24} strokeWidth={3} />
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-gray-50 dark:bg-[#111814] p-6 rounded-[2.5rem] border border-gray-100 dark:border-white/5 mb-8 flex flex-col xl:flex-row gap-6">
                    <div className="flex-1 relative">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search by user, ID, or keywords..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white dark:bg-[#1A221D] pl-12 pr-6 py-4 rounded-2xl border border-gray-100 dark:border-white/5 outline-none focus:border-brand font-bold text-sm text-dark dark:text-white transition-all shadow-sm"
                        />
                    </div>

                    <div className="flex gap-4">
                        <div className="relative min-w-[180px]">
                            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <select
                                value={actionFilter}
                                onChange={(e) => setActionFilter(e.target.value)}
                                className="w-full appearance-none bg-white dark:bg-[#1A221D] pl-10 pr-10 py-4 rounded-2xl border border-gray-100 dark:border-white/5 outline-none focus:border-brand font-bold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300 cursor-pointer"
                            >
                                <option value="">All Actions</option>
                                {metadata.actions.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                        </div>

                        <div className="relative min-w-[180px]">
                            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <select
                                value={resourceFilter}
                                onChange={(e) => setResourceFilter(e.target.value)}
                                className="w-full appearance-none bg-white dark:bg-[#1A221D] pl-10 pr-10 py-4 rounded-2xl border border-gray-100 dark:border-white/5 outline-none focus:border-brand font-bold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300 cursor-pointer"
                            >
                                <option value="">All Resources</option>
                                {metadata.resources.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                        </div>

                        <button
                            onClick={fetchLogs}
                            className="bg-dark dark:bg-brand text-white dark:text-dark w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
                        >
                            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
                        </button>
                    </div>
                </div>

                {/* Table/List */}
                <div className="space-y-4">
                    {logs.length === 0 && !loading ? (
                        <div className="text-center py-20 text-gray-400 font-bold uppercase tracking-widest text-xs">No audit records found</div>
                    ) : (
                        logs.map(log => (
                            <div key={log._id} className="group bg-white dark:bg-[#1A221D] hover:bg-gray-50 dark:hover:bg-[#222] p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-4">
                                        <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                                            }`}>
                                            {log.action}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                                            <Clock size={12} /> {new Date(log.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest">ID: {log._id.slice(-6)}</span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                                    <div className="md:col-span-3 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400">
                                            <User size={18} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-dark dark:text-white text-sm">{log.userName}</p>
                                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">{log.ipAddress}</p>
                                        </div>
                                    </div>

                                    <div className="md:col-span-9">
                                        <div className="bg-gray-50 dark:bg-black/20 p-4 rounded-xl border border-gray-100 dark:border-white/5">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <FileText size={12} /> {log.resourceType}: {log.resourceId || 'N/A'}
                                            </p>
                                            <div className="text-xs font-mono text-gray-600 dark:text-gray-300 break-all">
                                                {Object.entries(log.details).map(([key, value]) => (
                                                    <div key={key} className="flex gap-2">
                                                        <span className="text-gray-400">{key}:</span>
                                                        <span>{formatDetailValue(value)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Pagination */}
                <div className="flex justify-between items-center mt-10">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                        className="px-6 py-3 rounded-xl bg-gray-50 dark:bg-white/5 text-xs font-black uppercase tracking-widest enabled:hover:bg-gray-100 dark:enabled:hover:bg-white/10 disabled:opacity-50 transition-all flex items-center gap-2"
                    >
                        <ChevronLeft size={14} /> Previous
                    </button>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Page {page} of {totalPages}</span>
                    <button
                        disabled={page === totalPages}
                        onClick={() => setPage(p => p + 1)}
                        className="px-6 py-3 rounded-xl bg-gray-50 dark:bg-white/5 text-xs font-black uppercase tracking-widest enabled:hover:bg-gray-100 dark:enabled:hover:bg-white/10 disabled:opacity-50 transition-all flex items-center gap-2"
                    >
                        Next <ChevronRight size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AuditLogs;
