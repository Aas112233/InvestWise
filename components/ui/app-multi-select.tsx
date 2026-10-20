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
import { Check, ChevronDown, Search } from "lucide-react";
import { useIsomorphicLayoutEffect } from "@/lib/use-isomorphic-layout-effect";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import type { DropdownOption } from "./app-dropdown";

export interface AppMultiSelectProps {
  /** Candidate options; rows are toggled, the panel stays open. */
  options: readonly DropdownOption[];
  /** Currently selected option values. */
  values: readonly string[];
  /**
   * Fires with the new value list and the option that was just pressed
   * (`toggled` is the pressed row — `values` alone cannot distinguish
   * "unchecked one" from "checked one" in a multi-select).
   */
  onChange: (values: string[], toggled?: DropdownOption) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  /**
   * Optional "select all" entry pinned above the option list (e.g. reports'
   * "All members"). The parent owns the semantics — the component only
   * renders the checkbox state and forwards the toggle, so "all" can mean
   * something richer than "every row currently in the list".
   */
  allEntry?: { label: string; active: boolean; onToggle: (active: boolean) => void };
  id?: string;
}

// Searchable, portal-rendered MULTI-select. Same positioning and pointerdown
// commit discipline as AppDropdown (AGENTS.md rule 4): never a native
// <select>, and the picked row is the row actually pressed.
const PANEL_GAP_PX = 4;
const PANEL_MIN_WIDTH_PX = 180;

function CheckboxGlyph({ checked }: { checked: boolean }) {
  return checked ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground">
      <Check size={11} strokeWidth={3} />
    </span>
  ) : (
    <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-border bg-card" />
  );
}

