/// Everything that identifies the product, in one place.
///
/// Circle's Arc Brand Guidelines prohibit incorporating "Arc" into a product
/// name, and give partners **three business days** to comply once a change is
/// requested. Centralising the brand here means a rename is a one-file edit
/// rather than a hunt through components, metadata and translations.
///
/// The logo mark is deliberately name-free (a price curve, not a letterform),
/// so it survives a rename untouched.

/// Product name, split so the second half can be accented in the wordmark.
/// e.g. NAME_HEAD="TSUKI", NAME_TAIL="PAD" renders as TSUKI**PAD**.
export const NAME_HEAD = "TSUKI";
export const NAME_TAIL = "PAD";

/// Full product name, for metadata and prose.
export const NAME = `${NAME_HEAD}${NAME_TAIL}`;

/// Canonical origin. Update alongside the domain if the name changes.
export const SITE_URL = "https://www.tsukipad.com";

/// Official accounts. Kept here with the rest of the identity so a handle
/// change is a one-file edit, same as a rename.
export const X_URL = "https://x.com/tsukipad_";
export const TELEGRAM_URL = "https://t.me/tsukipadofficial";

/// Descriptive tagline. Uses only phrasing the Arc guidelines permit —
/// "built on Arc Network" positions Arc as infrastructure, not as our identity.
export const TAGLINE = "launch tokens on Arc Network";

export const DESCRIPTION =
  "Fair-launch tokens straight into a Uniswap V3 USDC pool, built on Arc Network. No presale, no seed capital, liquidity locked forever.";

export const SOCIAL_DESCRIPTION =
  "Launch at $3K into a real Uniswap V3 pool. Single-sided liquidity, so it costs you nothing. Locked forever.";

/// Namespace for anything persisted in the browser. Renaming the product must
/// not silently reset a returning visitor's language choice, so this key is
/// intentionally decoupled from NAME.
export const STORAGE_PREFIX = "launchpad";

/// Required by the Arc Brand Guidelines wherever the Arc name appears.
export const TRADEMARK_NOTICE =
  "Arc is a trademark of Circle Internet Group, Inc. This project is not affiliated with or endorsed by Circle.";
