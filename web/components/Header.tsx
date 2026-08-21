"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

import { Button, cx, LiveDot } from "./ui";
import { Logo } from "./Logo";
import { NAME_HEAD, NAME_TAIL } from "@/lib/brand";
import { erc20Abi } from "@/lib/abi";
import { USDC_ADDRESS, USDC_DECIMALS, chain, FAUCET_URL } from "@/lib/config";
import { formatUnitsFloat, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const NAV = [
  { href: "/", key: "nav.board" as const },
  { href: "/create", key: "nav.launch" as const },
  { href: "/waitlist", key: "nav.waitlist" as const },
  { href: "/referrals", key: "nav.referrals" as const },
];

export function Header() {
  const pathname = usePathname();
  const { t, lang, setLang } = useI18n();
  const { address, isConnected, chainId } = useAccount();
  // Privy owns sign-in now: email, Google, X, GitHub, Discord or an external
  // wallet, all funnelled into one modal.
  const { login, logout, ready, authenticated } = usePrivy();
  const { switchChain } = useSwitchChain();

  const wrongNetwork = isConnected && chainId !== chain.id;
  const [copied, setCopied] = useState(false);

  // A truncated address cannot be pasted into a faucet or a block explorer,
  // which is most of what anyone wants it for on a testnet.
  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context or denied) -- title still shows it */
    }
  }

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !wrongNetwork, refetchInterval: 30_000 },
  });

  return (
    <header className="sticky top-0 z-50 border-b-2 border-line bg-void/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
        <Link href="/" className="group shrink-0">
          <Logo name={NAME_HEAD} accent={NAME_TAIL} size={34} />
        </Link>

        <nav className="ml-4 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "border-2 px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors",
                  active
                    ? "border-lime bg-lime text-void"
                    : "border-transparent text-muted hover:border-line hover:text-ink",
                )}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Language switch. Labels stay in their own language so a Japanese
              reader can find 日本語 without reading English first. */}
          <div className="flex border-2 border-line">
            {(["en", "ja"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cx(
                  "px-2 py-1 text-xs font-bold transition-colors",
                  lang === l ? "bg-lime text-void" : "text-muted hover:text-ink",
                )}
                aria-label={l === "en" ? "English" : "日本語"}
                aria-pressed={lang === l}
              >
                {l === "en" ? "EN" : "日本語"}
              </button>
            ))}
          </div>

          {isConnected && !wrongNetwork ? (
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 border-2 border-line px-3 py-1.5 text-sm transition-colors hover:border-cyan md:inline-flex"
              title="Get testnet USDC from the Circle faucet"
            >
              <LiveDot />
              <span className="tabular font-bold">
                {usdcBalance !== undefined
                  ? `${formatUnitsFloat(usdcBalance as bigint, USDC_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                  : "—"}
              </span>
              <span className="text-xs text-faint">USDC</span>
            </a>
          ) : null}

          {wrongNetwork ? (
            <Button variant="pink" size="sm" onClick={() => switchChain({ chainId: chain.id })}>
              {t("nav.switchToArc")}
            </Button>
          ) : authenticated && address ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyAddress()}
                title={`${address} — ${t("nav.copyAddress")}`}
              >
                {/* btn-brut uppercases its label, which would render 0x as 0X. */}
                <span className={cx("tabular normal-case", copied && "text-lime")}>
                  {copied ? t("nav.copied") : shortAddress(address)}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void logout()}
                title={t("nav.signOut")}
                aria-label={t("nav.signOut")}
              >
                <span className="normal-case">×</span>
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={!ready} onClick={() => login()}>
              {ready ? t("nav.connect") : t("nav.connecting")}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
