import * as React from "react";
import { cn } from "@/lib/utils";

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
      if (isNumberType) {
        if (
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          e.key === "Backspace" ||
          e.key === "Delete" ||
          e.key === "Tab" ||
          e.key === "Enter" ||
          e.key === "Escape" ||
          e.key.startsWith("Arrow") ||
          e.key === "Home" ||
          e.key === "End"
        ) {
          onKeyDown?.(e);
          return;
        }

        if (e.key.length === 1) {
          if (/^[0-9]$/.test(e.key)) {
            onKeyDown?.(e);
            return;
          }

          if (e.key === "." || e.key === ",") {
            const val = e.currentTarget.value;
            if (!val.includes(".") && !val.includes(",")) {
              onKeyDown?.(e);
              return;
            }
          }

          if (e.key === "-") {
            const minNum = props.min !== undefined ? Number(props.min) : undefined;
            if (minNum === undefined || minNum < 0) {
              const val = e.currentTarget.value;
              if (!val.includes("-") && e.currentTarget.selectionStart === 0) {
                onKeyDown?.(e);
                return;
              }
            }
          }

          e.preventDefault();
          return;
        }
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
        if (/[^0-9.,-]/.test(text)) {
          e.preventDefault();
          const clean = text.replace(/[^0-9.,-]/g, "");
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
