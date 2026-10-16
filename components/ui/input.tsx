import * as React from "react";
import { cn } from "@/lib/utils";
import { blocksNumericKey, sanitizeNumericPaste } from "@/lib/numeric-input";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isNumeric?: boolean;
  isPhone?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, isNumeric, isPhone, onKeyDown, onPaste, onWheel, ...props }, ref) => {
    const isNumberType =
      Boolean(isNumeric) ||
      type === "number" ||
      props.inputMode === "numeric" ||
      props.inputMode === "decimal";

    const isPhoneType = Boolean(isPhone) || type === "tel" || props.inputMode === "tel";

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isNumberType && blocksNumericKey(e, { min: props.min })) {
        e.preventDefault();
        return;
      }

      if (isPhoneType && e.key.length === 1 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        if (!/^[0-9+\-() ]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
      }

      onKeyDown?.(e);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (isNumberType) {
        const text = e.clipboardData?.getData("text") || "";
        const clean = sanitizeNumericPaste(text, { min: props.min });
        if (clean !== text) {
          e.preventDefault();
          if (clean) {
            try {
              document.execCommand("insertText", false, clean);
            } catch {}
          }
          onPaste?.(e);
          return;
        }
      }
      if (isPhoneType) {
        const text = e.clipboardData?.getData("text") || "";
        if (/[^0-9+\-() ]/.test(text)) {
          e.preventDefault();
          const clean = text.replace(/[^0-9+\-() ]/g, "");
          if (clean) {
            try {
              document.execCommand("insertText", false, clean);
            } catch {}
          }
          onPaste?.(e);
          return;
        }
      }
      onPaste?.(e);
    };

    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      if (type === "number") {
        e.currentTarget.blur();
      }
      onWheel?.(e);
    };

    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-lg border border-input bg-card px-3 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onWheel={handleWheel}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
