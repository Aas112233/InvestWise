/**
 * Converts numeric monetary amounts to legal financial words in English.
 * Example: 55000 -> "Fifty-Five Thousand BDT Only"
 * Example: 1250.50 -> "One Thousand Two Hundred Fifty BDT and Fifty Paisa Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertThreeDigits(num: number): string {
  let str = '';
  if (num >= 100) {
    str += ONES[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    str += TENS[Math.floor(num / 10)] + ' ';
    num %= 10;
  }
  if (num > 0) {
    str += ONES[num] + ' ';
  }
  return str.trim();
}

export function numberToWords(amount: number | string, currencyCode: string = 'BDT'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) {
    return `Zero ${currencyCode} Only`;
  }

  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const integerPart = Math.floor(absNum);
  const decimalPart = Math.round((absNum - integerPart) * 100);

  // South Asian Numbering System format support (Crore, Lakh, Thousand) or Western (Million, Billion)
  // Let's use international standard: Trillion, Billion, Million, Thousand, Units
  let result = '';

  const billions = Math.floor(integerPart / 1_000_000_000);
  let remainder = integerPart % 1_000_000_000;

  const millions = Math.floor(remainder / 1_000_000);
  remainder = remainder % 1_000_000;

  const thousands = Math.floor(remainder / 1_000);
  const units = remainder % 1_000;

  if (billions > 0) {
    result += convertThreeDigits(billions) + ' Billion ';
  }
  if (millions > 0) {
    result += convertThreeDigits(millions) + ' Million ';
  }
  if (thousands > 0) {
    result += convertThreeDigits(thousands) + ' Thousand ';
  }
  if (units > 0) {
    result += convertThreeDigits(units) + ' ';
  }

  result = result.trim();
  if (isNegative) {
    result = 'Minus ' + result;
  }

  if (decimalPart > 0) {
    const decimalWords = convertThreeDigits(decimalPart);
    return `${result} ${currencyCode} and ${decimalWords} Paisa Only`;
  }

  return `${result} ${currencyCode} Only`;
}

export default numberToWords;
