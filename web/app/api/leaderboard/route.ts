/// Rankings, and a single trader's book.
///
/// Realised profit is settled and stored. Unrealised is not: it moves with the
/// price, so it is computed at read time from the pools' current ticks rather
/// than written down and left to go stale. That costs one multicall per request
/// and means the number on screen is the number right now.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";

import { launchpadAbi, uniswapV3PoolAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, INDEXER_RPC_URL, chain } from "@/lib/config";
import { cmd, pipeline, redisConfigured } from "@/lib/redis";
import { K, revive } from "@/lib/indexer";
import { netPnl, unrealized, marketValue, avgEntryX18, type Position } from "@/lib/pnl";
import { priceX18FromSqrt } from "@/lib/launch-math";

export const dynamic = "force-dynamic";

const MAX_TRADERS = 200;
const TOP = 50;

type Row = {
  wallet: string;
  handle: string | null;
  display: string | null;
  netPnl: number;
  realized: number;
  unrealized: number;
  volume: number;
  positions: number;
};

/// Current price per whole token, scaled 1e18, for every launch.
async function prices(): Promise<Map<string, bigint>> {
  const pub = createPublicClient({ chain, transport: http(INDEXER_RPC_URL) });
  const launches = (await pub.readContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recentLaunches",
    args: [0n, 200n],
  })) as readonly { token: Address; pool: Address }[];

  if (launches.length === 0) return new Map();

  const slots = (await pub.multicall({
    contracts: launches.map((l) => ({
      address: l.pool, abi: uniswapV3PoolAbi, functionName: "slot0",
    })) as never,
    allowFailure: true,
  })) as { status: string; result?: unknown }[];

  const out = new Map<string, bigint>();
  launches.forEach((l, i) => {
    const r = slots[i];
    if (r.status !== "success") return;
    const sqrt = (r.result as readonly [bigint, ...unknown[]])[0];
    out.set(l.token.toLowerCase(), priceX18FromSqrt(sqrt));
  });
  return out;
}

export async function GET(req: NextRequest) {
  if (!redisConfigured) return NextResponse.json({ ok: true, rows: [], configured: false });

  const wallet = req.nextUrl.searchParams.get("wallet");
  const px = await prices();

  // One trader's book, with a row per token.
  if (wallet) {
    const tokens = (await cmd<string[]>("SMEMBERS", K.traderTokens(wallet))) ?? [];
    if (tokens.length === 0) {
      return NextResponse.json({ ok: true, wallet, totals: null, positions: [] });
    }
    const raw = await pipeline<string | null>(tokens.map((t) => ["GET", K.position(wallet, t)]));
    let realized = 0n, unreal = 0n, volume = 0n, value = 0n;
    const positions = tokens.flatMap((t, i) => {
      if (!raw[i]) return [];
      const p: Position = revive(raw[i] as string);
      const price = px.get(t.toLowerCase()) ?? 0n;
      realized += p.realizedUsdc;
      unreal += unrealized(p, price);
      volume += p.boughtUsdc + p.soldUsdc;
      value += marketValue(p, price);
      return [{
        token: t,
        tokens: p.tokens.toString(),
        value: Number(marketValue(p, price)) / 1e6,
        cost: Number(p.costUsdc) / 1e6,
        realized: Number(p.realizedUsdc) / 1e6,
        unrealized: Number(unrealized(p, price)) / 1e6,
        netPnl: Number(netPnl(p, price)) / 1e6,
        avgEntry: Number(avgEntryX18(p)) / 1e18,
        trades: p.trades,
        open: p.tokens > 0n,
      }];
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
      },
      positions,
    });
  }

  // The board. Traders are capped: ranking every wallet on every request would
  // grow into the request that times out on the busiest day of the year.
  const traders = ((await cmd<string[]>("SMEMBERS", K.traders)) ?? []).slice(0, MAX_TRADERS);
  const rows: Row[] = [];

  for (const w of traders) {
    const tokens = (await cmd<string[]>("SMEMBERS", K.traderTokens(w))) ?? [];
    if (tokens.length === 0) continue;
    const raw = await pipeline<string | null>(tokens.map((t) => ["GET", K.position(w, t)]));
    let realized = 0n, unreal = 0n, volume = 0n, open = 0;
    raw.forEach((r, i) => {
      if (!r) return;
      const p = revive(r as string);
      const price = px.get(tokens[i].toLowerCase()) ?? 0n;
      realized += p.realizedUsdc;
      unreal += unrealized(p, price);
      volume += p.boughtUsdc + p.soldUsdc;
      if (p.tokens > 0n) open++;
    });
    rows.push({
      wallet: w, handle: null, display: null,
      netPnl: Number(realized + unreal) / 1e6,
      realized: Number(realized) / 1e6,
      unrealized: Number(unreal) / 1e6,
      volume: Number(volume) / 1e6,
      positions: open,
    });
  }

  rows.sort((a, b) => b.netPnl - a.netPnl);
  const top = rows.slice(0, TOP);

  // Attach profiles so the board shows names rather than hex.
  if (top.length > 0) {
    const dids = await pipeline<string | null>(
      top.map((r) => ["GET", `profile:wallet:${r.wallet.toLowerCase()}`]),
    );
    const found = dids.map((d, i) => ({ i, did: d })).filter((x) => x.did);
    if (found.length > 0) {
      const profiles = await pipeline<string | null>(
        found.map((f) => ["GET", `profile:did:${f.did}`]),
      );
      found.forEach((f, k) => {
        if (!profiles[k]) return;
        const p = JSON.parse(profiles[k] as string);
        top[f.i].handle = p.handle;
        top[f.i].display = p.display;
      });
    }
  }

  return NextResponse.json({ ok: true, rows: top, traders: traders.length, configured: true });
}
