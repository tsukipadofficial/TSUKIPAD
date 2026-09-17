"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

import { cx } from "./ui";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";

/// [time, open, high, low, close, volume] — market cap in USD, one minute wide.
type Candle = [number, number, number, number, number, number];

const TIMEFRAMES = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3_600 },
  { label: "4h", seconds: 14_400 },
  { label: "1D", seconds: 86_400 },
] as const;

const POLL_MS = 8_000;

/// Roll one-minute candles up into a coarser timeframe.
function rollUp(candles: Candle[], seconds: number): Candle[] {
  if (seconds === 60) return candles;
  const out: Candle[] = [];
  for (const [t, o, h, l, c, v] of candles) {
    const bucket = Math.floor(t / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last[0] === bucket) {
      last[2] = Math.max(last[2], h);
      last[3] = Math.min(last[3], l);
      last[4] = c;
      last[5] += v;
    } else {
      out.push([bucket, o, h, l, c, v]);
    }
  }
  return out;
}

/// The site's colours, read from its theme tokens so the chart follows the
/// light/dark switch instead of hard-coding one palette.
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--color-muted", "#8c8c99"),
    grid: v("--color-line", "#2c2c35"),
    up: v("--color-lime", "#c8ff2e"),
    down: v("--color-pink", "#ff3d8b"),
    ath: v("--color-amber", "#ffb020"),
    surface: v("--color-surface", "#121216"),
  };
}

/// Pick the most recent timeframe that shows a meaningful number of candles:
/// a token with an hour of trading reads best on 1m, one with a week on 1h.
function defaultTimeframe(candles: Candle[]): number {
  if (candles.length < 2) return 60;
  const span = candles[candles.length - 1][0] - candles[0][0];
  if (span > 3 * 86_400) return 3_600;
  if (span > 12 * 3_600) return 900;
  if (span > 2 * 3_600) return 300;
  return 60;
}

export function PriceChart({ token, openingMcap }: { token: string; openingMcap?: number }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const athRef = useRef<IPriceLine | null>(null);
  const fitted = useRef(false);

  const [raw, setRaw] = useState<Candle[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [tf, setTf] = useState<number | null>(null);

  // Fetch, then keep polling. Failures keep the last good candles on screen.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/chart?token=${token}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { candles?: Candle[]; complete?: boolean };
        if (cancelled || !Array.isArray(body.candles)) return;
        setRaw(body.candles);
        setComplete(body.complete !== false);
      } catch {
        /* next tick retries */
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  const timeframe = tf ?? (raw ? defaultTimeframe(raw) : 60);
  const candles = useMemo(() => (raw ? rollUp(raw.map((c) => [...c] as Candle), timeframe) : []), [raw, timeframe]);

  // Build the chart once.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const colors = themeColors();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.Dotted },
        horzLines: { color: colors.grid, style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: colors.grid, scaleMargins: { top: 0.12, bottom: 0.25 } },
      // A normal candle width from the start: fitting a handful of candles to
      // the full width drew each one as a fat block.
      timeScale: { borderColor: colors.grid, timeVisible: true, secondsVisible: false, barSpacing: 12, rightOffset: 6 },
      localization: { priceFormatter: (p: number) => formatUsd(p) },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: "custom", formatter: (p: number) => formatUsd(p), minMove: 0.01 },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    // Re-read the palette when the site's theme switch flips.
    const observer = new MutationObserver(() => {
      const c = themeColors();
      chart.applyOptions({
        layout: { textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.grid },
        timeScale: { borderColor: c.grid },
      });
      candle.applyOptions({
        upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down,
        wickUpColor: c.up, wickDownColor: c.down,
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      athRef.current = null;
    };
  }, []);

  // Push data whenever the candles or timeframe change.
  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candle || !volume || !chart) return;
    const colors = themeColors();

    candle.setData(
      candles.map(([time, open, high, low, close]) => ({ time: time as UTCTimestamp, open, high, low, close })),
    );
    volume.setData(
      candles.map(([time, open, , , close, v]) => ({
        time: time as UTCTimestamp,
        value: v,
        color: `${close >= open ? colors.up : colors.down}55`,
      })),
    );

    if (athRef.current) {
      candle.removePriceLine(athRef.current);
      athRef.current = null;
    }
    if (candles.length > 1) {
      const ath = Math.max(...candles.map((c) => c[2]));
      athRef.current = candle.createPriceLine({
        price: ath,
        color: colors.ath,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "ATH",
      });
    }
    if (!fitted.current && candles.length > 0) {
      // Fit only when there is enough history to fill the width; otherwise sit
      // the latest candles at the right edge at their natural width.
      if (candles.length > 90) chart.timeScale().fitContent();
      else {
        chart.timeScale().applyOptions({ barSpacing: 12 });
        chart.timeScale().scrollToRealTime();
      }
      fitted.current = true;
    }
  }, [candles]);

  const empty = raw !== null && raw.length === 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex border-2 border-line" role="group" aria-label={t("chart.timeframe")}>
          {TIMEFRAMES.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setTf(f.seconds);
                fitted.current = false;
              }}
              aria-pressed={timeframe === f.seconds}
              className={cx(
                "tabular px-2.5 py-1 text-xs font-bold transition-colors",
                timeframe === f.seconds ? "bg-lime text-void" : "text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="tabular text-xs text-faint">
          {!complete ? t("chart.loadingHistory") : t("chart.mcapUsd")}
        </span>
      </div>

      <div className="relative h-[340px] w-full sm:h-[380px]">
        <div ref={box} className="absolute inset-0" />
        {raw === null || empty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-muted">{raw === null ? t("chart.loading") : t("chart.noTrades")}</p>
            {empty && openingMcap ? (
              <p className="tabular text-xs text-faint">{t("chart.opensAt", { mcap: formatUsd(openingMcap) })}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
