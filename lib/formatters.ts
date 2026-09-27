/**
 * Universal date, time, and money formatting helpers adhering to InvestWise ERP standards.
 * Complies with AGENTS.md §8:
 * - Dates: tenant format DD/MM/YYYY for display, ISO wire format.
 * - Money: decimal(15,2) 2dp string boundary, zero float artifacts.
 */

export const formatMoney = (
  amount: number | string | null | undefined,
  currencyCode: string = "BDT",
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string => {
  if (amount === null || amount === undefined || amount === "") return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "-";

  const minDigits = options?.minimumFractionDigits ?? 2;
  const maxDigits = options?.maximumFractionDigits ?? 2;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "BDT",
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    }).format(num);
  } catch {
    return `${currencyCode || "BDT"} ${num.toLocaleString("en-US", {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    })}`;
  }
};

export const formatCompactNumber = (number: number | string | null | undefined): string => {
  if (number === null || number === undefined || number === "") return "0";
  const num = typeof number === "string" ? parseFloat(number) : number;
  if (isNaN(num)) return "0";
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
};

export const formatDate = (
  date: string | Date | null | undefined,
  includeTime: boolean = false
): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  if (!includeTime) {
    return `${day}/${month}/${year}`;
  }

  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

export const toIsoDateString = (date: Date): string => {
  return date.toISOString().split("T")[0]!;
};

// Manual token formatting against a tenant dateFormat pattern
// (default DD/MM/YYYY). Never toLocaleDateString (Rule §8).
export const formatDatePattern = (
  date: string | Date | null | undefined,
  pattern: string = "DD/MM/YYYY",
  includeTime: boolean = false,
): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  let out = pattern.replace("DD", day).replace("MM", month).replace("YYYY", year);
  if (includeTime) {
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    out += ` ${hours}:${minutes}`;
  }
  return out;
};
