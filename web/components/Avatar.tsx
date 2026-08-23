"use client";

import { cx } from "./ui";

/// A profile picture, or a generated stand-in when there isn't one.
///
/// Most traders will never set an image, and a board of identical grey circles
/// is unreadable -- you lose the ability to track a name down a list. The
/// fallback derives a hue from the identity string, so the same wallet is the
/// same colour on every page and in every session without anything being stored.
export function Avatar({
  src,
  name,
  size = 36,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const seed = (name ?? "?").toLowerCase();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  // Strip the decoration a name arrives with, including the "0x" of a bare
  // address -- without this every unclaimed wallet initials to "0" and the
  // fallback stops distinguishing anything.
  const initial =
    (name ?? "?")
      .replace(/^[@#$]/, "")
      .replace(/^0x/i, "")
      .slice(0, 1)
      .toUpperCase() || "?";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={cx("shrink-0 border-2 border-line object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center border-2 border-line font-bold",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: `linear-gradient(135deg, hsl(${hue} 62% 22%), hsl(${(hue + 48) % 360} 62% 13%))`,
        color: `hsl(${hue} 85% 72%)`,
      }}
    >
      {initial}
    </span>
  );
}
