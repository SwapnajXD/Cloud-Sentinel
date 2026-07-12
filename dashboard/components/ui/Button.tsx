"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brass text-ink hover:brightness-110 disabled:brightness-75",
  secondary:
    "bg-panel2 text-mist border border-line hover:border-slate",
  ghost:
    "bg-transparent text-slate hover:text-mist",
  danger:
    "bg-transparent text-critical border border-critical/40 hover:bg-critical/10",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";

export default Button;
