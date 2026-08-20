"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "lime" | "pink" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Button({
  variant = "lime",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  const variants = {
    lime: "bg-lime text-void hover:bg-[#d8ff5e]",
    pink: "bg-pink text-void hover:bg-[#ff629f]",
    ghost: "bg-surface-2 text-ink border-line hover:border-lime",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-5 py-2.5 text-sm",
    lg: "px-7 py-3.5 text-base",
  };

  return (
    <button
      className={cx("btn-brut", variants[variant], sizes[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  interactive,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div className={cx("brut", interactive && "brut-hover", className)}>{children}</div>
  );
}

/// A labelled figure. Numbers use tabular mono so columns of stats stay aligned
/// as values tick over in real time.
export function Stat({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: ReactNode;
  accent?: "lime" | "pink" | "cyan" | "default";
  sub?: ReactNode;
}) {
  const accents = {
    lime: "text-lime",
    pink: "text-pink",
    cyan: "text-cyan",
    default: "text-ink",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className={cx("tabular text-xl font-bold", accents[accent ?? "default"])}>
        {value}
      </span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

/// Progress through the liquidity range. Fills lime, then flips to pink once the
/// curve is nearly exhausted and there is little supply left to buy.
export function CurveBar({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, progress * 100));
  const nearlyDone = pct > 85;
  return (
    <div
      className={cx("h-3 w-full border-2 border-line bg-void", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress through liquidity range"
    >
      <div
        className={cx(
          "h-full transition-[width] duration-500",
          nearlyDone ? "bg-pink" : "bg-lime",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = "line",
}: {
  children: ReactNode;
  tone?: "line" | "lime" | "pink" | "cyan" | "amber";
}) {
  const tones = {
    line: "border-line text-muted",
    lime: "border-lime text-lime",
    pink: "border-pink text-pink",
    cyan: "border-cyan text-cyan",
    amber: "border-amber text-amber",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 border-2 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-block size-1.5 rounded-full bg-lime animate-pulse-dot", className)}
      aria-hidden
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse bg-surface-2", className)} />;
}
