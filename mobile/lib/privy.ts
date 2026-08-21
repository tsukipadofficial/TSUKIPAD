/// Privy configuration.
///
/// The app id is a public client identifier — it ships in the bundle and only
/// says which Privy app this is. It is hardcoded as a fallback so a fresh
/// clone builds without a .env, matching web/lib/config.ts.
///
/// The *app secret* is a different thing entirely: server-side only, and this
/// app never references it.
export const PRIVY_APP_ID =
  process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "cmt1u8i3r01v10dicbnswb0k4";

/// Native apps have no origin for Privy to check, so allowed-origins cannot
/// cover them — mobile authenticates with a per-platform *client* instead.
/// Also a public identifier. The client must list this app's bundle id
/// (com.tsukipad.app) and URL scheme (tsukipad) in the Privy dashboard, or
/// login will be rejected.
export const PRIVY_CLIENT_ID =
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ??
  "client-WY6ctnwhj9eBGwRxKW1PeBNRCAyYfiSbKvZYYN2q4ynQw";

export const privyConfigured = PRIVY_APP_ID.length > 0;
