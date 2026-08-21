"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { usePrivy, useLinkAccount } from "@privy-io/react-auth";

import { Button, Card, cx } from "@/components/ui";
import { launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, chain } from "@/lib/config";
import { PROVIDERS, type Provider } from "@/lib/commitment";
import { shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/// Claiming fees a launch earmarked for a social account.
///
/// The person claiming may never have held a wallet. They sign in, Privy mints
/// one, the service checks their account against what the launch committed to,
/// and the signature it returns is what the contract will accept. Nothing here
/// can move money on its own -- the claim transaction is sent by the claimant.
export default function ClaimPage() {
  const { t } = useI18n();
  const { address, isConnected, chainId } = useAccount();
  const { login, ready, authenticated, getAccessToken, user } = usePrivy();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [token, setToken] = useState("");
  const [provider, setProvider] = useState<Provider>("x");
  const [busy, setBusy] = useState<"check" | "claim" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [attestation, setAttestation] = useState<{
    handle: string;
    deadline: string;
    signature: `0x${string}`;
  } | null>(null);

  const wrongChain = isConnected && chainId !== chain.id;
  const tokenValid = isAddress(token.trim());

  const message = (code: string) =>
    ({
      "not-signed-in": t("claim.errSignIn"),
      "account-not-linked": t("claim.errNotLinked", { p: provider }),
      "not-earmarked": t("claim.errNotEarmarked"),
      "not-your-earmark": t("claim.errNotYours"),
      "bad-token": t("claim.errBadToken"),
      "attestor-not-configured": t("claim.errUnavailable"),
      "privy-not-configured": t("claim.errUnavailable"),
    })[code] ?? t("claim.errGeneric");

  async function check() {
    if (!address || !tokenValid) return;
    setError(null);
    setBusy("check");
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/api/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), provider, recipient: address, accessToken }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "unknown");
      setAttestation({ handle: j.handle, deadline: j.deadline, signature: j.signature });
    } catch (e) {
      setError(message((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    if (!attestation || !address) return;
    setError(null);
    setBusy("claim");
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "claimFeeRecipient",
        args: [token.trim() as `0x${string}`, address, BigInt(attestation.deadline), attestation.signature],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setDone(true);
    } catch (e) {
      const m = (e as Error).message;
      if (!/reject|denied|User rejected/i.test(m)) setError(t("claim.errChain"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-14">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("claim.title")}</h1>
      <p className="mt-3 text-muted">{t("claim.sub")}</p>

      {!authenticated ? (
        <Card className="mt-8 p-8 text-center">
          <p className="text-sm text-muted">{t("claim.signInFirst")}</p>
          <Button className="mt-4" disabled={!ready} onClick={() => login()}>
            {t("nav.connect")}
          </Button>
        </Card>
      ) : done ? (
        <Card className="mt-8 border-lime p-8 text-center">
          <p className="text-2xl font-bold text-lime">{t("claim.done")}</p>
          <p className="mt-2 text-sm text-muted">{t("claim.doneBody")}</p>
        </Card>
      ) : (
        <Card className="mt-8 space-y-4 p-6">
          <div>
            <p className="eyebrow mb-2">{t("claim.tokenLabel")}</p>
            <input
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setAttestation(null);
              }}
              placeholder="0x…"
              spellCheck={false}
              className={cx(
                "tabular w-full border-2 bg-void px-3 py-2.5 font-mono text-sm text-ink outline-none",
                token === "" || tokenValid ? "border-line" : "border-pink",
              )}
            />
          </div>

          <div>
            <p className="eyebrow mb-2">{t("claim.providerLabel")}</p>
            <div className="flex gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setProvider(p);
                    setAttestation(null);
                  }}
                  className={cx(
                    "flex-1 border-2 px-3 py-2 text-xs font-bold uppercase",
                    provider === p
                      ? "border-lime bg-lime/10 text-lime"
                      : "border-line text-muted hover:border-line-bright",
                  )}
                >
                  {p === "x" ? "X" : p === "github" ? "GitHub" : "Discord"}
                </button>
              ))}
            </div>
          </div>

          {address ? (
            <p className="font-mono text-xs text-faint">
              {t("claim.payTo", { addr: shortAddress(address) })}
            </p>
          ) : null}

          {attestation ? (
            <div className="border-2 border-lime bg-lime/5 p-3">
              <p className="font-mono text-sm text-lime">
                {t("claim.verified", { handle: attestation.handle })}
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="border-2 border-pink bg-surface px-3 py-2 font-mono text-xs text-pink">
              {error}
            </p>
          ) : null}

          {attestation ? (
            <Button
              className="w-full"
              disabled={busy !== null || wrongChain}
              onClick={() => void claim()}
            >
              {busy === "claim" ? t("claim.claiming") : t("claim.claim")}
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={busy !== null || !tokenValid || !address}
              onClick={() => void check()}
            >
              {busy === "check" ? t("claim.checking") : t("claim.check")}
            </Button>
          )}

          <p className="text-xs leading-relaxed text-faint">{t("claim.note")}</p>
        </Card>
      )}
    </main>
  );
}
