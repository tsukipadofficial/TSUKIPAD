# TSUKIPAD

[![ci](https://github.com/tsukipadofficial/TSUKIPAD/actions/workflows/ci.yml/badge.svg)](https://github.com/tsukipadofficial/TSUKIPAD/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-c8ff2e.svg)](LICENSE)
[![Arc Mainnet](https://img.shields.io/badge/Arc-Mainnet%20·%20chain%205042-08080a.svg)](https://explorer.arc.io/address/0x37Acbbd157966C3f1f7caFc904AA0cFAF9eBB9E2)

**The token launchpad for [Arc](https://arc.io), built on Uniswap v4.**

Launch a token in one transaction. Liquidity is locked forever, the creator tax
is fixed for life, and every fee — to creators, holders and the platform — is
paid in **USDC**, never in the token.

**[tsukipad.com](https://www.tsukipad.com)** · Live on Arc Mainnet (chain `5042`)

| Opening market cap | Creator tax | Fee split | Launch fee |
|:--:|:--:|:--:|:--:|
| **$2.5K** | **0–10%**, fixed | **70% creator · 30% platform** | **$0** |

---

## Contents

- [How it works](#how-it-works)
- [Fees](#fees)
- [Security model](#security-model)
- [Deployments](#deployments)
- [Architecture](#architecture)
- [Development](#development)
- [Deploying](#deploying)
- [License](#license)

---

## How it works

Every token has a fixed supply of **1,000,000,000**, trades against USDC, and
opens at about a **$2.5K** market cap. Creators choose where trading starts.

| | Bonding curve | Direct pool |
|---|---|---|
| Trading starts on | A price curve | A Uniswap v4 pool |
| Moves to Uniswap v4 | Automatically, when **$9,350** is raised | From the first block |
| Market cap at the pool | ~$52K at graduation | ~$2.5K, room to ~$2.49B |
| Base trading fee | 1% | 1% |
| Snipe protection | Yes | — |
| Fee modes | Keep · Holders · Wallet | Keep · Holders · Wallet · Buy-back & burn · Social account |

### Direct pool

A Uniswap v4 position whose range sits entirely above the current price holds
only one asset. TSUKIPAD mines a CREATE2 salt so the token sorts below USDC
(`0x3600…0000`), opens the pool at the bottom of the range, and places the whole
supply in a single position. **Launching requires no USDC from anyone**, and the
price can only rise from the opening price: nobody buys in lower than the first
buyer.

### Bonding curve

Trades on a constant-product curve until **$9,350** is raised. The buy that
completes the curve also graduates it, in the same transaction:
**17.98%** of supply and the raised USDC become a locked Uniswap v4 position at
the curve's final price. There is no migration step to trigger and no price
jump. Tokens left over from rounding are burned.

A snipe tax on the first five seconds makes launch-block bots unprofitable. It
starts at **99%** and quarters every second (99% → ~25% → ~6% → ~1.5% → ~0.4% →
0). The creator, the fee recipient and up to 16 declared wallets are exempt.

### Creator tax

A creator may add a tax of **0–10%** on top of the base fee. It is enforced by a
Uniswap v4 hook, so it applies wherever the token trades, not only on
tsukipad.com:

- charged on **buys and sells** alike;
- carried over when a curve graduates into its pool;
- taken **in USDC only** — the hook never takes the token, so tax never becomes
  sell pressure;
- **permanent** — the rate is recorded once and cannot be changed by anyone.

### Developer buy

Creators receive **no free supply**. A creator who wants to hold their token
buys it inside the launch transaction, from their own pool, at the opening
price. The USDC they spend stays in the pool, so there is liquidity to sell into
from the first block, and the amount bought is recorded on-chain for buyers to
see.

### Address mark

Every TSUKIPAD token address ends in `272`. The mark is cosmetic and never
enforced on-chain; if a matching salt cannot be found quickly, the launch
proceeds on an ordinary address.

---

## Fees

Everything a launch earns — the base fee **and** the creator tax — is pooled and
split **70% to the creator side and 30% to the platform**, at every tax rate.

Example: a **$1,000** buy on a token with a **3%** tax.

| | Amount |
|---|--:|
| Base fee (1%) | $10.00 |
| Creator tax (3%) | $30.00 |
| **Total fees** | **$40.00** |
| Creator side (70%) | $28.00 |
| Platform (30%) | $12.00 |

**Referrals.** A direct-pool launch made through a referral link pays the
referrer **10%** of the launch's fees, taken from the platform's share. The
creator side is unaffected.

**USDC only.** Uniswap pays pool fees on sells in the token. Before anything is
split, the launchpad sells that side for USDC, so every payout is USDC.

### Fee modes

The creator side goes wherever the launch chose at creation. The choice is
immutable.

| Mode | Where the creator side goes | Curve | Direct |
|---|---|:--:|:--:|
| Keep | The creator's wallet, in USDC | ✓ | ✓ |
| Holders | Every holder, pro rata to balance, claimable in USDC | ✓ | ✓ |
| Wallet | A different wallet: a project, team or charity | ✓ | ✓ |
| Buy-back & burn | Buys the token from its own pool and destroys it | | ✓ |
| Social account | Held for an X or GitHub account without a wallet; returned to the treasury if unclaimed for 365 days | | ✓ |

### Collecting

Fees accrue inside the pool and are paid out by `collectFees` (and, for curve
launches, `claimCreatorFees`). Both are **permissionless**: anyone may call them
and pay the gas, but proceeds only ever go to the addresses recorded at launch.

---

## Security model

**What the contracts guarantee**

| Risk | Why it cannot happen |
|---|---|
| Liquidity is pulled | Positions are owned by the launchpad, which has no code path that removes liquidity. A test fails if one is ever added. |
| Fees are redirected | The fee recipient is written once at launch. There is no setter, no admin and no owner. |
| The tax is raised later | The hook refuses to re-register a pool. The cap is 10%. |
| The platform changes its terms | Treasury, platform share and all rates are immutable. |
| Supply is inflated | Supply is minted once. It can only fall, through burns. |
| A launch address is taken | Salts are namespaced by the creator's address. |

**Trust assumptions**

- **Attestor.** The *social account* fee mode binds a wallet to an X or GitHub
  account using a signature from a TSUKIPAD attestor key, since account
  ownership cannot be verified on-chain. The signature is bound to the chain,
  launchpad, token, recipient and deadline, and a launch can be claimed once.
  The key can affect only earmarked launches that have not yet been claimed; it
  cannot touch ordinary launches, liquidity, tokens or platform funds. It is
  immutable.
- **Uniswap v4.** Pools run on Uniswap's own `PoolManager` on Arc.

**Testing.** 148 Foundry tests covering launches, graduation, fee accounting,
the 70/30 split at every tax rate, buy-back & burn, holder rewards, escrow,
referrals, partial fills and an adversarial suite. The hook and graduation
suites also run against a fork of Arc Mainnet and Uniswap's deployed
`PoolManager`. Collection was measured to be unprofitable to sandwich.

> [!IMPORTANT]
> The contracts have not undergone a third-party audit. Locked liquidity and
> fixed rules protect users from abuse of the launchpad; they do not make any
> token a good investment. Tokens can lose all their value.

---

## Deployments

### Arc Mainnet · chain `5042`

| Contract | Address |
|---|---|
| ArcLaunchpad | [`0x37Acbbd157966C3f1f7caFc904AA0cFAF9eBB9E2`](https://explorer.arc.io/address/0x37Acbbd157966C3f1f7caFc904AA0cFAF9eBB9E2) |
| TsukiCurve | [`0xd8c5E582ea74a6BfC50b6920583B76EAbE4a2889`](https://explorer.arc.io/address/0xd8c5E582ea74a6BfC50b6920583B76EAbE4a2889) |
| TsukiHook | [`0x8F0659d18A5CC563ea777C93343b9C66f9FaE0cc`](https://explorer.arc.io/address/0x8F0659d18A5CC563ea777C93343b9C66f9FaE0cc) |
| TsukiRouter | [`0x43c1F2B8AefB0a3FBd63eB7aE68238bA5A6e3926`](https://explorer.arc.io/address/0x43c1F2B8AefB0a3FBd63eB7aE68238bA5A6e3926) |
| TokenDeployer | [`0x53698012EB8b166542EE7434C0b371479eBF2Cb8`](https://explorer.arc.io/address/0x53698012EB8b166542EE7434C0b371479eBF2Cb8) |
| Treasury | [`0xd4376D9fa9C9886d31091529737FC17e86028F11`](https://explorer.arc.io/address/0xd4376D9fa9C9886d31091529737FC17e86028F11) |
| Uniswap v4 PoolManager | [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://explorer.arc.io/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |

`TokenDeployer` is the single factory for every TSUKIPAD token, and the address
to use for indexing. The machine-readable record is
[`contracts/deployments/5042.json`](contracts/deployments/5042.json).

### Arc Testnet · chain `5042002`

See [`contracts/deployments/5042002.json`](contracts/deployments/5042002.json).

---

## Architecture

```
contracts/src/
  ArcLaunchpad.sol   Direct launches: pool seeding, fee collection and routing,
                     buy-back & burn, escrow for social-account recipients
  TsukiCurve.sol     Bonding curve: trading, snipe tax, graduation into v4
  TsukiHook.sol      Uniswap v4 hook charging the creator tax in USDC
  TsukiV4Pool.sol    Shared v4 plumbing: pool opening, locked minting, swaps
  TsukiRouter.sol    Single-hop exact-input router used by the site
  TokenDeployer.sol  CREATE2 factory for launch and curve tokens
  LaunchToken.sol    Fixed-supply ERC-20 with optional USDC holder rewards
  CurveToken.sol     LaunchToken for curve launches
```

```
contracts/   Foundry project: sources, tests, deploy scripts, deployment records
web/         tsukipad.com — Next.js, wagmi, viem, Privy
mobile/      Mobile app
scripts/     Local development and ABI sync
```

The web app reads chain state directly and runs a small indexer on Vercel for
trade history, positions and the leaderboard, backed by Redis. One variable,
`NEXT_PUBLIC_NETWORK`, switches the whole app between testnet and mainnet.

---

## Development

**Requirements:** [Foundry](https://book.getfoundry.sh), Node 20+, pnpm 10.

```bash
git clone --recursive https://github.com/tsukipadofficial/TSUKIPAD.git
cd TSUKIPAD
```

### Contracts

```bash
cd contracts/tools && npm ci && cd ..
forge build --sizes
forge test
```

The fork suites re-run against Arc Mainnet state:

```bash
anvil --port 8547 --fork-url https://rpc.mainnet.arc.io
forge test --match-path "test/*Fork.t.sol" --fork-url http://127.0.0.1:8547
```

> [!NOTE]
> Arc's USDC is native-backed, so USDC transfers revert on a local fork while
> succeeding on the real chain. Fork suites install a stand-in ERC-20 at the
> USDC address; end-to-end checks with real USDC run on testnet.

### Web app

```bash
./scripts/local-dev.sh   # local chain with the full stack deployed
cd web && pnpm install && pnpm dev
```

`local-dev.sh` writes `web/.env.local` and prints a funded development key for
the local chain only.

---

## Deploying

`contracts/script/Deploy.s.sol` deploys the token factory, the hook (mined to
the address its permissions require), both launchpads and the router, then
writes `contracts/deployments/<chainId>.json`.

On any network other than a local chain the script requires, and refuses to run
without:

- `TREASURY` — a wallet **different from the deployer**;
- `V4_POOL_MANAGER` — Uniswap's own `PoolManager` (plus `V4_STATE_VIEW` and
  `V4_QUOTER`).

`ATTESTOR` sets the attestor address; it defaults to the deployer. Keep keys in
an untracked env file — every `.env` and `.env*.local` file is ignored by git.

```bash
cd contracts
set -a; . ./.env.mainnet.local; set +a
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.arc.io --broadcast --slow
```

Treasury, attestor, platform share, referral rate, launch fee, graduation target
and the tax cap are **immutable** once deployed.

---

## License

[MIT](LICENSE) © TSUKIPAD

TSUKIPAD is an independent project. It is not built, operated or reviewed by
Circle or Uniswap Labs.
