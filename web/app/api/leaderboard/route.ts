/// Rankings, and a single trader's book.
///
/// Realised profit is settled and stored. Unrealised is not: it moves with the
/// price, so it is computed at read time from the pools' current ticks rather
/// than written down and left to go stale. That costs one multicall per request
/// and means the number on screen is the number right now.

import { NextRequest, NextResponse } from "next/server";

import { cmd, pipeline, redisConfigured } from "@/lib/redis";
import { K, revive } from "@/lib/indexer";
import { topEarners } from "@/lib/earnings";
import { launchMeta, mcapFromPriceX18, type LaunchMeta } from "@/lib/launchmeta";
import { netPnl, unrealized, marketValue, avgEntryX18, type Position } from "@/lib/pnl";

export const dynamic = "force-dynamic";

const MAX_TRADERS = 200;
const TOP = 50;

/// Shared-cache lifetime. Positions only move when the indexer runs, and every
/// open leaderboard polls this every 30s, so a 10s CDN copy collapses a crowd
/// into one Redis walk without anyone seeing a number the indexer has not
/// written yet.
const CACHE = { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" };

type Row = {
  wallet: string;
  handle: string | null;
  display: string | null;
  avatar: string | null;
  netPnl: number;
  realized: number;
  unrealized: number;
  volume: number;
  positions: number;
};

/// A single position, enriched enough to render without a second lookup.
function positionRow(token: string, p: Position, m: LaunchMeta | undefined) {
  const price = m?.priceX18 ?? 0n;
  const entryX18 = avgEntryX18(p);
  return {
    token,
    name: m?.name ?? null,
    symbol: m?.symbol ?? null,
    image: m?.image ?? null,
    tokens: p.tokens.toString(),
    value: Number(marketValue(p, price)) / 1e6,
    cost: Number(p.costUsdc) / 1e6,
    spent: Number(p.boughtUsdc) / 1e6,
    realized: Number(p.realizedUsdc) / 1e6,
    unrealized: Number(unrealized(p, price)) / 1e6,
    netPnl: Number(netPnl(p, price)) / 1e6,
    avgEntry: Number(entryX18) / 1e18,
    // Memecoin entries are quoted as market cap, not as a price with five
    // leading zeros. Needs the supply, so it is null for an unknown token.
    entryMcap: m ? mcapFromPriceX18(entryX18, m.supply) : null,
    marketCap: m?.marketCapUsd ?? null,
    trades: p.trades,
    open: p.tokens > 0n,
  };
}

/// Attach profiles so boards show names and faces rather than hex.
async function decorate(rows: { wallet: string; handle: string | null; display: string | null; avatar: string | null }[]) {
  if (rows.length === 0) return;
  const dids = await pipeline<string | null>(
    rows.map((r) => ["GET", `profile:wallet:${r.wallet.toLowerCase()}`]),
  );
  const found = dids.map((d, i) => ({ i, did: d })).filter((x) => x.did);
  if (found.length === 0) return;
  const profiles = await pipeline<string | null>(
    found.map((f) => ["GET", `profile:did:${f.did}`]),
  );
  found.forEach((f, k) => {
    if (!profiles[k]) return;
    const pr = JSON.parse(profiles[k] as string);
    rows[f.i].handle = pr.handle ?? null;
    rows[f.i].display = pr.display ?? null;
    rows[f.i].avatar = pr.avatar ?? null;
  });
}

export async function GET(req: NextRequest) {
  if (!redisConfigured) return NextResponse.json({ ok: true, rows: [], configured: false });

  const wallet = req.nextUrl.searchParams.get("wallet");
  const mode = req.nextUrl.searchParams.get("mode");

  // ---- one trader's book -------------------------------------------------
  if (wallet) {
    // The chain read and the first Redis read do not depend on each other.
    const [meta, tokens] = await Promise.all([
      launchMeta(),
      cmd<string[]>("SMEMBERS", K.traderTokens(wallet)).then((t) => t ?? []),
    ]);
    if (tokens.length === 0) {
      return NextResponse.json({ ok: true, wallet, totals: null, positions: [] }, { headers: CACHE });
    }
    // Lifetime earnings ride the same round trip as the positions.
    const raw = await pipeline<string | null>([
      ...tokens.map((t): (string | number)[] => ["GET", K.position(wallet, t)]),
      ["GET", `earn:total:${wallet.toLowerCase()}`],
    ]);
    const earnedRaw = raw[tokens.length];
    let realized = 0n, unreal = 0n, volume = 0n, value = 0n, spent = 0n;
    const positions = tokens.flatMap((t, i) => {
      if (!raw[i]) return [];
      const p: Position = revive(raw[i] as string);
      const m = meta.get(t.toLowerCase());
      const price = m?.priceX18 ?? 0n;
      realized += p.realizedUsdc;
      unreal += unrealized(p, price);
      volume += p.boughtUsdc + p.soldUsdc;
      value += marketValue(p, price);
      spent += p.boughtUsdc;
      return [positionRow(t, p, m)];
    });
    positions.sort((a, b) => b.netPnl - a.netPnl);

    return NextResponse.json({
      ok: true, wallet,
      totals: {
        netPnl: Number(realized + unreal) / 1e6,
        realized: Number(realized) / 1e6,
        unrealized: Number(unreal) / 1e6,
        volume: Number(volume) / 1e6,
        value: Number(value) / 1e6,
        spent: Number(spent) / 1e6,
        // Fees this wallet has been paid by the launchpad, which is income, not
        // a trading result -- kept out of netPnl so the two never blur.
        earned: earnedRaw ? Number(BigInt(earnedRaw)) / 1e6 : 0,
      },
      positions,
    }, { headers: CACHE });
  }

  // ---- top earners -------------------------------------------------------
  if (mode === "earners") {
    const raw = await topEarners(TOP);
    const rows = raw.map((e) => ({
      wallet: e.wallet, handle: null as string | null, display: null as string | null,
      avatar: null as string | null, earned: e.earned,
    }));
    await decorate(rows);
    return NextResponse.json({ ok: true, rows, configured: true }, { headers: CACHE });
  }

  // ---- the PNL board -----------------------------------------------------
  // Traders are capped: ranking every wallet on every request would grow into
  // the request that times out on the busiest day of the year.
  const [meta, traders] = await Promise.all([
    launchMeta(),
    cmd<string[]>("SMEMBERS", K.traders).then((t) => (t ?? []).slice(0, MAX_TRADERS)),
  ]);
  const rows: Row[] = [];
  // Every position anyone holds, so the best individual trades can be surfaced
  // without a second pass over the same data.
  const allTrades: { wallet: string; row: ReturnType<typeof positionRow> }[] = [];

  // Two round trips for the whole board, not two per trader. Upstash is a REST
  // hop away, so at 200 traders the per-wallet loop this replaces spent most
  // of the request waiting on the network rather than on Redis.
  const tokenLists = traders.length
    ? await pipeline<string[] | null>(traders.map((w) => ["SMEMBERS", K.traderTokens(w)]))
    : [];
  const reads: { w: string; tokens: string[] }[] = traders.flatMap((w, i) => {
    const tokens = tokenLists[i] ?? [];
    return tokens.length > 0 ? [{ w, tokens }] : [];
  });
  const positions = reads.length
    ? await pipeline<string | null>(
        reads.flatMap(({ w, tokens }) => tokens.map((t): (string | number)[] => ["GET", K.position(w, t)])),
      )
    : [];

  let cursor = 0;
  for (const { w, tokens } of reads) {
    const raw = positions.slice(cursor, cursor + tokens.length);
    cursor += tokens.length;
    let realized = 0n, unreal = 0n, volume = 0n, open = 0;
    raw.forEach((r, i) => {
      if (!r) return;
      const p = revive(r as string);
      const m = meta.get(tokens[i].toLowerCase());
      const price = m?.priceX18 ?? 0n;
      realized += p.realizedUsdc;
      unreal += unrealized(p, price);
      volume += p.boughtUsdc + p.soldUsdc;
      if (p.tokens > 0n) open++;
      allTrades.push({ wallet: w, row: positionRow(tokens[i], p, m) });
    });
    rows.push({
      wallet: w, handle: null, display: null, avatar: null,
      netPnl: Number(realized + unreal) / 1e6,
      realized: Number(realized) / 1e6,
      unrealized: Number(unreal) / 1e6,
      volume: Number(volume) / 1e6,
      positions: open,
    });
  }

  rows.sort((a, b) => b.netPnl - a.netPnl);
  const top = rows.slice(0, TOP);

  const topTrades = allTrades
    .sort((a, b) => b.row.netPnl - a.row.netPnl)
    .slice(0, 12)
    .map((x) => ({ wallet: x.wallet, handle: null as string | null, display: null as string | null, avatar: null as string | null, ...x.row }));

  // Independent lists, so their profile lookups overlap.
  await Promise.all([decorate(top), decorate(topTrades)]);

  return NextResponse.json({
    ok: true, rows: top, topTrades, traders: traders.length, configured: true,
  }, { headers: CACHE });
}
