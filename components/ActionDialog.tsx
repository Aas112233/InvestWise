import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X, Info } from 'lucide-react';

export type ActionType = 'delete' | 'confirm' | 'review';

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
    details
}) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isOpen) setVisible(true);
        else setTimeout(() => setVisible(false), 300);
    }, [isOpen]);

    if (!visible && !isOpen) return null;

    const isDelete = type === 'delete';

    return (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 transition-all duration-300 ${isOpen ? 'bg-dark/80 backdrop-blur-sm' : 'bg-transparent pointer-events-none'}`}>
            <div className={`w-full max-w-lg bg-white dark:bg-[#1A221D] rounded-[3rem] card-shadow border border-gray-100 dark:border-white/5 overflow-hidden transition-all duration-300 transform ${isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>

                {/* Header */}
                <div className={`px-10 py-8 border-b ${isDelete ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20' : 'bg-gray-50/50 dark:bg-white/5 border-gray-100 dark:border-white/5'} flex items-center gap-6`}>
                    <div className={`p-4 rounded-full ${isDelete ? 'bg-rose-100 text-rose-500 dark:bg-rose-500/20' : 'bg-brand/10 text-brand'}`}>
                        {isDelete ? <AlertTriangle size={28} strokeWidth={2.5} /> : <Info size={28} strokeWidth={2.5} />}
                    </div>
                    <div>
                        <h3 className={`text-2xl font-black uppercase tracking-tighter ${isDelete ? 'text-rose-600 dark:text-rose-400' : 'text-dark dark:text-white'}`}>
                            {title}
                        </h3>
                        {type === 'review' && <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Please review details before proceeding</p>}
                    </div>
                </div>

                {/* Body */}
                <div className="p-10 space-y-6">
                    <div className="text-gray-600 dark:text-gray-300 font-bold leading-relaxed">
                        {message}
                    </div>

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
                <div className="px-10 py-8 bg-gray-50 dark:bg-[#111814] border-t border-gray-100 dark:border-white/5 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-gray-500 hover:bg-gray-200 dark:hover:bg-white/5 transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 transition-all text-white ${isDelete ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' : 'bg-dark dark:bg-brand dark:text-dark hover:bg-black'}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionDialog;
