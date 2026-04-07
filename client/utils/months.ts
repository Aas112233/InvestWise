import { Language, t, translations } from '../i18n/translations';

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
export const ALL_MONTHS_VALUE = 'all';

type MonthKey = (typeof MONTH_KEYS)[number];

const ENGLISH_MONTH_NAMES = MONTH_KEYS.map((key) => translations.en.common.months[key]);

const normalizeBanglaDigits = (value = '') =>
    value.replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));

const monthLookup = (() => {
    const lookup = new Map<string, number>();

    MONTH_KEYS.forEach((key, index) => {
        lookup.set(key, index);
    });

    (['en', 'bn'] as Language[]).forEach((lang) => {
        MONTH_KEYS.forEach((key, index) => {
            const fullName = String(t(`common.months.${key}`, lang)).toLowerCase();
            lookup.set(fullName, index);
            lookup.set(fullName.substring(0, 3), index);
        });
    });

    ENGLISH_MONTH_NAMES.forEach((month, index) => {
        lookup.set(month.toLowerCase(), index);
        lookup.set(month.substring(0, 3).toLowerCase(), index);
    });

    return lookup;
})();

export const getMonthName = (monthIndex: number, lang: Language) =>
    String(t(`common.months.${MONTH_KEYS[monthIndex]}`, lang));

export const getShortMonthName = (monthIndex: number, lang: Language) =>
    getMonthName(monthIndex, lang).substring(0, 3);

export const getEnglishMonthName = (monthIndex: number) => ENGLISH_MONTH_NAMES[monthIndex];

export const getMonthYearLabel = (year: number, monthIndex: number, lang: Language) =>
    `${getMonthName(monthIndex, lang)} ${year}`;

export const getYearMonthValue = (year: number, monthIndex: number) =>
    `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

export const getMonthIndex = (value: string) => {
    if (!value) return -1;

    const normalized = normalizeBanglaDigits(value.trim()).toLowerCase();
    return monthLookup.get(normalized) ?? -1;
};

export const parseYearMonthValue = (value: string) => {
    if (!value) return null;

    const normalized = normalizeBanglaDigits(value.trim());
    const dateMatch = normalized.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!dateMatch) return null;

    const year = Number(dateMatch[1]);
    const monthIndex = Number(dateMatch[2]) - 1;

    if (Number.isNaN(year) || monthIndex < 0 || monthIndex > 11) {
        return null;
    }

    return { year, monthIndex };
};

export const parseMonthYearLabel = (value: string) => {
    if (!value) return null;

    const normalized = normalizeBanglaDigits(value.trim());
    const dateValue = parseYearMonthValue(normalized);
    if (dateValue) return dateValue;

    const parts = normalized.split(/\s+/);
    if (parts.length < 2) return null;

    const year = Number(parts[parts.length - 1]);
    const monthLabel = parts.slice(0, -1).join(' ');
    const monthIndex = getMonthIndex(monthLabel);

    if (Number.isNaN(year) || monthIndex === -1) {
        return null;
    }

    return { year, monthIndex };
};

export const localizeMonthLabel = (value: string, lang: Language, short = false) => {
    const monthIndex = getMonthIndex(value);
    if (monthIndex === -1) return value;

    return short ? getShortMonthName(monthIndex, lang) : getMonthName(monthIndex, lang);
};

export const localizeMonthYearLabel = (value: string, lang: Language) => {
    const parsed = parseMonthYearLabel(value);
    if (!parsed) return value;

    return getMonthYearLabel(parsed.year, parsed.monthIndex, lang);
};

export const monthYearLabelToDateInput = (value: string) => {
    const parsed = parseMonthYearLabel(value);
    if (!parsed) return '';

    return `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, '0')}-01`;
};

export const getCurrentMonthYearLabel = (lang: Language, offset = 0) => {
    const now = new Date();
    now.setMonth(now.getMonth() + offset);
    return getMonthYearLabel(now.getFullYear(), now.getMonth(), lang);
};

export const getMonthYearOptions = (years: number[], lang: Language) =>
    years.flatMap((year) =>
        MONTH_KEYS.map((_, monthIndex) => ({
            value: getMonthYearLabel(year, monthIndex, lang),
            label: getMonthYearLabel(year, monthIndex, lang)
        }))
    );

export const getMonthOptions = (
    lang: Language,
    valueMode: 'month-key' | 'english-name' | 'localized-label' = 'month-key'
) =>
    MONTH_KEYS.map((key, monthIndex) => ({
        value:
            valueMode === 'english-name'
                ? getEnglishMonthName(monthIndex)
                : valueMode === 'localized-label'
                    ? getMonthName(monthIndex, lang)
                    : key,
        label: getMonthName(monthIndex, lang)
    }));

export const normalizeMonthSelectValue = (
    value: string,
    lang: Language,
    valueMode: 'month-key' | 'english-name' | 'localized-label' | 'year-month',
    years?: number[]
) => {
    if (!value) return value;

    if (value === ALL_MONTHS_VALUE) return value;

    if (valueMode === 'year-month') {
        const parsed = parseMonthYearLabel(value);
        return parsed ? getYearMonthValue(parsed.year, parsed.monthIndex) : value;
    }

    if (valueMode === 'localized-label') {
        const parsed = parseMonthYearLabel(value);
        if (parsed) {
            return getMonthYearLabel(parsed.year, parsed.monthIndex, lang);
        }

        const monthIndex = getMonthIndex(value);
        return monthIndex === -1 ? value : getMonthName(monthIndex, lang);
    }

    const monthIndex = getMonthIndex(value);
    if (monthIndex === -1) return value;

    if (valueMode === 'english-name') {
        return getEnglishMonthName(monthIndex);
    }

    const monthKey = MONTH_KEYS[monthIndex];
    if (!years?.length) return monthKey;

    return monthKey;
};

export type { MonthKey };
