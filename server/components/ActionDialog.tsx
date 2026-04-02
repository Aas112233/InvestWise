import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X, Info, Trash2, Link as LinkIcon, Loader2 } from 'lucide-react';

export type ActionType = 'delete' | 'confirm' | 'review';

export interface DataDependency {
    type: string;
    count: number;
    description?: string;
}

export interface ActionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string | React.ReactNode;
    type: ActionType;
    confirmLabel?: string;
    cancelLabel?: string;
    details?: { label: string; value: string | number }[];
    onCheckDependencies?: () => Promise<DataDependency[]>;
    loading?: boolean;
}


const ActionDialog: React.FC<ActionDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    details,
    onCheckDependencies,
    loading = false
}) => {
    const [visible, setVisible] = useState(false);
    const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
    const [dependencies, setDependencies] = useState<DataDependency[]>([]);

    useEffect(() => {
        if (isOpen) {
            setVisible(true);
            // Reset state when dialog opens
            setDependencies([]);
            setIsCheckingDependencies(false);

            // Start dependency check if function provided
            if (onCheckDependencies && type === 'delete') {
                setIsCheckingDependencies(true);
                onCheckDependencies()
                    .then(deps => {
                        setDependencies(deps);
                        setIsCheckingDependencies(false);
                    })
                    .catch(err => {
                        console.error('Dependency check failed:', err);
                        setDependencies([]);
                        setIsCheckingDependencies(false);
                    });
            }
        } else {
            setTimeout(() => setVisible(false), 300);
        }
    }, [isOpen, onCheckDependencies, type]);

    if (!visible && !isOpen) return null;

    const isDelete = type === 'delete';
    const hasDependencies = dependencies.length > 0;
    const totalDependencies = dependencies.reduce((sum, dep) => sum + dep.count, 0);
    const isBlocked = isDelete && hasDependencies;
    const isButtonDisabled = isCheckingDependencies || isBlocked || loading;


    return (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 transition-all duration-300 ${isOpen ? 'bg-dark/90 backdrop-blur-md' : 'bg-transparent pointer-events-none'}`}>
            <div className={`w-full max-w-lg bg-white dark:bg-[#1A221D] rounded-[3rem] card-shadow border ${isDelete ? 'border-rose-500/50' : 'border-gray-100 dark:border-white/5'} overflow-hidden transition-all duration-300 transform ${isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>

                {/* Danger Banner for Delete Operations */}
                {isDelete && (
                    <div className={`px-10 py-4 flex items-center gap-3 ${isCheckingDependencies ? 'bg-gradient-to-r from-blue-500 to-blue-600' : isBlocked ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 'bg-gradient-to-r from-rose-500 to-rose-600 animate-pulse'}`}>
                        {isCheckingDependencies ? (
                            <>
                                <Loader2 size={20} className="text-white animate-spin" strokeWidth={3} />
                                <p className="text-white font-black text-xs uppercase tracking-widest"> Checking Data Connections...</p>
                            </>
                        ) : isBlocked ? (
                            <>
                                <LinkIcon size={20} className="text-white" strokeWidth={3} />
                                <p className="text-white font-black text-xs uppercase tracking-widest"> Deletion Blocked - Data Connections Exist</p>
                            </>
                        ) : (
                            <>
                                <AlertTriangle size={20} className="text-white" strokeWidth={3} />
                                <p className="text-white font-black text-xs uppercase tracking-widest"> Destructive Action - Cannot Be Undone</p>
                            </>
                        )}
                    </div>
                )}

                {/* Header */}
                <div className={`px-10 py-8 border-b ${isDelete ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20' : 'bg-gray-50/50 dark:bg-white/5 border-gray-100 dark:border-white/5'} flex items-center gap-6`}>
                    <div className={`p-4 rounded-full ${isDelete ? (isCheckingDependencies ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/50' : isBlocked ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/50' : 'bg-rose-500 text-white shadow-lg shadow-rose-500/50 animate-bounce') : 'bg-brand/10 text-brand'}`}>
                        {isDelete ? (
                            isCheckingDependencies ? <Loader2 size={28} strokeWidth={2.5} className="animate-spin" /> :
                                isBlocked ? <LinkIcon size={28} strokeWidth={2.5} /> :
                                    <Trash2 size={28} strokeWidth={2.5} />
                        ) : <Info size={28} strokeWidth={2.5} />}
                    </div>
                    <div>
                        <h3 className={`text-2xl font-black uppercase tracking-tighter ${isDelete ? (isCheckingDependencies ? 'text-blue-600 dark:text-blue-400' : isBlocked ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400') : 'text-dark dark:text-white'}`}>
                            {title}
                        </h3>
                        {type === 'review' && <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Please review details before proceeding</p>}
                        {isDelete && isCheckingDependencies && <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mt-1"> Analyzing connections...</p>}
                        {isDelete && !isCheckingDependencies && !isBlocked && <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mt-1"> This action is permanent</p>}
                        {isBlocked && <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mt-1"> {totalDependencies} connected record{totalDependencies > 1 ? 's' : ''} found</p>}
                    </div>
                </div>

                {/* Body */}
                <div className="p-10 space-y-6">
                    <div className={`font-bold leading-relaxed ${isDelete ? 'text-gray-700 dark:text-gray-200' : 'text-gray-600 dark:text-gray-300'}`}>
                        {message}
                    </div>

                    {/* Loading State */}
                    {isCheckingDependencies && (
                        <div className="bg-blue-50 dark:bg-blue-500/10 border-2 border-blue-500/30 rounded-2xl p-6">
                            <div className="flex items-center gap-4">
                                <Loader2 size={24} className="text-blue-600 animate-spin flex-shrink-0" strokeWidth={2.5} />
                                <div className="space-y-2">
                                    <p className="text-sm font-black text-blue-700 dark:text-blue-400 uppercase tracking-wide">Checking Data Integrity</p>
                                    <p className="text-xs font-bold text-blue-800 dark:text-blue-300">
                                        Scanning for connected records and dependencies...
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Dependency Blocking Warning */}
                    {isBlocked && !isCheckingDependencies && (
                        <div className="bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl p-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <LinkIcon size={20} className="text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <div className="space-y-3 flex-1">
                                    <p className="text-sm font-black text-amber-700 dark:text-amber-400 uppercase tracking-wide">Cannot Delete - Data Connections Found</p>
                                    <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                                        This record has {totalDependencies} connected {totalDependencies === 1 ? 'record' : 'records'} that must be removed first:
                                    </p>
                                    <ul className="space-y-2">
                                        {dependencies.map((dep, idx) => (
                                            <li key={idx} className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 px-3 py-2 rounded-lg">
                                                <span className="bg-amber-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black">{dep.count}</span>
                                                <span className="flex-1">{dep.type}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="text-xs font-bold text-amber-700 dark:text-amber-300 italic">
                                        💡 Remove or reassign these connections before deletion.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Warning Box for Delete (when no dependencies) */}
                    {isDelete && !isBlocked && !isCheckingDependencies && (
                        <div className="bg-rose-50 dark:bg-rose-500/10 border-2 border-rose-500/30 rounded-2xl p-6 space-y-3">
                            <div className="flex items-start gap-3">
                                <AlertTriangle size={20} className="text-rose-500 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <div className="space-y-2">
                                    <p className="text-sm font-black text-rose-600 dark:text-rose-400 uppercase tracking-wide">Critical Warning</p>
                                    <ul className="text-xs font-bold text-rose-700 dark:text-rose-300 space-y-1 list-disc list-inside">
                                        <li>This action cannot be reversed or undone</li>
                                        <li>All associated data will be permanently deleted</li>
                                        <li>This may affect related records and reports</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Details Table for Review Mode */}
                    {details && details.length > 0 && (
                        <div className="bg-gray-50 dark:bg-black/20 rounded-3xl p-6 border border-gray-100 dark:border-white/5 space-y-3">
                            {details.map((detail, idx) => (
                                <div key={idx} className="flex justify-between items-start text-sm border-b last:border-0 border-gray-200 dark:border-white/5 pb-2 last:pb-0">
                                    <span className="font-black text-gray-400 uppercase tracking-widest text-[10px]">{detail.label}</span>
                                    <span className="font-bold text-dark dark:text-white text-right break-words max-w-[60%]">{detail.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={`px-10 py-8 ${isDelete ? (isCheckingDependencies ? 'bg-blue-50/50 dark:bg-blue-500/5' : isBlocked ? 'bg-amber-50/50 dark:bg-amber-500/5' : 'bg-rose-50/50 dark:bg-rose-500/5') : 'bg-gray-50 dark:bg-[#111814]'} border-t ${isDelete ? (isCheckingDependencies ? 'border-blue-200 dark:border-blue-500/20' : isBlocked ? 'border-amber-200 dark:border-amber-500/20' : 'border-rose-200 dark:border-rose-500/20') : 'border-gray-100 dark:border-white/5'} flex gap-4`}>
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-gray-500 hover:bg-gray-200 dark:hover:bg-white/5 transition-colors border border-gray-200 dark:border-white/10"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={isButtonDisabled ? undefined : onConfirm}
                        disabled={isButtonDisabled}
                        className={`flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all text-white flex items-center justify-center gap-2 ${isButtonDisabled
                            ? 'bg-gray-400 cursor-not-allowed opacity-50'
                            : isDelete
                                ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/30 border-2 border-rose-600 hover:scale-105'
                                : 'bg-dark dark:bg-brand dark:text-dark hover:bg-black hover:scale-105'
                            }`}
                    >
                        {isCheckingDependencies ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Checking...</span>
                            </>
                        ) : loading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Processing...</span>
                            </>
                        ) : isBlocked ? (
                            '🔒 Blocked'
                        ) : (
                            confirmLabel
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionDialog;
