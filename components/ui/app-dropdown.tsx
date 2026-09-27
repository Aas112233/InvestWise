"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";

export interface DropdownOption {
  value: string;
  label: string;
  caption?: string;
  disabled?: boolean;
}

export interface AppDropdownProps {
  options: DropdownOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  loading?: boolean;
  error?: string | null;
  onSearch?: (query: string) => void;
  onRetry?: () => void;
  clearable?: boolean;
  id?: string;
}

// Searchable, portal-rendered dropdown. Never a native <select> (AGENTS.md rule 4).
// Parent→child rule: pass `disabled` + placeholder ("Select fund first…") until
// the parent is chosen, and reset child state on parent change (caller-owned).
export function AppDropdown({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  disabledHint,
  loading = false,
  error = null,
  onSearch,
  onRetry,
  clearable = true,
  id,
}: AppDropdownProps) {
  const { t } = useLocale();
  const defaultPlaceholder = placeholder ?? t("common.selectPlaceholder", { defaultValue: "Select…" });
  const searchPlaceholder = t("common.searchPlaceholder", { defaultValue: "Search…" });
  const clearLabel = t("common.clear", { defaultValue: "Clear" });
  const noMatchesLabel = t("common.noMatches", { defaultValue: "No matches found" });
  const generatedId = useId();
  const listId = id ?? `app-dropdown-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (onSearch) return options; // server-filtered
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.caption ?? "").toLowerCase().includes(q),
    );
  }, [options, query, onSearch]);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    searchRef.current?.focus();
    const onResize = () => updatePosition();
    const onScroll = () => updatePosition();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, updatePosition, close]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length, query]);

  const pick = useCallback(
    (option: DropdownOption) => {
      if (option.disabled) return;
      onChange(option.value);
      close();
      triggerRef.current?.focus();
    },
    [onChange, close],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) pick(option);
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlight="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={listId}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        title={disabled ? (disabledHint ?? placeholder) : undefined}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs text-left transition-colors bg-card text-foreground",
          error
            ? "border-destructive ring-1 ring-destructive"
            : "border-border/80 hover:border-primary/50",
          open && "ring-2 ring-ring border-primary",
          "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40",
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="truncate">
          {loading ? t("common.loading", { defaultValue: "Loading…" }) : (selected?.label ?? (disabled ? (disabledHint ?? defaultPlaceholder) : defaultPlaceholder))}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )}
        </span>
      </button>
      {error && (
        <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle size={12} />
          {error}
          {onRetry && (
            <button type="button" onClick={onRetry} className="underline font-medium">
              Retry
            </button>
          )}
        </p>
      )}
      {mounted && open && !disabled && !loading &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-labelledby={listId}
            onKeyDown={onListKeyDown}
            className="z-[100] rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100"
            style={{
              position: "absolute",
              top: position.top,
              left: position.left,
              width: Math.max(position.width, 180),
            }}
          >
            <div className="relative border-b border-border/70 bg-muted/20">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  onSearch?.(e.target.value);
                }}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-8 py-2 text-xs outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
              />
              {selected && clearable && (
                <button
                  type="button"
                  aria-label={t("ui.clearSelection", { defaultValue: "Clear selection" })}
                  onClick={() => {
                    onChange(null);
                    close();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
                >
                  {clearLabel}
                </button>
              )}
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {noMatchesLabel}
                </p>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = option.value === value;
                  const isHighlighted = index === highlight;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-highlight={isHighlighted}
                      disabled={option.disabled}
                      onClick={() => pick(option)}
                      onMouseEnter={() => setHighlight(index)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors",
                        isHighlighted && !isSelected && "bg-muted/60 text-foreground",
                        isSelected && "bg-primary/10 text-primary font-semibold",
                        !isSelected && !isHighlighted && "text-popover-foreground hover:bg-muted/40",
                        option.disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      <span className="truncate">
                        {option.label}
                        {option.caption && (
                          <span className="block text-[10px] font-normal text-muted-foreground truncate">
                            {option.caption}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check size={14} className="text-primary shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
