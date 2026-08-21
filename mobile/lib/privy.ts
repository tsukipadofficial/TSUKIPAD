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

/// Optional. Privy issues a separate client id for mobile apps.
export const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? "";

export const privyConfigured = PRIVY_APP_ID.length > 0;
