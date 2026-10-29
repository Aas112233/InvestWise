"use client";

import { useLocale } from "@/lib/i18n";
import { AppDropdown, type DropdownOption } from "./app-dropdown";
import { ERPFormField } from "./erp-form-layout";

export interface FiscalMonthOption {
  /** Stable option value. Keep as string on the wire. */
  value: string;
  label: string;
  /**
   * Months a caller must not offer (e.g. a member already holds a deposit for
   * it). Passed through to the dropdown verbatim — a picker that rebuilt the
   * option from `value`/`label` alone would silently drop it and leave an
   * occupied month selectable.
   */
  disabled?: boolean;
  /** Secondary line under the label (e.g. "already deposited · 5,000.00"). */
  caption?: string;
}

export interface FiscalMonthValue {
  /** Fiscal start year ("2025" for FY 2025-26 on a July-start tenant). */
  fiscalYear: string | null;
  /** Absolute calendar month ("2026-03") — what the API period fields take. */
  month: string | null;
}

export interface ERPFiscalMonthPickerProps {
  /** Dynamic fiscal year array, e.g. [{ value: "2025", label: "FY 2025-26" }]. */
  fiscalYears: FiscalMonthOption[];
  /**
   * Months of the selected fiscal year, in fiscal order. Callers build these
   * from `useFiscalPeriodOptions().monthsFor(value.fiscalYear)` so the list
   * follows the tenant's fiscal calendar rather than a fixed Jan–Dec array.
   */
  months: FiscalMonthOption[];
  value: FiscalMonthValue;
  onChange: (next: FiscalMonthValue) => void;
  disabled?: boolean;
  monthsLoading?: boolean;
  yearLabel?: string;
  monthLabel?: string;
  /** Marks both fields as required (entry forms; filters leave it off). */
  required?: boolean;
  /** Validation message for the composite period, shown under the month. */
  error?: string;
}

// Fiscal month picker over dynamic fiscal arrays (Rule §8): dropdowns only,
// never free text. Child (month) stays disabled until the parent (fiscal
// year) is chosen, and a parent change resets the child immediately.
export function ERPFiscalMonthPicker({
  fiscalYears,
  months,
  value,
  onChange,
  disabled = false,
  monthsLoading = false,
  yearLabel,
  monthLabel,
  required = false,
  error,
}: ERPFiscalMonthPickerProps) {
  const { t } = useLocale();

  const yearOptions: DropdownOption[] = fiscalYears.map((fy) => ({ value: fy.value, label: fy.label }));
  // Pass each month through as given: callers mark occupied months `disabled`
  // (and caption why), and rebuilding the option here would strip that flag.
  const monthOptions: DropdownOption[] = months;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <ERPFormField label={yearLabel ?? t("erp.fiscalMonth.fiscalYear")} required={required}>
        <AppDropdown
          options={yearOptions}
          value={value.fiscalYear}
          onChange={(fiscalYear) =>
            onChange({
              fiscalYear,
              // Parent change resets child state immediately (Rule §5).
              month: fiscalYear === value.fiscalYear ? value.month : null,
            })
          }
          placeholder={t("erp.fiscalMonth.selectYear")}
          disabled={disabled}
        />
      </ERPFormField>
      <ERPFormField
        label={monthLabel ?? t("erp.fiscalMonth.month")}
        required={required}
        error={error}
      >
        <AppDropdown
          options={monthOptions}
          value={value.month}
          onChange={(month) => onChange({ ...value, month })}
          placeholder={t("erp.fiscalMonth.selectMonth")}
          disabled={disabled || !value.fiscalYear}
          disabledHint={t("erp.fiscalMonth.selectYearFirst")}
          loading={monthsLoading}
        />
      </ERPFormField>
    </div>
  );
}
