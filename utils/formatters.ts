
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
    if (number === undefined || number === null) return '0';
    if (number >= 1000000) {
        return (number / 1000000).toFixed(2) + 'M';
    }
    if (number >= 1000) {
        return (number / 1000).toFixed(1) + 'k';
    }
    return number.toString();
};

export const formatDate = (date: any): string => {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}`;
};
