# Mainnet checklist — Arc Network, 16 September 2026

Everything that must be true before this goes live on mainnet, in the order it
should happen. Nothing here is optional.

---

## 1. Brand — resolve before anything else

Circle's Arc Brand Guidelines prohibit incorporating "Arc" into a product name,
and give partners **three business days** to comply once a change is requested.
Doing a rename now is an afternoon; doing it under that clock with a live
community, listings and social links is not.

- [ ] Email sent to `trademarks@circle.com` asking about the product name
- [ ] Fallback name chosen **regardless of the answer**
- [ ] If renaming: edit `web/lib/brand.ts` only — `NAME_HEAD`, `NAME_TAIL`,
      `SITE_URL`. The logo is a price curve, not a letterform, so it needs no
      change.
- [ ] New domain purchased and added in Vercel
- [ ] Applied to the Arc ecosystem/partner programme

Already compliant, no action needed:

- Own logo, no Arc mark used anywhere
- Copy uses only approved phrasing ("built on Arc", "Arc Testnet", "Live on Arc")
- Trademark attribution and an explicit non-affiliation line in the footer
- "Arc Network" on first mention, "Arc" thereafter

---

## 2. Keys — the biggest operational risk

Today the launchpad **owner**, the **treasury** and the **deployer** are all the
same burner key, sitting in plaintext at `.secrets/deployer.env` and used inside
a coding session. That is correct for testnet and unacceptable for mainnet.

- [ ] Generate a fresh deployer key that has never touched a dev machine
- [ ] Choose a **separate** treasury address (a multisig if any real revenue is
      expected). Currently nominated:

          TREASURY=0x9977f2119F574d8FdA463AE4Bf45983BdC7d91bd

      This is a plain wallet. Every protocol fee lands here, so before mainnet
      it should be a multisig — a single key holding the platform's revenue is
      one compromised laptop away from losing all of it.
- [ ] Deploy with `TREASURY=` set explicitly — the deploy script now refuses to
      run on any non-testnet chain if treasury equals deployer
- [ ] After deploying, `transferOwnership()` to a multisig and have it accept
      (the contract is `Ownable2Step`, so the transfer is not live until the new
      owner accepts)
- [ ] Delete the testnet burner from `.secrets/`

What the owner key can and cannot do:

| Power | Bounded by |
|---|---|
| `setTreasury` | unbounded — send fees anywhere |
| `setProtocolFeeBps` | **capped at 50%** in immutable code |
| `setLaunchFee` | unbounded |
| Touch locked liquidity | **impossible — no code path exists** |
| Touch a creator's allocation | **impossible — only the recorded creator is paid** |

---

## 3. Uniswap — use the canonical deployment

Uniswap ships on Arc mainnet day one. Do **not** deploy our own factory there.

- [ ] Get Uniswap's canonical Arc mainnet V3 factory address from Uniswap's own
      deployments page — not from a forum post
- [ ] Confirm the 1% fee tier exists: `feeAmountTickSpacing(10000)` must return
      a non-zero tick spacing
- [ ] Deploy with `V3_FACTORY=<canonical>` — the script refuses to deploy
      without it on mainnet
- [ ] **Delete `ArcSwapRouter`.** It exists only because Arc testnet has no
      Uniswap. Point the frontend at Uniswap's official router instead; the
      pools we create are ordinary V3 pools and need nothing bespoke.

---

## 4. Verify Arc mainnet's own parameters

Do not assume testnet values carry over.

- [ ] USDC address — testnet is `0x3600...0000`. **The entire token-ordering
      constraint derives from this.** If mainnet differs, salt mining changes.
- [ ] USDC decimals on the ERC20 interface (testnet: 6, native gas: 18)
- [ ] Chain ID, RPC URL, explorer URL
- [ ] multicall3 deployed at the canonical address (the frontend batches reads
      through it)
- [ ] Confirm `eth_getLogs` range limits — testnet advertises 100,000 but
      actually rejects 50,000; `web/lib/useTrades.ts` is tuned to 20,000

---

## 5. Contract size — currently 734 bytes of headroom

`ArcLaunchpad` is 23,842 bytes against the 24,576 EIP-170 limit. A deploy that
exceeds it **fails silently, producing an empty contract** — this already
happened once during development.

- [ ] Run `forge build --sizes` before every deploy
- [ ] No new features without first moving fee routing into an external library

---

## 6. Pre-launch verification

- [ ] `forge test` — all green
- [ ] `pnpm exec tsx scripts/verify-ui-launch.ts` against mainnet: proves the
      browser's CREATE2 prediction matches what the contract deploys. If this
      is wrong, **every launch from the website fails.**
- [ ] `pnpm exec tsx scripts/verify-ui-trade.ts`: proves quoting works against
      the live node
- [ ] One real launch, one buy, one sell, one fee sweep — with real money
- [ ] Verify contracts on the mainnet explorer

---

## 7. Frontend cutover

- [ ] `web/lib/config.ts` — chain, RPC, explorer, USDC
- [ ] Vercel env: `NEXT_PUBLIC_LAUNCHPAD_ADDRESS`, `NEXT_PUBLIC_SWAP_ROUTER_ADDRESS`
- [ ] `web/lib/brand.ts` — `SITE_URL` if the domain changed
- [ ] Remove the testnet disclaimer from the footer (`footer.disclaimer`) —
      it currently says tokens have no value, which stops being true
- [ ] Re-check both languages after the copy change

---

## Known gotchas, learned the hard way

- **`forge script` cannot simulate USDC transfers on Arc.** USDC is
  native-backed; `forge script` runs the body locally against forked state
  first, where transfers revert. Launches simulate fine (they move no USDC);
  buys must go through `cast send`.
- **`eth_newFilter` returns "internal error" on Arc's public RPC.** wagmi's
  `useWatchContractEvent` fails silently as a result. The trade tape polls
  `eth_getLogs` instead.
- **Rapid sequential transactions hit nonce collisions** on the public RPC.
  Pace bulk operations ~2s apart.
- **Arc blocks are ~0.51s**, so block-range lookbacks cover far less wall-clock
  time than on most chains.
