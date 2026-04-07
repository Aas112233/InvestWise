import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language } from '../../i18n/translations';
import { FormLabel } from './FormElements';
import { MONTH_KEYS, getCurrentMonthYearLabel, getMonthYearLabel, getShortMonthName, localizeMonthYearLabel, parseMonthYearLabel } from '../../utils/months';

interface MonthPickerFieldProps {
    label: string;
    value: string;
    lang: Language;
    onChange: (value: string) => void;
    required?: boolean;
    disabled?: boolean;
    className?: string;
}

const MonthPickerField: React.FC<MonthPickerFieldProps> = ({
    label,
    value,
    lang,
    onChange,
    required = false,
    disabled = false,
    className = ''
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const parsedValue = parseMonthYearLabel(value);
    const [pickerYear, setPickerYear] = useState(parsedValue?.year || new Date().getFullYear());

    useEffect(() => {
        if (parsedValue?.year) {
            setPickerYear(parsedValue.year);
        }
    }, [parsedValue?.year]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const displayValue = useMemo(() => {
        if (!value) return getCurrentMonthYearLabel(lang);
        return localizeMonthYearLabel(value, lang);
    }, [lang, value]);

    return (
        <div className={`space-y-2 relative ${className}`}>
            <FormLabel required={required}>{label}</FormLabel>
            <div className="relative">
                <input
                    required={required}
                    readOnly
                    disabled={disabled}
                    onClick={() => !disabled && setIsOpen((prev) => !prev)}
                    type="text"
                    value={displayValue}
                    className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                    type="button"
                    onClick={() => !disabled && setIsOpen((prev) => !prev)}
                    disabled={disabled}
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand transition-colors disabled:opacity-50"
                >
                    <Calendar size={18} />
                </button>

                {isOpen && !disabled && (
                    <>
                        <div className="fixed inset-0 bg-transparent z-[55]" onClick={() => setIsOpen(false)} />
                        <div
                            ref={pickerRef}
                            className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white dark:bg-[#1A221D] rounded-3xl border border-gray-100 dark:border-white/10 card-shadow p-6 animate-in zoom-in-95 duration-300"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <button
                                    type="button"
                                    onClick={() => setPickerYear((prev) => prev - 1)}
                                    className="p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl text-gray-400 hover:text-dark dark:hover:text-white transition-all"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <span className="text-xl font-black text-dark dark:text-white">{pickerYear}</span>
                                <button
                                    type="button"
                                    onClick={() => setPickerYear((prev) => prev + 1)}
                                    className="p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl text-gray-400 hover:text-dark dark:hover:text-white transition-all"
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {MONTH_KEYS.map((monthKey, monthIndex) => {
                                    const monthValue = getMonthYearLabel(pickerYear, monthIndex, lang);
                                    const isSelected = displayValue === monthValue;

                                    return (
                                        <button
                                            key={monthKey}
                                            type="button"
                                            onClick={() => {
                                                onChange(monthValue);
                                                setIsOpen(false);
                                            }}
                                            className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${isSelected
                                                ? 'bg-brand text-dark shadow-xl shadow-brand/20'
                                                : 'bg-gray-50 dark:bg-[#111814] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                                                }`}
                                        >
                                            {getShortMonthName(monthIndex, lang)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default MonthPickerField;
