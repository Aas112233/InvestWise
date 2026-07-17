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
  <label className={`text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block ${className}`}>
    {children}
    {required && <span className="text-red-500 ml-1">*</span>}
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
    <div className={`space-y-1.5 ${fullWidth ? 'w-full' : ''} ${className}`}>
      <FormLabel required={required}>{label}</FormLabel>
      <div className="relative group">
        <input
          className={`w-full bg-white dark:bg-slate-800 px-3 py-2 ${icon ? 'pr-10' : ''} rounded border border-gray-300 dark:border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed`}
          required={required}
          autoComplete="off"
          {...props}
        />
        {icon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
            {icon}
          </div>
        )}
      </div>
      {error && (
        <p className="text-[10px] font-medium text-red-500 flex items-center gap-1 px-1">
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
    <div className={`space-y-1.5 w-full ${className}`}>
      <FormLabel required={required}>{label}</FormLabel>
      <div className="relative group">
        <select
          className="w-full bg-white dark:bg-slate-800 px-3 py-2 pr-10 rounded border border-gray-300 dark:border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-900 dark:text-slate-100 appearance-none cursor-pointer disabled:opacity-50"
          required={required}
          {...props}
        >
          {placeholder && <option value="" className="text-gray-400">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className={opt.className || "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
          {icon || <ChevronDown size={14} />}
        </div>
      </div>
      {error && (
        <p className="text-[10px] font-medium text-red-500 flex items-center gap-1 px-1">
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
    <div className={`space-y-1.5 w-full ${className}`}>
      <FormLabel required={required}>{label}</FormLabel>
      <textarea
        className="w-full bg-white dark:bg-slate-800 px-3 py-2 rounded border border-gray-300 dark:border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 resize-none min-h-[100px]"
        required={required}
        {...props}
      />
      {error && (
        <p className="text-[10px] font-medium text-red-500 flex items-center gap-1 px-1">
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
  maxWidth = 'max-w-xl',
  loading = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 overflow-y-auto">
      <div className={`bg-white dark:bg-slate-900 w-full ${maxWidth} rounded shadow-lg overflow-hidden relative border border-gray-200 dark:border-gray-800 flex flex-col max-h-[95vh]`}>

        {/* Header */}
        <div className="px-6 py-4 flex justify-between items-start shrink-0 border-b border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-slate-900/50">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white leading-none mb-1">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-slate-800 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <form onSubmit={onSubmit} id="modal-form" className="h-full flex flex-col space-y-4">
            <div className="flex-1">
              {children}
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-xs font-medium text-slate-600 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              form="modal-form"
              type="submit"
              disabled={loading}
              className={`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-xs font-semibold flex items-center gap-1.5 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {loading ? 'Processing...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
