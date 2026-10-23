/**
 * Amount in words for printed financial documents.
 *
 * A numeric-only amount is the cheapest thing to alter on a printed or edited
 * sheet (1,50,000 → 15,00,000), so the words line is the tamper evidence a
 * receipt carries. Uses the South-Asian lakh/crore scale, which is how BDT
 * amounts are actually written on vouchers in this market.
 *
 * ponytail: English words only. The digit words themselves are computed, not
 * UI copy, so the 4-locale rule applies to the label, not the figure — and a
 * Bangladeshi voucher in any script still carries an English words line.
 * Upgrade path: localise ONES/TENS and the scale nouns per locale, behind the
 * same signature.
 */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * South-Asian grouping: arab, crore, lakh, thousand, then the final three
 * digits. "Hundred" is deliberately not a group of its own — it belongs to the
 * 3-digit chunk it sits in, so 250 is "two hundred and fifty", never
 * "two hundred and fifty hundred".
 */
function takaInWords(amount: number): string {
  if (amount === 0) return "zero taka";
  let remaining = amount;
  const parts: string[] = [];
  const take = (divisor: number, unit: string) => {
    const group = Math.floor(remaining / divisor);
    remaining %= divisor;
    if (group > 0) parts.push(unit ? `${under1000(group)} ${unit}` : under1000(group));
  };
  take(1_00_00_00_000, "arab");
  take(1_00_00_000, "crore");
  take(1_00_000, "lakh");
  take(1_000, "thousand");
  take(1, "");
  return `${parts.join(" ")} taka`;
}
function under100(n: number): string {
  if (n < 20) return ONES[n] ?? "zero";
  const ten = TENS[Math.floor(n / 10)] ?? "";
  const rest = n % 10;
  return rest === 0 ? ten : `${ten}-${ONES[rest] ?? ""}`;
}

/** 0..999 → English words. */
function under1000(n: number): string {
  if (n < 100) return under100(n);
  const rest = n % 100;
  return rest === 0 ? `${ONES[Math.floor(n / 100)]} hundred` : `${ONES[Math.floor(n / 100)]} hundred and ${under100(rest)}`;
}

/**
 * "15000.5" → "fifteen thousand taka and fifty poisha only".
 * Returns null for non-finite values so the caller can omit the line instead
 * of printing a sentence about an unusable amount.
 */
export function amountInWords(amount: number | string | null | undefined): string | null {
  // A blank string coerces to 0 in Number(), which would print "zero taka" on a
  // document whose amount was simply not supplied.
  if (typeof amount === "string" && amount.trim() === "") return null;
  const value = typeof amount === "string" ? Number(amount.replace(/[, ]/g, "")) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const negative = value < 0;
  const abs = Math.abs(value);
  // Round to the paisa first, then split — otherwise 0.999 renders as
  // "zero taka and ninety-nine poisha".
  const cents = Math.round(abs * 100);
  const whole = Math.floor(cents / 100);
  const poisha = cents % 100;
  const taka = takaInWords(whole);
  const words =
    poisha === 0
      ? `${taka} only`
      : poisha === 1
        ? `${taka} and one poisha only`
        : poisha === 2
          ? `${taka} and two poisha only`
          : `${taka} and ${under100(poisha)} poisha only`;
  return negative ? `minus ${words}` : words;
}
