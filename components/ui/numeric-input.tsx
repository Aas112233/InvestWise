"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { blocksNumericKey, sanitizeNumericPaste } from "@/lib/numeric-input";

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /**
   * Rendered input type. Defaults to `text` (fully controlled by the guard
   * above); pass `number` to keep native number semantics — e.g.
   * react-hook-form's `valueAsNumber` and native `min`/`step` validation.
   */
  type?: "text" | "number";
  /** Allow a decimal point (`.`). Default true. */
  allowDecimal?: boolean;
  /** Allow a leading minus. Default: derived from `min`. */
  allowNegative?: boolean;
}

/**
 * A numeric text/number field that only accepts digits (plus an optional
 * decimal point and, where `min` allows, a leading minus). Blocks letters,
 * `e`/`E`, `+`, spaces and other noise on keypress and strips them from
 * pasted text, so a "number field" can never hold a non-number.
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      className,
      type = "text",
      allowDecimal = true,
      allowNegative,
      min,
      inputMode,
      onKeyDown,
      onPaste,
      onWheel,
      ...props
    },
    ref,
  ) => {
    const guard = { allowDecimal, allowNegative, min };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (blocksNumericKey(e, guard)) {
        e.preventDefault();
        return;
      }
      onKeyDown?.(e);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData?.getData("text") ?? "";
      const clean = sanitizeNumericPaste(text, guard);
      if (clean !== text) {
        e.preventDefault();
        if (clean) {
          const el = e.currentTarget;
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          const next = el.value.slice(0, start) + clean + el.value.slice(end);
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          setter?.call(el, next);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      onPaste?.(e);
    };

    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      // Scrolling over a number input silently changes its value.
      if (type === "number") e.currentTarget.blur();
      onWheel?.(e);
    };

    return (
      <input
        ref={ref}
        type={type}
        min={min}
        inputMode={
          inputMode ?? (type === "number" ? undefined : allowDecimal ? "decimal" : "numeric")
        }
        className={cn(className)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onWheel={handleWheel}
        {...props}
      />
    );
  },
);
NumericInput.displayName = "NumericInput";
