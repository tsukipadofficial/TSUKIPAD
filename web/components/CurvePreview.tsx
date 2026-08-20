"use client";

import { useId } from "react";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { priceMultipleAtFractionSold } from "@/lib/launch-math";

/// Plots price against the share of supply sold — the curve a buyer actually
/// walks. It is genuinely convex: because a Uniswap V3 range holds constant
/// liquidity, the last tokens cost dramatically more than the first. Plotting
/// against tick progress instead would draw a straight line and hide that.
///
/// The y axis is logarithmic, since a 1000x range is otherwise a flat line with
/// a wall at the end.
export function CurvePreview({
  startTick,
  endTick,
  startMcap,
  ceilingMcap,
  progress,
  capacityUsd,
  className,
}: {
  startTick: number;
  endTick: number;
  startMcap: number;
  ceilingMcap: number;
  /// Fraction of supply already sold, 0..1.
  progress?: number;
  capacityUsd?: number;
  className?: string;
}) {
  const t = useT();
  const gradientId = useId();
  const W = 320;
  const H = 130;
  const PAD = 4;

  const maxMultiple = ceilingMcap / startMcap;
  const logMax = Math.log(maxMultiple);

  const yFor = (multiple: number) => {
    const t = Math.min(1, Math.max(0, Math.log(multiple) / logMax));
    return H - PAD - t * (H - PAD * 2);
  };

  const steps = 64;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    // Stop just short of 1: price goes vertical as the last token is sold.
    const f = (i / steps) * 0.995;
    const multiple = priceMultipleAtFractionSold(startTick, endTick, f);
    const x = PAD + (i / steps) * (W - PAD * 2);
    points.push(`${x.toFixed(1)},${yFor(multiple).toFixed(1)}`);
  }

  const markerX = progress !== undefined ? PAD + progress * (W - PAD * 2) : null;
  const markerY =
    progress !== undefined
      ? yFor(priceMultipleAtFractionSold(startTick, endTick, Math.min(progress, 0.995)))
      : null;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Price curve from ${formatUsd(startMcap)} to ${formatUsd(ceilingMcap)} market cap as supply sells out`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#c8ff2e" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#c8ff2e" stopOpacity="0.28" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={PAD}
            x2={W - PAD}
            y1={PAD + g * (H - PAD * 2)}
            y2={PAD + g * (H - PAD * 2)}
            stroke="#2c2c35"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}

        <polygon
          points={`${PAD},${H - PAD} ${points.join(" ")} ${W - PAD},${H - PAD}`}
          fill={`url(#${gradientId})`}
        />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="#c8ff2e"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {markerX !== null && markerY !== null ? (
          <>
            <line
              x1={markerX}
              x2={markerX}
              y1={PAD}
              y2={H - PAD}
              stroke="#29e5f5"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <circle cx={markerX} cy={markerY} r="4.5" fill="#29e5f5" />
            <circle cx={markerX} cy={markerY} r="8" fill="#29e5f5" opacity="0.25" />
          </>
        ) : null}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[0.6875rem] text-faint">
        <span className="tabular">{t("curve.start", { amount: formatUsd(startMcap) })}</span>
        {capacityUsd !== undefined ? (
          <span className="tabular text-muted">{t("curve.toFill", { amount: formatUsd(capacityUsd) })}</span>
        ) : null}
        <span className="tabular">{t("curve.ceiling", { amount: formatUsd(ceilingMcap) })}</span>
      </div>
    </div>
  );
}
