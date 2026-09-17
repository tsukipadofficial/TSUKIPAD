import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui";
import { NAME } from "@/lib/brand";
import {
  CURVE_ADDRESS,
  EXPLORER_URL,
  HOOK_ADDRESS,
  IS_MAINNET,
  LAUNCHPAD_ADDRESS,
  MAX_CREATOR_TAX_BPS,
  POOL_MANAGER_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  TOKEN_DEPLOYER_ADDRESS,
  chain,
} from "@/lib/config";

export const metadata: Metadata = {
  title: `Docs — ${NAME}`,
  description:
    "How TSUKIPAD works: bonding curve and direct launches on Uniswap v4, a creator tax fixed for life, and every fee paid in USDC.",
};

/// The platform treasury, fixed in the contracts at deploy. Shown for
/// transparency: this is where the platform's 30% is paid.
const TREASURY: Record<number, string> = {
  5042: "0xd4376D9fa9C9886d31091529737FC17e86028F11",
  5042002: "0x9977f2119F574d8FdA463AE4Bf45983BdC7d91bd",
};

const TOC = [
  { id: "launch", label: "Two ways to launch" },
  { id: "tax", label: "Creator tax" },
  { id: "fees", label: "Where fees go" },
  { id: "modes", label: "Who earns the fees" },
  { id: "devbuy", label: "Developer buy" },
  { id: "snipe", label: "Snipe protection" },
  { id: "graduation", label: "Graduation" },
  { id: "collect", label: "Collecting fees" },
  { id: "safety", label: "What can't happen" },
  { id: "contracts", label: "Contracts" },
  { id: "integrations", label: "For integrators" },
  { id: "faq", label: "FAQ" },
];

const MAX_TAX = `${MAX_CREATOR_TAX_BPS / 100}%`;
const NETWORK = IS_MAINNET ? "Arc Mainnet" : "Arc Testnet";

