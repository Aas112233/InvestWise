"use client";

import { useLocale } from "@/lib/i18n";
import { AppDropdown, type DropdownOption } from "./app-dropdown";
import { ERPFormField } from "./erp-form-layout";

export interface FiscalMonthOption {
  /** Stable month key, e.g. "01".."12" or "JAN".. Keep as string on the wire. */
  value: string;
  label: string;
}

export interface FiscalMonthValue {
  fiscalYear: string | null;
  month: string | null;
}

export interface ERPFiscalMonthPickerProps {
  /** Dynamic fiscal year array, e.g. ["2024-25", "2025-26"]. */
  fiscalYears: string[];
  /** Dynamic month array for the selected fiscal year. */
  months: FiscalMonthOption[];
  value: FiscalMonthValue;
  onChange: (next: FiscalMonthValue) => void;
  disabled?: boolean;
  monthsLoading?: boolean;
  yearLabel?: string;
  monthLabel?: string;
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
}: ERPFiscalMonthPickerProps) {
  const { t } = useLocale();

  const yearOptions: DropdownOption[] = fiscalYears.map((fy) => ({ value: fy, label: fy }));
  const monthOptions: DropdownOption[] = months.map((m) => ({ value: m.value, label: m.label }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <ERPFormField label={yearLabel ?? t("erp.fiscalMonth.fiscalYear")}>
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
      <ERPFormField label={monthLabel ?? t("erp.fiscalMonth.month")}>
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
