import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "default"
  | "primary"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";

export type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs",
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs",
  outline:
    "border border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-card/40 dark:hover:bg-muted/50",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:
    "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
  link: "text-primary underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-3 text-xs",
  xs: "h-6 gap-1 rounded-md px-2 text-[11px] [&_svg]:size-3",
  sm: "h-7 gap-1 rounded-lg px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-1.5 px-3 text-xs [&_svg]:size-3.5",
  lg: "h-9 gap-1.5 px-3.5 text-sm",
  icon: "size-8 rounded-lg",
  "icon-xs": "size-6 rounded-md [&_svg]:size-3",
  "icon-sm": "size-7 rounded-lg [&_svg]:size-3.5",
  "icon-lg": "size-9 rounded-xl",
};

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variantClasses[variant] || variantClasses.default,
    sizeClasses[size] || sizeClasses.default,
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  loading?: boolean;
  loadingText?: React.ReactNode;
  loadingLabel?: string;
  icon?: React.ReactNode | React.ComponentType<{ className?: string; size?: number }>;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      loading = false,
      loadingText,
      loadingLabel,
      icon: Icon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const renderIcon = () => {
      if (loading) {
        return <Loader2 className="mr-1.5 size-3.5 animate-spin shrink-0" />;
      }
      if (!Icon) return null;
      if (React.isValidElement(Icon)) {
        return <span className="mr-1.5 shrink-0 inline-flex items-center">{Icon}</span>;
      }
      if (typeof Icon === "function" || (typeof Icon === "object" && Icon !== null)) {
        const Component = Icon as React.ComponentType<{ className?: string; size?: number }>;
        return <Component size={14} className="mr-1.5 shrink-0" />;
      }
      return null;
    };

    const effectiveText =
      loading && (loadingText || loadingLabel) ? (loadingText || loadingLabel) : children;

    return (
      <button
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonVariants({ variant, size, className })}
        {...props}
      >
        {renderIcon()}
        {effectiveText}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button };