export default function DocsPage() {
  const contracts = [
    { label: "Launchpad", note: "direct pools", address: LAUNCHPAD_ADDRESS },
    { label: "Bonding curve", address: CURVE_ADDRESS },
    { label: "Tax hook", address: HOOK_ADDRESS },
    { label: "Token factory", note: "for indexers", address: TOKEN_DEPLOYER_ADDRESS },
    { label: "Swap router", address: SWAP_ROUTER_ADDRESS },
    { label: "Uniswap v4", note: "PoolManager", address: POOL_MANAGER_ADDRESS },
    { label: "Platform treasury", address: TREASURY[chain.id] },
  ].filter((c) => c.address && !/^0x0{40}$/i.test(c.address));

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-14">
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        {/* Contents rail. Sticky below the site header on wide screens. */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24" aria-label="Contents">
            <p className="eyebrow mb-3">Contents</p>
            <ul className="border-l-2 border-line">
              {TOC.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-0.5 block border-l-2 border-transparent py-1.5 pl-3 text-sm text-muted transition-colors hover:border-lime hover:text-ink"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <header className="border-b-2 border-line pb-10">
            <div className="mb-5 flex flex-wrap gap-2">
              <Badge tone="lime">{NETWORK}</Badge>
              <Badge tone="cyan">Uniswap v4</Badge>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Launch a token on Arc. Everyone gets paid in USDC.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-muted">
              {NAME} launches tokens straight into Uniswap v4. The liquidity is locked forever, the
              creator tax is fixed for life, and every fee — to creators and to the platform — is paid
              in USDC, never in the token.
            </p>

            <dl className="brut mt-8 grid grid-cols-2 sm:grid-cols-4">
              {[
                ["$2.5K", "opening market cap"],
                [`0–${MAX_TAX}`, "creator tax, fixed"],
                ["70 / 30", "creator / platform"],
                ["$0", "launch fee"],
              ].map(([v, l], i) => (
                <div
                  key={l}
                  className={
                    "p-4 " +
                    (i < 3 ? "sm:border-r-2 sm:border-line " : "") +
                    (i % 2 === 0 ? "border-r-2 border-line sm:border-r-2 " : "") +
                    (i < 2 ? "border-b-2 border-line sm:border-b-0" : "")
                  }
                >
                  <dt className="sr-only">{l}</dt>
                  <dd className="tabular text-xl font-bold">{v}</dd>
                  <p className="mt-1 text-xs text-muted">{l}</p>
                </div>
              ))}
            </dl>

            <nav className="mt-6 flex flex-wrap gap-2 lg:hidden" aria-label="Contents">
              {TOC.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="border-2 border-line px-2.5 py-1 text-xs text-muted hover:border-lime hover:text-ink"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </header>

          <Section id="launch" title="Two ways to launch">
            <P>
              Every token has a fixed supply of <N>1,000,000,000</N>, trades against USDC, and opens at
              about a <N>$2.5K</N> market cap. You choose where trading starts.
            </P>
            <div className="my-6 grid gap-4 sm:grid-cols-2">
              <Option
                title="Bonding curve"
                body={
                  <>
                    Trades on a price curve first. When <N>$9,350</N> has been raised it graduates into a
                    locked Uniswap v4 pool on its own, in the same transaction as the last buy.
                  </>
                }
                rows={[
                  ["Opens at", "~$2.5K"],
                  ["Graduates at", "~$52K"],
                  ["Raise to graduate", "$9,350"],
                  ["Trading fee", "1%"],
                  ["Snipe protection", "yes"],
                ]}
              />
              <Option
                title="Direct pool"
                body="Opens straight into a Uniswap v4 pool. Tradeable anywhere from the first block, with every token placed in the pool as locked liquidity."
                rows={[
                  ["Opens at", "~$2.5K"],
                  ["Room to grow", "up to ~$2.49B"],
                  ["Cost to seed", "$0 + gas"],
                  ["Pool fee", "1%"],
                  ["Fee modes", "all five"],
                ]}
              />
            </div>
            <P>
              A direct pool is seeded <em>single-sided</em>: the pool starts holding only your token, so
              launching needs no USDC from anyone. The price can only move up from the opening price —
              nobody can ever buy in lower than the first buyer.
            </P>
          </Section>

          <Section id="tax" title="Creator tax">
            <P>
              Creators can add a tax from <N>0%</N> to <N>{MAX_TAX}</N> on top of the 1% base fee. It is
              charged by a Uniswap v4 hook, so it applies everywhere the token trades — not just on{" "}
              {NAME}.
            </P>
            <Bullets
              items={[
                <><b>Both directions.</b> Buys and sells are taxed at the same rate.</>,
                <><b>Before and after graduation.</b> A curve launch keeps its tax once it moves into its pool.</>,
                <><b>Always taken in USDC.</b> The hook never takes a slice of the token, so tax never becomes sell pressure on it.</>,
                <><b>Fixed forever.</b> Once a token launches, nobody can change its rate — not the creator, not {NAME}.</>,
              ]}
            />
            <Note tag="Example">
              A token with a <N>5%</N> tax. Someone buys <N>$100</N> of it: <N>$1</N> base fee + <N>$5</N>{" "}
              tax. When they sell, the USDC they receive is taxed the same way.
            </Note>
          </Section>

          <Section id="fees" title="Where fees go">
            <P>
              Everything a launch earns — the base fee <em>and</em> the creator tax — is added together
              and split <b>70% to the creator side, 30% to the platform</b>. The split is the same at every
              tax rate.
            </P>
            <SplitBar
              title={
                <>
                  A <N>$1,000</N> buy on a token with a <N>3%</N> tax
                </>
              }
              aside={
                <>
                  fees: <N>$10</N> base + <N>$30</N> tax = <N>$40</N>
                </>
              }
              segments={[
                { tone: "creator", pct: 70, amount: "$28.00", label: "Creator side" },
                { tone: "platform", pct: 30, amount: "$12.00", label: "Platform" },
              ]}
            />

            <h3 className="mt-8 text-lg font-bold">Referrals</h3>
            <P>
              A launch made through someone&apos;s referral link pays that person <N>10%</N> of the
              launch&apos;s fees. It comes <b>out of the platform&apos;s share</b>, so the creator loses
              nothing. Referrals apply to direct-pool launches.
            </P>
            <SplitBar
              title={
                <>
                  The same <N>$40</N>, launched through a referral
                </>
              }
              segments={[
                { tone: "creator", pct: 70, amount: "$28.00", label: "Creator side" },
                { tone: "platform", pct: 20, amount: "$8.00", label: "Platform" },
                { tone: "referrer", pct: 10, amount: "$4.00", label: "Referrer" },
              ]}
            />
            <P muted>
              Uniswap pays pool fees on sells in the token itself. {NAME} sells those for USDC before
              splitting anything, so every payout above arrives as USDC.
            </P>
          </Section>

          <Section id="modes" title="Who earns the fees">
            <P>
              The creator side (the 70%) goes wherever the launch chose. This is set once, at launch, and
              cannot be changed afterwards.
            </P>
            <div className="brut my-6 divide-y-2 divide-line">
              {[
                ["You keep them", "USDC is sent to the creator's wallet.", true],
                ["Holders earn", "USDC is shared among everyone holding the token, in proportion to their balance. Holders claim it from the token page.", true],
                ["Send to a wallet", "USDC goes to a different wallet — a project, a team, a charity.", true],
                ["Buy back & burn", "USDC buys the token back from its own pool and destroys it. Supply only ever goes down.", false],
                ["An X or GitHub account", "Fees wait for someone who has no wallet yet. They sign in with that account to claim. Unclaimed after one year, they go to the platform.", false],
              ].map(([name, body, both]) => (
                <div key={name as string} className="grid gap-2 p-4 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4">
                  <b>{name}</b>
                  <p className="text-sm text-muted">{body}</p>
                  <span className="justify-self-start">
                    <Badge tone={both ? "lime" : "line"}>{both ? "curve + direct" : "direct"}</Badge>
                  </span>
                </div>
              ))}
            </div>
            <P>The platform&apos;s 30% is paid the same way in every mode — in USDC, to the treasury.</P>
          </Section>

          <Section id="devbuy" title="Developer buy">
            <P>
              <b>Creators get no free supply.</b> If you want to hold your own token, you buy it — in the
              launch transaction, from your own pool, at the opening price, the same price the first
              outside buyer would pay.
            </P>
            <Bullets
              items={[
                "Enter an amount of USDC when you launch. Leave it empty to launch holding none.",
                "The USDC you spend stays in the pool, so there is money to sell into from the first block.",
                "What you bought is shown on the token page, so buyers can see how much the creator holds.",
              ]}
            />
          </Section>

          <Section id="snipe" title="Snipe protection">
            <P>
              Bots try to buy in the same block a token launches. A bonding-curve launch charges a buy tax
              for its first five seconds that makes that unprofitable, then disappears. It quarters every
              second:
            </P>
            <div
              className="my-6 grid h-40 grid-cols-6 items-end gap-2"
              role="img"
              aria-label="Snipe tax: 99% at 0 seconds, about 25% at 1, 6% at 2, 1.5% at 3, 0.4% at 4, nothing from 5 seconds"
            >
              {[
                [100, "99%", "0s"],
                [25, "~25%", "1s"],
                [6.2, "~6%", "2s"],
                [1.6, "~1.5%", "3s"],
                [0.4, "~0.4%", "4s"],
                [0, "0%", "5s+"],
              ].map(([h, v, s]) => (
                <div key={s as string} className="flex h-full flex-col justify-end">
                  <div
                    className={(h as number) > 0 ? "bg-pink" : "bg-line"}
                    style={{ height: `${h}%`, minHeight: 3 }}
                  />
                  <span className="tabular mt-2 text-xs font-bold">{v}</span>
                  <span className="tabular text-[0.6875rem] text-faint">{s}</span>
                </div>
              ))}
            </div>
            <P>
              The creator, the fee recipient, and up to <N>16</N> wallets the creator lists are exempt, so a
              team can still buy at launch. Snipe tax goes to the platform in full.
            </P>
          </Section>

          <Section id="graduation" title="Graduation">
            <P>
              A bonding curve graduates the moment <N>$9,350</N> has been raised. Nothing needs to be
              triggered — the buy that completes the curve also opens the pool.
            </P>
            <Bullets
              items={[
                <><N>17.98%</N> of supply (<N>179,800,000</N> tokens) and the raised USDC go into a Uniswap v4 pool at the curve&apos;s final price — about a <N>$52K</N> market cap.</>,
                "That liquidity is locked forever.",
                "Any tokens left over from rounding are burned, so supply matches what exists.",
                "The creator tax and the fee mode carry straight over to the pool.",
              ]}
            />
          </Section>

          <Section id="collect" title="Collecting fees">
            <P>
              Fees build up inside the pool as people trade. They are paid out when someone presses{" "}
              <b>Collect fees</b> — or <b>Buy back &amp; burn now</b> — on the token page.
            </P>
            <Note tag="Anyone can press it" tone="lime">
              Whoever presses the button pays a fraction of a cent in gas. The money never goes to them: it
              always goes to the addresses recorded at launch — the creator side, holders, the burn, and the
              platform.
            </Note>
          </Section>

          <Section id="safety" title="What can't happen">
            <div className="brut my-6 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-line">
                    <th className="eyebrow p-3">Worry</th>
                    <th className="eyebrow p-3">Why it can&apos;t</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    ["The creator pulls the liquidity", "The pool position is owned by the launchpad contract, which has no function that removes liquidity."],
                    ["Someone redirects a launch's fees", "The fee recipient is written once, at launch. There is no setter, no admin and no owner."],
                    ["The tax gets raised later", `The rate is recorded in the hook at launch and can never be rewritten. The cap is ${MAX_TAX}.`],
                    ["The platform changes its cut", "The 30% share and the treasury address are fixed in the contracts forever."],
                    ["Someone mints more tokens", "Supply is minted once, at launch. It can only go down, through burns."],
                    ["Someone takes your token's address", "Addresses are derived from the creator's wallet, so no one else can launch at yours."],
                  ].map(([w, why]) => (
                    <tr key={w}>
                      <td className="p-3 align-top font-bold">{w}</td>
                      <td className="p-3 align-top text-muted">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note tag="One trusted key" tone="pink">
              Claims for the <em>X or GitHub account</em> fee mode are approved by a {NAME} signing key,
              because a blockchain can&apos;t check who owns a social account. That key can only assign fees
              for earmarked launches that nobody has claimed yet. It cannot touch ordinary launches, claimed
              launches, liquidity or anyone&apos;s tokens.
            </Note>
            <P muted>
              Locked liquidity and fixed rules protect against the launchpad being abused. They do not make
              any token a good investment. Tokens can lose all their value.
            </P>
          </Section>

          <Section id="contracts" title="Contracts">
            <P>
              Live on {NETWORK}, chain <N>{chain.id}</N>. Pools run on Uniswap&apos;s own v4 PoolManager.
              Every {NAME} token address ends in <code className="tabular border border-line px-1">272</code>.
            </P>
            <div className="brut my-6 divide-y divide-line">
              {contracts.map((c) => (
                <div
                  key={c.label}
                  className="grid gap-2 p-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                >
                  <div className="text-sm">
                    {c.label}
                    {c.note ? <span className="block text-xs text-faint">{c.note}</span> : null}
                  </div>
                  <a
                    href={`${EXPLORER_URL}/address/${c.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="tabular text-xs break-all text-ink hover:text-lime"
                  >
                    {c.address}
                  </a>
                  <CopyButton value={c.address} />
                </div>
              ))}
            </div>
          </Section>

          <Section id="integrations" title="For integrators">
            <P>
              For wallets, trading bots, screeners and explorers. Everything below is free and public: show
              TSUKIPAD tokens with their real logo, links and fees without the creator paying for a listing.
            </P>

            <h3 className="mt-8 text-lg font-bold">Recognising a TSUKIPAD token</h3>
            <P>
              Every token is deployed by one factory,{" "}
              <code className="tabular border border-line px-1 break-all">{TOKEN_DEPLOYER_ADDRESS}</code>, which emits{" "}
              <code className="tabular border border-line px-1">TokenDeployed(token, pad, creator, curve, name, symbol)</code>.
              Only count it when <code className="tabular border border-line px-1">pad</code> is the launchpad or the bonding
              curve listed under <a href="#contracts" className="underline decoration-lime underline-offset-4 hover:text-lime">Contracts</a>.
              Anyone can deploy a token that claims to be TSUKIPAD; only the pads&apos; records are authoritative.
            </P>

            <h3 className="mt-8 text-lg font-bold">Token API</h3>
            <P>
              No key, no rate card, readable from any origin. Returns <N>404</N> for any address TSUKIPAD did not launch.
            </P>
            <Code>{`GET https://www.tsukipad.com/api/token/{address}
GET https://www.tsukipad.com/api/token/{address}/image`}</Code>
            <P muted>
              <code className="tabular">/image</code> returns the logo as a normal PNG, JPEG or WebP, cacheable
              indefinitely — metadata is immutable once a token launches. Use it directly as an image URL.
            </P>
            <Code>{`{
  "schema": "tsukipad.token.v1",
  "chainId": ${chain.id},
  "address": "0x…272",
  "name": "beta",
  "symbol": "BETA",
  "decimals": 18,
  "totalSupply": "1000000000000000000000000000",
  "image": "https://www.tsukipad.com/api/token/0x…272/image",
  "website": null, "twitter": null, "telegram": null,
  "url": "https://www.tsukipad.com/token/0x…272",
  "launchpad": { "name": "TSUKIPAD", "factory": "0x…", "contract": "0x…", "type": "direct" },
  "creator": "0x…",
  "feeRecipient": "0x…",
  "feeMode": "creator",
  "createdAt": 1789624749,
  "graduated": true,
  "fees": {
    "poolFeeBps": 100, "creatorTaxBps": 300,
    "buyBps": 400, "sellBps": 400,
    "taxCurrency": "USDC", "immutable": true
  },
  "pool": {
    "dex": "uniswap-v4", "poolId": "0x…",
    "poolManager": "0x…", "hook": "0x…",
    "currency0": "0x…272", "currency1": "0x3600…0000",
    "fee": 10000, "tickSpacing": 200
  }
}`}</Code>
            <P muted>
              <code className="tabular">type</code> is <code className="tabular">direct</code> or{" "}
              <code className="tabular">bonding_curve</code>. <code className="tabular">pool</code> is{" "}
              <code className="tabular">null</code> for a curve that has not graduated. <code className="tabular">feeMode</code>{" "}
              is one of <code className="tabular">creator</code>, <code className="tabular">wallet</code>,{" "}
              <code className="tabular">holders</code>, <code className="tabular">buyback_burn</code>,{" "}
              <code className="tabular">social_account</code>.
            </P>

            <h3 className="mt-8 text-lg font-bold">Showing the right tax</h3>
            <P>
              The creator tax is not built into the token contract, so a transfer-tax check will report{" "}
              <N>0%</N>. It is charged by the pool&apos;s Uniswap v4 hook,{" "}
              <code className="tabular border border-line px-1 break-all">{HOOK_ADDRESS}</code>, on every swap through any router:
            </P>
            <Bullets
              items={[
                <>A buy pays <N>fees.buyBps</N> in total: the <N>1%</N> pool fee plus the creator tax, taken from the USDC paid in.</>,
                <>A sell pays <N>fees.sellBps</N> in total, with the tax taken from the USDC received.</>,
                <>The rate is fixed at launch, capped at <N>{MAX_TAX}</N>, and the hook has no owner. It cannot block sells or change a fee.</>,
              ]}
            />

            <h3 className="mt-8 text-lg font-bold">Pools and events</h3>
            <P>
              Every pool pairs the token (<code className="tabular">currency0</code>) with USDC at a <N>1%</N> fee and tick spacing{" "}
              <N>200</N>, on Uniswap&apos;s own PoolManager. Useful events:
            </P>
            <Code>{`ArcLaunchpad  Launched(token, poolId, creator, feeRecipient, name, symbol,
                       metadataURI, totalSupply, liquiditySupply,
                       tickLower, tickUpper, liquidity)
TsukiCurve    Launched(token, creator, name, symbol, metadataURI)
TsukiCurve    Trade(token, trader, isBuy, usdcAmount, tokenAmount, fee,
                    tokensSold, usdcRaised)
TsukiCurve    Graduated(token, poolId, usdcToPool, tokensToPool, liquidity)
PoolManager   Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee)`}</Code>
            <P muted>
              All TSUKIPAD contracts are source-verified on ArcScan and Sourcify. To integrate or ask a question, reach us on X
              or Telegram, linked in the footer.
            </P>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="space-y-3">
              {[
                ["I hold tokens — why can't I sell?", "You can only sell into USDC that buyers have put into the pool. If everyone who bought has already sold, the pool holds no USDC and there is nothing to pay you with. As soon as someone buys, selling works again. Every AMM behaves this way."],
                ["I sold, but some tokens came back to my wallet.", "A sale bigger than the USDC in the pool fills as far as the pool can pay, and the rest of your tokens are returned to you in the same transaction. Nothing is lost."],
                ["What do I pay gas with?", "USDC. Arc uses USDC as its gas token, so there is no second coin to buy. A trade costs a fraction of a cent."],
                ["How do I get USDC onto Arc?", "Move USDC from another chain with Circle's official bridge (CCTP), which connects Arc with Ethereum, Base, Arbitrum, Solana, BNB Chain, Polygon and more. Your USDC arrives as native Arc USDC and already covers your gas."],
                ["Why do token addresses end in 272?", `It's ${NAME}'s signature, so its tokens are recognisable in any explorer or bot. It's cosmetic — if a matching address can't be found quickly, the launch goes ahead on a normal address.`],
                ["Can I pair a token with a stock?", `Not yet. Tokens named after stocks already exist on Arc, but none are backed shares from a regulated issuer. Every ${NAME} pool pairs with USDC.`],
              ].map(([q, a]) => (
                <details key={q} className="brut group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-bold">
                    {q}
                    <span className="tabular text-lime group-open:hidden">+</span>
                    <span className="tabular hidden text-lime group-open:inline">−</span>
                  </summary>
                  <p className="px-4 pb-4 text-sm text-muted">{a}</p>
                </details>
              ))}
            </div>
          </Section>
        </article>
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pt-14">
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={"mb-4 max-w-[66ch] leading-relaxed " + (muted ? "text-muted" : "")}>{children}</p>;
}

function N({ children }: { children: ReactNode }) {
  return <span className="tabular">{children}</span>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-4 max-w-[66ch] space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 leading-relaxed">
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-lime" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Note({
  tag,
  tone = "line",
  children,
}: {
  tag: string;
  tone?: "line" | "lime" | "pink";
  children: ReactNode;
}) {
  const border = { line: "border-line-bright", lime: "border-lime", pink: "border-pink" }[tone];
  const label = { line: "text-muted", lime: "text-lime", pink: "text-pink" }[tone];
  return (
    <div className={`brut my-6 p-4 ${border}`}>
      <p className={`eyebrow mb-2 ${label}`}>{tag}</p>
      <p className="max-w-[66ch] text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function Option({ title, body, rows }: { title: string; body: ReactNode; rows: [string, string][] }) {
  return (
    <div className="brut p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SEGMENT = {
  creator: { bar: "bg-lime text-void", dot: "bg-lime" },
  platform: { bar: "bg-pink text-white", dot: "bg-pink" },
  referrer: { bar: "bg-cyan text-void", dot: "bg-cyan" },
};

function SplitBar({
  title,
  aside,
  segments,
}: {
  title: ReactNode;
  aside?: ReactNode;
  segments: { tone: keyof typeof SEGMENT; pct: number; amount: string; label: string }[];
}) {
  return (
    <div
      className="brut my-6 p-4"
      role="img"
      aria-label={segments.map((s) => `${s.label} ${s.pct}% ${s.amount}`).join(", ")}
    >
      <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
        <span>{title}</span>
        {aside ? <span className="text-muted">{aside}</span> : null}
      </div>
      <div className="flex h-10 border-2 border-line-bright">
        {segments.map((s) => (
          <div
            key={s.label}
            className={`tabular flex items-center overflow-hidden px-2 text-xs font-bold whitespace-nowrap ${SEGMENT[s.tone].bar}`}
            style={{ width: `${s.pct}%` }}
          >
            {s.amount}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 ${SEGMENT[s.tone].dot}`} aria-hidden="true" />
            {s.label}{" "}
            <span className="tabular font-bold">
              {s.pct}% · {s.amount}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="brut tabular my-5 overflow-x-auto p-4 text-xs leading-relaxed text-ink">
      <code>{children}</code>
    </pre>
  );
}
