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

## Why there is no in-app trading

Signing a transaction on iOS requires WalletConnect, which requires a project id
from https://dashboard.reown.com. The project does not have one yet, so the
Trade button opens `tsukipad.com`, where a browser wallet signs.

To add in-app signing:

1. Get a WalletConnect project id.
2. `npx expo install @reown/appkit-react-native @walletconnect/react-native-compat`
3. Put the id in `lib/config.ts` and wrap the root layout in the AppKit provider.

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
