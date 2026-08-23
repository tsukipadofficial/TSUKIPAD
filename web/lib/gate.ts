/// Whether the site is open, or closed behind the waitlist.
///
/// One flag, read by both the edge middleware and the client, so the nav and
/// the redirect can never disagree about what is reachable. Public rather than
/// server-only for exactly that reason: the header has to know too.
///
/// Flip to "1" in the Vercel project and redeploy to open the site.
export const SITE_OPEN = process.env.NEXT_PUBLIC_SITE_OPEN === "1";
