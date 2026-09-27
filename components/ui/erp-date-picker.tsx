"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppDropdown } from "./app-dropdown";

export interface ERPDatePickerProps {
  /** ISO wire value `yyyy-mm-dd` (Rule §8). */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Tenant display format, default `DD/MM/YYYY` (Rule §8). */
  displayFormat?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  /** ISO bounds. */
  min?: string | null;
  max?: string | null;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible calendar dates (e.g. 2026-02-30).
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function toIso(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Manual token formatting — never toLocaleDateString (Rule §8). */
export function formatDateDisplay(
  iso: string,
  displayFormat: string = "DD/MM/YYYY",
): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const dd = String(parsed.d).padStart(2, "0");
  const mm = String(parsed.m).padStart(2, "0");
  const yyyy = String(parsed.y);
  return displayFormat
    .replace("DD", dd)
    .replace("MM", mm)
    .replace("YYYY", yyyy);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function addDays(iso: string, delta: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const dt = new Date(parsed.y, parsed.m - 1, parsed.d + delta);
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  return { y: ny, m: idx - ny * 12 + 1 };
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Portal-rendered calendar date picker (Rule §8): tenant format for display,
// ISO yyyy-mm-dd on the wire. Never a raw <input type="date">.
export function ERPDatePicker({
  value,
  onChange,
  displayFormat = "DD/MM/YYYY",
  placeholder,
  disabled = false,
  clearable = true,
  id,
  min = null,
  max = null,
}: ERPDatePickerProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const today = useMemo(() => {
    const now = new Date();
    return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }, []);
  const parsed = value ? parseIsoDate(value) : null;
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    if (parsed) return { y: parsed.y, m: parsed.m };
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  });
  const [focusIso, setFocusIso] = useState<string>(value ?? today);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (value) {
      const p = parseIsoDate(value);
      if (p) {
        setView({ y: p.y, m: p.m });
        setFocusIso(value);
      }
    }
  }, [value]);

  const inBounds = useCallback(
    (iso: string): boolean => {
      if (min && iso < min) return false;
      if (max && iso > max) return false;
      return true;
    },
    [min, max],
  );

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 280),
    });
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onResize = () => updatePosition();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, updatePosition, close]);

  const pick = useCallback(
    (iso: string) => {
      if (!inBounds(iso)) return;
      onChange(iso);
      close();
      triggerRef.current?.focus();
    },
    [inBounds, onChange, close],
  );

  const moveView = useCallback((deltaMonths: number) => {
    setView((v) => {
      const next = addMonths(v.y, v.m, deltaMonths);
      return next;
    });
  }, []);

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const current = parseIsoDate(focusIso) ? focusIso : today;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(current);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = addDays(current, -1);
      setFocusIso(next);
      const p = parseIsoDate(next);
      if (p) setView({ y: p.y, m: p.m });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = addDays(current, 1);
      setFocusIso(next);
      const p = parseIsoDate(next);
      if (p) setView({ y: p.y, m: p.m });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = addDays(current, -7);
      setFocusIso(next);
      const p = parseIsoDate(next);
      if (p) setView({ y: p.y, m: p.m });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = addDays(current, 7);
      setFocusIso(next);
      const p = parseIsoDate(next);
      if (p) setView({ y: p.y, m: p.m });
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveView(e.shiftKey ? -12 : -1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveView(e.shiftKey ? 12 : 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = toIso(view.y, view.m, 1);
      setFocusIso(first);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = toIso(view.y, view.m, daysInMonth(view.y, view.m));
      setFocusIso(last);
    }
  };

  // Monday-first grid cells for the view month.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    // JS: 0=Sunday..6=Saturday → Monday-first offset.
    const lead = (first.getDay() + 6) % 7;
    const total = daysInMonth(view.y, view.m);
    const list: { iso: string; inMonth: boolean }[] = [];
    for (let i = lead - 1; i >= 0; i--) {
      const dt = new Date(view.y, view.m - 1, -i);
      list.push({
        iso: toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()),
        inMonth: false,
      });
    }
    for (let d = 1; d <= total; d++) {
      list.push({ iso: toIso(view.y, view.m, d), inMonth: true });
    }
    while (list.length % 7 !== 0 || list.length < 42) {
      const last = list[list.length - 1];
      if (!last) break;
      const next = addDays(last.iso, 1);
      const p = parseIsoDate(next);
      list.push({ iso: next, inMonth: p ? p.m === view.m : false });
      if (list.length >= 42) break;
    }
    return list;
  }, [view]);

  const monthOptions = useMemo(
    () =>
      MONTH_KEYS.map((key, idx) => ({
        value: String(idx + 1),
        label: t(`common.months.${key}`),
      })),
    [t],
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>([view.y, new Date().getFullYear()]);
    if (parsed) years.add(parsed.y);
    const current = new Date().getFullYear();
    for (let y = current - 20; y <= current + 20; y++) years.add(y);
    return [...years].sort((a, b) => a - b).map((y) => ({ value: String(y), label: String(y) }));
  }, [view.y, parsed]);

  const display = parsed ? formatDateDisplay(value as string, displayFormat) : "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs text-left transition-colors bg-card text-foreground border-border/80 hover:border-primary/50",
          open && "ring-2 ring-ring border-primary",
          "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40",
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          !parsed && "text-muted-foreground",
        )}
      >
        <span className="truncate">{display || placeholder || t("erp.datePicker.placeholder")}</span>
        <CalendarDays size={14} className="text-muted-foreground shrink-0" />
      </button>
      {mounted && open && !disabled &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t("erp.datePicker.dialogLabel")}
            className="z-[100] rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-xl p-3 w-[300px] animate-in fade-in-50 zoom-in-95 duration-100"
            style={{ position: "absolute", top: position.top, left: position.left }}
          >
            <div className="flex items-center gap-1 mb-2">
              <button
                type="button"
                onClick={() => moveView(-1)}
                aria-label={t("erp.datePicker.prevMonth")}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex-1 grid grid-cols-2 gap-1">
                <AppDropdown
                  options={monthOptions}
                  value={String(view.m)}
                  onChange={(v) => {
                    if (v) setView((prev) => ({ ...prev, m: Number(v) }));
                  }}
                  clearable={false}
                />
                <AppDropdown
                  options={yearOptions}
                  value={String(view.y)}
                  onChange={(v) => {
                    if (v) setView((prev) => ({ ...prev, y: Number(v) }));
                  }}
                  clearable={false}
                />
              </div>
              <button
                type="button"
                onClick={() => moveView(1)}
                aria-label={t("erp.datePicker.nextMonth")}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div
              role="grid"
              aria-label={t("erp.datePicker.dialogLabel")}
              tabIndex={0}
              onKeyDown={onGridKeyDown}
              className="outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <div role="row" className="grid grid-cols-7 mb-1">
                {WEEKDAY_KEYS.map((key) => (
                  <span
                    key={key}
                    className="text-center text-[10px] font-semibold text-muted-foreground uppercase"
                  >
                    {t(`common.weekdays.${key}`)}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell) => {
                  const p = parseIsoDate(cell.iso);
                  const day = p ? p.d : 0;
                  const isSelected = value === cell.iso;
                  const isToday = today === cell.iso;
                  const isFocused = focusIso === cell.iso;
                  const allowed = inBounds(cell.iso);
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      disabled={!allowed}
                      onClick={() => pick(cell.iso)}
                      onMouseEnter={() => setFocusIso(cell.iso)}
                      className={cn(
                        "h-8 rounded-lg text-xs transition-colors",
                        !cell.inMonth && "text-muted-foreground/40",
                        cell.inMonth && "text-foreground",
                        isSelected
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "hover:bg-muted hover:text-foreground",
                        isToday && !isSelected && "ring-1 ring-primary text-primary font-medium",
                        isFocused && !isSelected && "bg-muted",
                        !allowed && "opacity-30 cursor-not-allowed",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/80">
              <button
                type="button"
                onClick={() => pick(today)}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                {t("common.today")}
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    close();
                  }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
