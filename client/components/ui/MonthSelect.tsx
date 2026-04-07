import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Language, t } from '../../i18n/translations';
import {
    ALL_MONTHS_VALUE,
    MONTH_KEYS,
    getEnglishMonthName,
    getMonthName,
    getMonthOptions,
    getMonthYearLabel,
    getYearMonthValue,
    normalizeMonthSelectValue
} from '../../utils/months';
import { FormLabel } from './FormElements';

type MonthSelectValueMode = 'month-key' | 'english-name' | 'localized-label' | 'year-month';

interface MonthSelectProps {
    lang: Language;
    value: string;
    onChange: (value: string) => void;
    valueMode?: MonthSelectValueMode;
    years?: number[];
    label?: string;
    includeAllOption?: boolean;
    allValue?: string;
    allLabel?: string;
    className?: string;
    selectClassName?: string;
    disabled?: boolean;
}

const MonthSelect: React.FC<MonthSelectProps> = ({
    lang,
    value,
    onChange,
    valueMode = 'month-key',
    years,
    label,
    includeAllOption = false,
    allValue = ALL_MONTHS_VALUE,
    allLabel,
    className = '',
    selectClassName = '',
    disabled = false
}) => {
    const options = useMemo(() => {
        if (years?.length) {
            return years.flatMap((year) =>
                MONTH_KEYS.map((_, monthIndex) => ({
                    value:
                        valueMode === 'year-month'
                            ? getYearMonthValue(year, monthIndex)
                            : getMonthYearLabel(year, monthIndex, lang),
                    label: getMonthYearLabel(year, monthIndex, lang)
                }))
            );
        }

        if (valueMode === 'english-name') {
            return MONTH_KEYS.map((_, monthIndex) => ({
                value: getEnglishMonthName(monthIndex),
                label: getMonthName(monthIndex, lang)
            }));
        }

        return getMonthOptions(lang, valueMode === 'localized-label' ? 'localized-label' : 'month-key');
    }, [lang, valueMode, years]);

    const normalizedValue = normalizeMonthSelectValue(value, lang, valueMode, years);

    return (
        <div className={`space-y-2 ${className}`}>
            {label ? <FormLabel>{label}</FormLabel> : null}
            <div className="relative group">
                <select
                    value={normalizedValue}
                    onChange={(event) => onChange(event.target.value)}
                    disabled={disabled}
                    className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 pr-12 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white appearance-none cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${selectClassName}`}
                >
                    {includeAllOption ? (
                        <option value={allValue}>
                            {allLabel || String(t('common.allMonths', lang))}
                        </option>
                    ) : null}
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-focus-within:text-dark dark:group-focus-within:text-brand transition-colors">
                    <ChevronDown size={18} />
                </div>
            </div>
        </div>
    );
};

export default MonthSelect;
