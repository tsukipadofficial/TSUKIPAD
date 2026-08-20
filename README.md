# TSUKIPAD

[![ci](https://github.com/tsukipadofficial/TSUKIPAD/actions/workflows/ci.yml/badge.svg)](https://github.com/tsukipadofficial/TSUKIPAD/actions/workflows/ci.yml)

A fair-launch token launchpad for [Arc](https://arc.io), Circle's stablecoin L1.

Tokens launch **directly into a real Uniswap V3 USDC pool** at a ~$3K market cap,
seeded entirely with single-sided liquidity. The creator supplies no USDC, there
is no presale, no bonding-curve contract, and no "graduation" step — the token is
tradeable through any router or aggregator from its first block.

---

## The mechanic

A Uniswap V3 position whose price range sits entirely **above** the current price
holds only `token0`. That single fact is the whole design:

1. The token is deployed with CREATE2 using a salt mined so its address sorts
   **below** USDC (`0x3600…0000`), making it `token0`. Roughly 21% of addresses
   qualify, so mining converges in a handful of attempts.
2. A TOKEN/USDC pool is created and initialised at exactly `tickLower` — the
   price corresponding to the chosen opening market cap.
3. One position is minted over `[tickLower, tickUpper]`, funded purely with
   tokens. **Zero USDC is required.**
4. Buyers walking the price up the range are what fills the pool with USDC.

That range *is* the bonding curve — except it is an ordinary Uniswap pool, so
there is no migration risk and nothing to graduate.

### Why it can't rug

The liquidity position is owned by the `ArcLaunchpad` contract, which exposes no
code path that calls `burn` with non-zero liquidity. The principal is not locked
by a timelock someone can let lapse, or by a policy someone can change — **there
is simply no function that can withdraw it.** Swap fees remain claimable, split
between the creator and the protocol treasury.

A test asserts this structurally: `test_launchpadHasNoCodePathThatBurnsLiquidity`
fails if a future edit adds a second `.burn(` call to the contract.

---

## Measured economics

From the test suite, for a 1B supply with a 1000× ceiling:

| | |
|---|---|
| Opening market cap | **$3,029** |
| After a $500 buy | $4,064 |
| After $50k of buying | $857k |
| Ceiling market cap | $3.01M |
| **Total curve capacity** | **$96,392** |
| Creator's cost | **$0** + gas |

The last row matters: about **$96k of net buying** takes a launch from $3k to
sold-out. A higher ceiling spreads the same supply over a wider range, so price
moves faster per dollar and total capacity falls. The create form shows this
figure live so creators choose knowingly.

Offering more than the curve can absorb is safe — the buyer is only charged for
what actually fills (`test_curveExhaustsAndDoesNotOverchargeTheBuyer`).

---

## Repo layout

```
contracts/          Foundry project
  src/
    ArcLaunchpad.sol      launch + registry + fee collection
    LaunchToken.sol       fixed-supply ERC20, no mint/owner/tax
    ArcSwapRouter.sol     minimal single-hop router (testnet only)
    libraries/V3Math.sol  TickMath/FullMath/LiquidityAmounts ported to 0.8
  script/
    Deploy.s.sol          deploys Uniswap V3 + the launchpad stack
    SeedDemo.s.sol        fills a local chain with demo launches
web/                Next.js 16 app (App Router, wagmi + viem)
scripts/local-dev.sh Local chain with the whole stack on it
```

---

## Running it locally

Requires Node 20+, pnpm, and Foundry.

```bash
# terminal 1 — chain + contracts + demo data
./scripts/local-dev.sh

# terminal 2 — the app
cd web && pnpm dev
```

`local-dev.sh` writes `web/.env.local` for you and prints a funded private key to
import into your wallet (network: `http://127.0.0.1:8545`, chain id `5042002`).

### Tests

```bash
cd contracts && forge test -vv
```

18 tests, run against the **genuine** Uniswap V3 factory and pool bytecode from
the `@uniswap/v3-core` package rather than a reimplementation.

---

## Deploying to Arc testnet

```bash
cd contracts
PRIVATE_KEY=0xyour_testnet_key \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_testnet --broadcast
```

Get testnet USDC from the [Circle faucet](https://faucet.circle.com). You need
USDC for gas — it is Arc's native gas asset.

The script writes `contracts/deployments/5042002.json`; copy the addresses into
`web/.env.local`:

```
NEXT_PUBLIC_LAUNCHPAD_ADDRESS=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=0x...
```

---

## Mainnet day (16 September 2026)

Uniswap [ships on Arc mainnet day one](https://cryptobriefing.com/uniswap-top-dex-stablecoin-trading-arc-launch/),
alongside Aave and Aerodrome. The migration is a config change, not a rewrite:

1. **Reuse canonical Uniswap.** `Deploy.s.sol` deploys a V3 factory only when
   `V3_FACTORY` is unset. Set it to Uniswap's canonical Arc mainnet factory and
   the script wires the launchpad to it instead.
2. **Drop `ArcSwapRouter`.** It exists only because Arc testnet has no Uniswap.
   Point the frontend at the official `SwapRouter02` / Universal Router — the
   pools are ordinary V3 pools and need nothing bespoke.
3. **Re-point the frontend.** Swap `arcTestnet` for Arc mainnet in
   `web/lib/config.ts` and update the two addresses.
4. **Verify the USDC address** on mainnet. It is expected to be the same
   `0x3600…0000`, but confirm before deploying — the entire token-ordering
   constraint is derived from it.

Everything else — the launch math, the tick derivation, the lock guarantee — is
chain-agnostic.

---

## Notes and gotchas discovered along the way

- **Arc's USDC has two decimal views.** The native gas balance carries 18
  decimals; the ERC20 interface at `0x3600…0000` carries 6. They are the same
  money. Mixing them up silently corrupts balance math. This app quotes USDC
  exclusively through the 6-decimal ERC20 view.
- **You cannot test USDC transfers against an anvil fork of Arc.** USDC is
  native-backed, so `transfer` reverts on a fork while succeeding on the real
  chain (`approve` and reads work fine either way). `local-dev.sh` therefore runs
  a *fresh* anvil with a normal ERC20 installed at the USDC address.
- **Arc testnet has no Uniswap.** Only a community V2 fork, which cannot do
  single-sided launches. We deploy V3 ourselves; its BUSL licence expired in
  April 2023, so core and periphery are GPL-2.0 and freely deployable. V4 core is
  still BUSL until 2028 and was deliberately avoided.
- **multicall3 is deployed on Arc** at the canonical address, and `viem`'s
  `arcTestnet` chain declares it — so wagmi batches reads through it. A fresh
  anvil does not have it, and batched reads fail silently; `local-dev.sh` copies
  the bytecode across.
- **`viem` ships `arcTestnet` built in.** Its RPC URLs use `arc.network` while
  the docs advertise `arc.io`. Both work.

---

## Status

- Contracts: complete, 81 passing tests across 9 suites, including an adversarial suite.
- Frontend: complete — board, create flow, token page with live trades and trading.
- **Deployed to Arc testnet** (chain 5042002) — addresses in `contracts/deployments/5042002.json`.
- Live at [tsukipad.com](https://www.tsukipad.com), verified end to end against the deployed contracts.
- Arc mainnet is expected 16 September 2026; see `MAINNET.md` for the pre-flight checklist.
- **Not audited.** Testnet only for now. Use at your own risk.


## Running the tests

The pool tests load prebuilt Uniswap V3 artifacts through `vm.getCode`, so the
npm packages must be installed before Foundry runs:

```bash
git clone --recursive https://github.com/tsukipadofficial/TSUKIPAD.git
cd TSUKIPAD/contracts/tools && npm ci
cd .. && forge test
```

81 tests across 9 suites, covering launches, the creator lock, fee accounting,
buyback-and-burn, holder rewards, on-chain metadata, and an adversarial suite.
