export const normalizeCurrencyCode = (value?: string | null): string => {
    if (!value) return '';

    const cleaned = String(value).trim().toUpperCase();
    const codeMatch = cleaned.match(/\b[A-Z]{3}\b/);
    if (codeMatch) return codeMatch[0];

    const firstToken = cleaned.split(/[\s(]/)[0].replace(/[^A-Z]/g, '');
    return /^[A-Z]{3}$/.test(firstToken) ? firstToken : '';
};

let activeCurrencyCode = 'BDT';

export const setActiveCurrencyCode = (value?: string | null) => {
    const normalized = normalizeCurrencyCode(value);
    if (normalized) {
        activeCurrencyCode = normalized;
    }
};

export const getActiveCurrencyCode = () => activeCurrencyCode || 'BDT';

export const formatMoney = (
    amount: number | string,
    includeSymbolOrCurrency?: boolean | string,
    currencyCode?: string
): string => {
    let includeSymbol = true;
    let explicitCode: string | undefined = undefined;

    if (typeof includeSymbolOrCurrency === 'string') {
        explicitCode = includeSymbolOrCurrency;
        includeSymbol = true;
    } else if (typeof includeSymbolOrCurrency === 'boolean') {
        includeSymbol = includeSymbolOrCurrency;
        explicitCode = currencyCode;
    } else if (currencyCode) {
        explicitCode = currencyCode;
    }

    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    const validAmount = isNaN(num) ? 0 : num;

    const resolvedCode = normalizeCurrencyCode(explicitCode) || activeCurrencyCode || 'BDT';

    if (!includeSymbol) {
        return validAmount.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
    }

    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: resolvedCode,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(validAmount);
    } catch {
        return `${resolvedCode} ${validAmount.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        })}`;
    }
};
