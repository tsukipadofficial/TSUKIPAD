/// Minimal Upstash REST client.
///
/// The whole surface we need is "run one Redis command" and "run several", so a
/// ~40 line fetch wrapper beats pulling in an SDK. Works with either env var
/// naming: Vercel's KV integration exports KV_REST_API_*, the Upstash
/// marketplace integration exports UPSTASH_REDIS_REST_*.

const URL_ =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

/// True when a store is wired up. The waitlist route returns a clear 503
/// rather than a stack trace when it isn't, so local dev without a store still
/// renders the page.
export const redisConfigured = Boolean(URL_ && TOKEN);

type Cmd = (string | number)[];

async function call<T>(body: unknown, path = ""): Promise<T> {
  if (!redisConfigured) throw new Error("redis-not-configured");
  const res = await fetch(`${URL_}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/// One command. Returns the raw `result` field.
export async function cmd<T = unknown>(...parts: Cmd): Promise<T> {
  const { result } = await call<{ result: T }>(parts);
  return result;
}

/// Several commands in one round trip. Order of results matches input.
///
/// Upstash serves batched commands from a dedicated `/pipeline` endpoint --
/// posting an array of arrays to the base URL is rejected, which fails only
/// once a request actually writes.
export async function pipeline<T = unknown>(cmds: Cmd[]): Promise<T[]> {
  if (cmds.length === 0) return [];
  const out = await call<{ result: T }[]>(cmds, "/pipeline");
  return out.map((r) => r.result);
}
