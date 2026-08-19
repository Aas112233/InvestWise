import { formatMoney } from './currency';

export const formatCurrency = (
  amount: number | string,
  includeSymbolOrCurrency: boolean | string = true,
  currencyCode?: string
): string => {
  return formatMoney(amount, includeSymbolOrCurrency, currencyCode);
};

export const formatCompactNumber = (number: number | string): string => {
  const num = typeof number === 'string' ? parseFloat(number) : number;
  if (num === undefined || num === null || isNaN(num)) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toString();
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
