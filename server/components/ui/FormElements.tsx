import React from 'react';
import { X, ChevronDown, Check, AlertCircle, Loader2 } from 'lucide-react';

// --- Types ---
interface ModalFormProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    onSubmit: (e: React.FormEvent) => void;
    submitLabel?: string;
    maxWidth?: string;
    loading?: boolean;
}

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    icon?: React.ReactNode;
    error?: string;
    fullWidth?: boolean;
}

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
    icon?: React.ReactNode;
    options: { value: string | number; label: string; className?: string }[];
    error?: string;
    placeholder?: string;
}

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label: string;
    error?: string;
}

interface FormLabelProps {
    children: React.ReactNode;
    className?: string;
    required?: boolean;
}

// --- Components ---

export const FormLabel: React.FC<FormLabelProps> = ({ children, className = '', required }) => (
    <label className={`text-[10px] sm:text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1 mb-2 block ${className}`}>
        {children}
        {required && <span className="text-brand ml-1">*</span>}
    </label>
);

export const FormInput: React.FC<FormInputProps> = ({
    label,
    icon,
    error,
    className = '',
    fullWidth = true,
    required,
    ...props
}) => {
    return (
        <div className={`space-y-2 ${fullWidth ? 'w-full' : ''} ${className}`}>
            <FormLabel required={required}>{label}</FormLabel>
            <div className="relative group">
                <input
                    className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 ${icon ? 'pr-12' : ''} rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed`}
                    required={required}
                    {...props}
                />
                {icon && (
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-focus-within:text-dark dark:group-focus-within:text-brand transition-colors">
                        {icon}
                    </div>
                )}
            </div>
            {error && (
                <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 px-2 animate-in slide-in-from-left-1">
                    <AlertCircle size={10} /> {error}
                </p>
            )}
        </div>
    );
};

export const FormSelect: React.FC<FormSelectProps> = ({
    label,
    icon,
    options,
    error,
    className = '',
    required,
    placeholder,
    ...props
}) => {
    return (
        <div className={`space-y-2 w-full ${className}`}>
            <FormLabel required={required}>{label}</FormLabel>
            <div className="relative group">
                <select
                    className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 pr-12 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white appearance-none cursor-pointer transition-all disabled:opacity-50`}
                    required={required}
                    {...props}
                >
                    {placeholder && <option value="" className="text-gray-400">{placeholder}</option>}
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value} className={opt.className || "bg-white dark:bg-dark text-dark dark:text-white"}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-focus-within:text-dark dark:group-focus-within:text-brand transition-colors">
                    {icon || <ChevronDown size={18} />}
                </div>
            </div>
            {error && (
                <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 px-2 animate-in slide-in-from-left-1">
                    <AlertCircle size={10} /> {error}
                </p>
            )}
        </div>
    );
};

export const FormTextarea: React.FC<FormTextareaProps> = ({
    label,
    error,
    className = '',
    required,
    ...props
}) => {
    return (
        <div className={`space-y-2 w-full ${className}`}>
            <FormLabel required={required}>{label}</FormLabel>
            <textarea
                className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600 resize-none min-h-[120px]"
                required={required}
                {...props}
            />
            {error && (
                <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 px-2 animate-in slide-in-from-left-1">
                    <AlertCircle size={10} /> {error}
                </p>
            )}
        </div>
    );
};

export const ModalForm: React.FC<ModalFormProps> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    onSubmit,
    submitLabel = 'Submit',
    maxWidth = 'max-w-5xl',
    loading = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-dark/90 backdrop-blur-md animate-in fade-in duration-300">
            <div className={`bg-white dark:bg-[#1A221D] w-full ${maxWidth} rounded-[2.5rem] sm:rounded-[3.5rem] card-shadow overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-100 dark:border-white/10 flex flex-col max-h-[90vh]`}>

                {/* Header */}
                <div className="px-8 sm:px-12 pt-10 pb-6 flex justify-between items-start shrink-0">
                    <div>
                        <h3 className="text-2xl sm:text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">
                            {title}
                        </h3>
                        {subtitle && (
                            <p className="text-[10px] sm:text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.3em] sm:tracking-[0.4em]">
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 sm:p-4 -mr-2 -mt-2 text-gray-400 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl transition-all"
                    >
                        <X size={24} strokeWidth={3} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-8 sm:px-12 pb-8 no-scrollbar">
                    <form onSubmit={onSubmit} id="modal-form" className="h-full flex flex-col">
                        <div className="flex-1">
                            {children}
                        </div>
                    </form>
                </div>

                {/* Footer */}
                <div className="px-8 sm:px-12 py-8 border-t border-gray-100 dark:border-white/10 shrink-0 bg-white dark:bg-[#1A221D]">
                    <div className="flex items-center justify-end gap-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-8 py-4 rounded-[2rem] font-black text-xs uppercase tracking-widest text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            form="modal-form"
                            type="submit"
                            disabled={loading}
                            className={`bg-dark dark:bg-brand text-white dark:text-dark px-10 sm:px-14 py-5 rounded-[2.5rem] font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-brand/20 flex items-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" strokeWidth={3} /> : <Check size={18} strokeWidth={3} />}
                            {loading ? 'Thinking...' : submitLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
