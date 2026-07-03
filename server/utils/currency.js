export const normalizeCurrencyCode = (value) => {
    if (!value) return '';

    const cleaned = String(value).trim().toUpperCase();
    const codeMatch = cleaned.match(/\b[A-Z]{3}\b/);
    if (codeMatch) return codeMatch[0];

    const firstToken = cleaned.split(/[\s(]/)[0].replace(/[^A-Z]/g, '');
    return /^[A-Z]{3}$/.test(firstToken) ? firstToken : '';
};

export const formatMoney = (amount, currencyCode, includeSymbol = true) => {
    const resolvedCode = normalizeCurrencyCode(currencyCode);

    if (!resolvedCode) {
        return Number(amount || 0).toLocaleString('en-BD', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    return new Intl.NumberFormat('en-BD', {
        style: includeSymbol ? 'currency' : 'decimal',
        currency: resolvedCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Number(amount || 0));
};