export function AppMultiSelect({
  options,
  values,
  onChange,
  placeholder,
  disabled = false,
  disabledHint,
  allEntry,
  id,
}: AppMultiSelectProps) {
  const { t } = useLocale();
  const defaultPlaceholder = placeholder ?? t("common.selectPlaceholder", { defaultValue: "Select…" });
  const searchPlaceholder = t("common.searchPlaceholder", { defaultValue: "Search…" });
  const clearLabel = t("common.clear", { defaultValue: "Clear" });
  const noMatchesLabel = t("common.noMatches", { defaultValue: "No matches found" });
  const generatedId = useId();
  const listId = id ?? `app-multi-select-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const valueSet = useMemo(() => new Set(values), [values]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.caption ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const hasSelection = values.length > 0 || allEntry?.active === true;

  const triggerLabel = useMemo(() => {
    if (allEntry?.active) return allEntry.label;
    if (values.length === 0) return null;
    if (values.length === 1) {
      const first = values[0];
      // A selected value missing from the options list (member deleted
      // between render and open) must not print a raw uuid.
      return options.find((o) => o.value === first)?.label ?? t("common.removedOption", { defaultValue: "(removed)" });
    }
    return t("common.selectedCount", { count: values.length, defaultValue: "{count} selected" });
  }, [allEntry, values, options, t]);

  const placePanel = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = listRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    // Viewport rect + current scroll = document coordinates, which is what
    // position:absolute on a direct child of <body> resolves against.
    panel.style.top = `${Math.round(rect.bottom + window.scrollY + PANEL_GAP_PX)}px`;
    panel.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    panel.style.width = `${Math.max(Math.round(rect.width), PANEL_MIN_WIDTH_PX)}px`;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    placePanel();
    // preventScroll: focusing a field the browser considers off-screen scrolls
    // the document. The panel is already placed where it belongs.
    searchRef.current?.focus({ preventScroll: true });
    const onResize = () => placePanel();
    const onScroll = () => placePanel();
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
    // capture: true — scrolls from inner scrollers never bubble to window, and
    // the panel must follow them.
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, placePanel, close]);

  const hasAllEntry = allEntry !== undefined;
  useEffect(() => {
    // With a search active the highlight must land on the first MATCH, not
    // the "all" entry — otherwise typing a name and pressing Enter silently
    // selects "All members".
    setHighlight(hasAllEntry && query.trim() !== "" ? 1 : 0);
  }, [filtered.length, query, hasAllEntry]);

  // Flipping `disabled` while the panel is open: close it, or the trigger
  // would stay stuck in the open-ring state and the next click would close.
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  const toggleOption = useCallback(
    (option: DropdownOption) => {
      if (option.disabled) return;
      onChange(
        valueSet.has(option.value)
          ? values.filter((v) => v !== option.value)
          : [...values, option.value],
        option,
      );
    },
    [valueSet, values, onChange],
  );

  const toggleAll = useCallback(() => {
    if (!allEntry) return;
    allEntry.onToggle(!allEntry.active);
  }, [allEntry]);

  // Rows the keyboard walks: the pinned "all" entry first, then the
  // (search-filtered) options. `highlight` indexes into that sequence.
  const rowCount = (allEntry ? 1 : 0) + filtered.length;

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, rowCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allEntry && highlight === 0) toggleAll();
      else {
        const option = filtered[allEntry ? highlight - 1 : highlight];
        if (option) toggleOption(option);
      }
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlight="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  // aria-activedescendant target for the search input (which holds focus).
  const activeDescendantId = (() => {
    if (hasAllEntry && highlight === 0) return `${listId}-all`;
    const optionIndex = hasAllEntry ? highlight - 1 : highlight;
    if (optionIndex >= 0 && optionIndex < filtered.length) return `${listId}-opt-${optionIndex}`;
    return undefined;
  })();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={listId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (disabled) return;
          // ArrowDown/Enter/Space open the panel from the collapsed trigger,
          // matching AppDropdown.
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => (open ? close() : setOpen(true))}
        title={disabled ? (disabledHint ?? placeholder) : undefined}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs text-left transition-colors bg-card text-foreground",
          "border-border/80 hover:border-primary/50",
          open && "ring-2 ring-ring border-primary",
          "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40",
          "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          !triggerLabel && "text-muted-foreground",
        )}
      >
        <span className="truncate">
          {triggerLabel ?? (disabled ? (disabledHint ?? defaultPlaceholder) : defaultPlaceholder)}
        </span>
        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
      </button>
      {mounted && open && !disabled &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-multiselectable
            aria-labelledby={listId}
            onKeyDown={onListKeyDown}
            className="z-[100] rounded-xl border border-border/80 dark:border-white/10 bg-popover text-popover-foreground shadow-xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100"
            // top/left/width are written onto this node by placePanel() in a
            // layout effect, before the first paint.
            style={{ position: "absolute" }}
          >
            <div className="relative border-b border-border/70 bg-muted/20">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-activedescendant={activeDescendantId}
                className="w-full pl-9 pr-8 py-2 text-xs outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
              />
              {hasSelection && (
                <button
                  type="button"
                  aria-label={t("ui.clearSelection", { defaultValue: "Clear selection" })}
                  onClick={() => {
                    if (allEntry?.active) allEntry.onToggle(false);
                    onChange([]);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
                >
                  {clearLabel}
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {allEntry && (
                <button
                  type="button"
                  id={`${listId}-all`}
                  role="option"
                  aria-selected={allEntry.active}
                  data-highlight={highlight === 0}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    toggleAll();
                  }}
                  // Keyboard/assistive activation path (see AppDropdown).
                  onClick={(e) => {
                    if (e.detail === 0) toggleAll();
                  }}
                  onMouseEnter={() => setHighlight(0)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                    highlight === 0 && !allEntry.active && "bg-muted/60 text-foreground",
                    allEntry.active && "bg-primary/10 text-primary font-semibold",
                    !allEntry.active && highlight !== 0 && "text-popover-foreground hover:bg-muted/40",
                  )}
                >
                  <CheckboxGlyph checked={allEntry.active} />
                  <span className="truncate">{allEntry.label}</span>
                </button>
              )}
              {filtered.length === 0 ? (
                // role=option keeps the listbox's children valid ARIA (a bare
                // <p> is not an option).
                 <button
                   type="button"
                   role="option"
                   aria-selected={false}
                   aria-disabled="true"
                   className="w-full px-3 py-4 text-xs text-muted-foreground text-center cursor-default"
                 >
                  {noMatchesLabel}
                </button>
              ) : (
                filtered.map((option, index) => {
                  const row = allEntry ? index + 1 : index;
                  const isSelected = valueSet.has(option.value);
                  const isHighlighted = row === highlight;
                  return (
                    <button
                      key={option.value}
                      id={`${listId}-opt-${index}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-highlight={isHighlighted}
                      disabled={option.disabled}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return; // primary button only
                        if (option.disabled) return;
                        e.preventDefault();
                        e.stopPropagation();
                        // Multi-select: commit the toggle but keep the panel
                        // open so several members can be picked in one pass.
                        toggleOption(option);
                      }}
                      // Keyboard/assistive activation path.
                      onClick={(e) => {
                        if (e.detail === 0) toggleOption(option);
                      }}
                      onMouseEnter={() => setHighlight(row)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                        isHighlighted && !isSelected && "bg-muted/60 text-foreground",
                        isSelected && "bg-primary/10 text-primary font-semibold",
                        !isSelected && !isHighlighted && "text-popover-foreground hover:bg-muted/40",
                        option.disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      <CheckboxGlyph checked={isSelected} />
                      <span className="truncate">
                        {option.label}
                        {option.caption && (
                          <span className="block text-[10px] font-normal text-muted-foreground truncate">
                            {option.caption}
                          </span>
                        )}
                      </span>
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
