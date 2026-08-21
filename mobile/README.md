# TSUKIPAD — iOS app

A native iOS client for the TSUKIPAD launchpad, built with Expo / React Native.
It is **not** a WebView wrapper: every screen is native, and all data is read
straight from Arc testnet over JSON-RPC with `viem`.

## What it does

| Screen | |
|---|---|
| **Board** | Every launch, read live from `recentLaunches` on the launchpad contract. Market cap is derived from the pool's `slot0` price, not from an API. Pull to refresh; auto-refreshes every 20s. |
| **Token** | Live price sampled from the pool every 5s and drawn as a sparkline, plus supply, age, pool address, burn total and the creator lock countdown. |
| **Wallet** | Watch-only. Enter any address to see its USDC balance and every launchpad token it holds, valued at the live pool price. |
| **About** | How a launch works, the deployed addresses, and links out. |

## Running it

```bash
cd mobile
npm install --legacy-peer-deps
bash scripts/patch-expo-xcode26.sh
npx expo run:ios
```

Requires Xcode with an iOS simulator. First build takes a few minutes while
CocoaPods installs; later builds are fast.

### Two things that will bite you

**1. The project path must not contain a space.** CocoaPods generates an
unquoted path into the EXConstants script phase, so a checkout at
`~/ARC LAUNCHPAD/mobile` fails with:

```
No such file or directory: /Users/you/ARC
```

Build from a space-free path (`~/tsukipad/mobile`) or rename the parent
directory. This is a CocoaPods/Expo bug, not something this project can fix
from inside.

**2. Expo SDK 57 does not compile under Xcode 26 unpatched.** Its Swift/C++
interop hits `'weak' must be a mutable variable` and a misapplied
`SWIFT_RETURNS_RETAINED`. `scripts/patch-expo-xcode26.sh` fixes both; it is
idempotent, and must be re-run after every `npm install`. Drop it once Expo
ships a fix.

### Notes on Arc's RPC

The public endpoint intermittently answers `Request exceeds defined limit`
under bursts. JSON-RPC batching made it worse rather than better, so the client
sends each read separately (`batch: false`), caps concurrency at 2 launches at
a time, and retries three times with backoff. A launch whose reads still fail
stays on the board without a price rather than silently disappearing.

## Trading

Buy and sell happen in the app. Sign-in is **Privy** with an embedded wallet —
social login creates the wallet, so there is no seed phrase, no MetaMask and no
WalletConnect project id.

Quotes come from static-calling the router's `exactInputSingle`, the same way
the web app does, so the figure includes fees and price impact rather than
estimating them. Signed out, the panel falls back to the pool's mid price and
labels it an estimate.

Set your Privy app id in `mobile/.env` (see `.env.example`). The app id is
public; the Privy **app secret** is server-side only and must never appear in
this app.

### Things that had to be worked around

- **`metro.config.js` disables package exports.** Privy depends on `jose`,
  whose exports map has no `react-native` condition, so Metro picks the Node
  build and fails on `util`/`zlib`/`buffer`/`crypto`. With exports off, the
  `browser` field resolves correctly.
- **Polyfills are imported first in `app/_layout.tsx`** — `fast-text-encoding`,
  `react-native-get-random-values` and `@ethersproject/shims`. React Native has
  no Web Crypto, TextEncoder or Buffer, and Privy needs all three.
- **The Sign in with Apple entitlement is stripped after prebuild.** Privy
  imports `expo-apple-authentication` unconditionally, and its config plugin
  adds an entitlement that demands a paid signing team even for a simulator
  build. We authenticate with Google, so the capability is removed:
  `/usr/libexec/PlistBuddy -c "Delete :com.apple.developer.applesignin" ios/TSUKIPAD/TSUKIPAD.entitlements`

## Why the create flow is not here

Apple's App Store Review Guideline **3.1.5(b)(iv)** requires apps that facilitate
token offerings to come from "established banks, securities firms, futures
commission merchants, or other approved financial institutions". A launchpad
that lets anyone mint and sell a token falls squarely inside that clause, so
shipping the create flow would make the app unpublishable. Launching opens the
website instead.

Publishing this app to the App Store also needs organization enrollment: a legal
entity, a D-U-N-S number, and $99/year. See the notes in the repo root.

## Design

Colours and type come from `web/app/globals.css` and are mirrored verbatim in
`lib/theme.ts` — same palette, same Space Grotesk / JetBrains Mono pairing, same
neo-brutalist offset shadows. React Native has no `box-shadow`, so the offset is
drawn as a translated sibling `View` in `components/ui.tsx`.
