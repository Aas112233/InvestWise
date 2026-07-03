export const normalizeCurrencyCode = (value?: string | null): string => {
    if (!value) return '';

    const cleaned = String(value).trim().toUpperCase();
    const codeMatch = cleaned.match(/\b[A-Z]{3}\b/);
    if (codeMatch) return codeMatch[0];

    const firstToken = cleaned.split(/[\s(]/)[0].replace(/[^A-Z]/g, '');
    return /^[A-Z]{3}$/.test(firstToken) ? firstToken : '';
};

let activeCurrencyCode = '';

export const setActiveCurrencyCode = (value?: string | null) => {
    const normalized = normalizeCurrencyCode(value);
    if (normalized) {
        activeCurrencyCode = normalized;
    }
};

export const getActiveCurrencyCode = () => activeCurrencyCode;

export const formatMoney = (
    amount: number,
    includeSymbol: boolean = true,
    currencyCode?: string
): string => {
    const resolvedCode = normalizeCurrencyCode(currencyCode) || activeCurrencyCode;

    if (!resolvedCode) {
        return Number(amount || 0).toLocaleString('en-BD', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
    }

    return new Intl.NumberFormat('en-BD', {
        style: includeSymbol ? 'currency' : 'decimal',
        currency: resolvedCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(Number(amount || 0));
};
