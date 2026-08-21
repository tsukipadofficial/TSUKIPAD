/// Identifying a signed-in user server-side, without the app secret.
///
/// Privy's access token is a JWT signed by the app's own key, and the public
/// half is published at a JWKS endpoint. Verifying it therefore needs nothing
/// secret -- which matters, because binding a referral should not require the
/// same credential that can read every user's linked accounts.
///
/// It yields the user's Privy id and nothing else. That is exactly enough to
/// key a referral to an account rather than to a browser.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { PRIVY_APP_ID } from "./config";

const JWKS = createRemoteJWKSet(
  new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`),
);

/// Returns the Privy user id (a `did:privy:...`), or null if the token is not
/// a valid, unexpired token issued for this app.
export async function privyUserId(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const { payload } = await jwtVerify(accessToken, JWKS, {
      issuer: "privy.io",
      audience: PRIVY_APP_ID,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
