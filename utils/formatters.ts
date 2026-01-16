
export const formatCurrency = (amount: number, includeSymbol: boolean = true): string => {
    const formatted = new Intl.NumberFormat('en-BD', {
        style: includeSymbol ? 'currency' : 'decimal',
        currency: 'BDT',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);

    return formatted;
};

export const formatCompactNumber = (number: number): string => {
    if (number >= 1000000) {
        return (number / 1000000).toFixed(2) + 'M';
    }
    if (number >= 1000) {
        return (number / 1000).toFixed(1) + 'k';
    }
    return number.toString();
};
