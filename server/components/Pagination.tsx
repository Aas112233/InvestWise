import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    rowsPerPage?: number;
    onRowsPerPageChange?: (limit: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange, rowsPerPage, onRowsPerPageChange }) => {
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    // Logic to show a subset of pages if there are too many
    const getVisiblePages = () => {
        if (totalPages <= 7) return pages;

        if (currentPage <= 4) return [...pages.slice(0, 5), '...', totalPages];
        if (currentPage > totalPages - 4) return [1, '...', ...pages.slice(totalPages - 5)];

        return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
    };

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mt-12 bg-gray-50/50 dark:bg-white/5 p-4 rounded-[2rem] border border-gray-100 dark:border-white/5 backdrop-blur-md">
            {/* Rows Per Page Selector */}
            {onRowsPerPageChange && (
                <div className="flex items-center gap-4">
                    <span className="text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">Rows per page</span>
                    <div className="flex gap-1 bg-white dark:bg-black/20 p-1 rounded-xl border border-gray-100 dark:border-white/5 shadow-sm">
                        {[10, 20, 50].map((limit) => (
                            <button
                                key={limit}
                                onClick={() => onRowsPerPageChange(limit)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${rowsPerPage === limit
                                    ? 'bg-brand text-dark shadow-lg shadow-brand/20'
                                    : 'text-gray-400 hover:text-dark dark:text-white/40 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                {limit}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2.5 bg-white dark:bg-black/20 border border-gray-100 dark:border-white/5 rounded-xl hover:border-brand/40 disabled:opacity-30 disabled:hover:border-gray-100 transition-all text-dark dark:text-white group shadow-sm"
                >
                    <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                </button>

                <div className="flex items-center gap-1">
                    {getVisiblePages().map((page, index) => (
                        typeof page === 'number' ? (
                            <button
                                key={index}
                                onClick={() => onPageChange(page)}
                                className={`w-10 h-10 flex items-center justify-center rounded-xl text-[11px] font-black transition-all border ${currentPage === page
                                    ? 'bg-brand text-dark border-brand shadow-lg shadow-brand/20'
                                    : 'bg-white dark:bg-black/20 text-gray-400 dark:text-white/40 border-gray-100 dark:border-white/5 hover:border-brand/40 shadow-sm'
                                    }`}
                            >
                                {page}
                            </button>
                        ) : (
                            <span key={index} className="w-10 h-10 flex items-center justify-center text-gray-300 dark:text-white/20 font-black">
                                {page}
                            </span>
                        )
                    ))}
                </div>

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="p-2.5 bg-white dark:bg-black/20 border border-gray-100 dark:border-white/5 rounded-xl hover:border-brand/40 disabled:opacity-30 disabled:hover:border-gray-100 transition-all text-dark dark:text-white group shadow-sm"
                >
                    <ChevronRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
            </div>

            {/* Total Results Hint */}
            <div className="hidden sm:block">
                <span className="text-[10px] font-black text-gray-400 dark:text-white/20 uppercase tracking-[0.2em]">
                    Page {currentPage} of {totalPages || 1}
                </span>
            </div>
        </div>
    );
};

export default Pagination;
