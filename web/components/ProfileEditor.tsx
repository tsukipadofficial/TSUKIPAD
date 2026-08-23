"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

import { Button, Card, cx } from "./ui";
import { Avatar } from "./Avatar";
import { useI18n } from "@/lib/i18n";

type Profile = {
  handle: string; display: string; bio: string;
  avatar: string | null; wallet: string | null;
};

/// The picture the signed-in account already has, from whichever social was
/// linked. Saves the user hunting down an image URL, and means a profile has a
/// face the moment it is claimed rather than only if someone bothers.
function privyAvatar(u: ReturnType<typeof usePrivy>["user"]): string | undefined {
  // Of the linked-account types Privy exposes, only X carries a picture URL --
  // its Discord, GitHub and Google records give a username or an email but no
  // image. Anyone signed in another way falls back to the generated mark.
  const pic = u?.twitter?.profilePictureUrl;
  if (typeof pic !== "string") return undefined;
  // X serves these at `_normal` (48px), which is visibly soft at the sizes we
  // render. The 400x400 variant is the same asset at a usable resolution.
  return pic.replace("_normal.", "_400x400.");
}

/// Claim or edit the signed-in account's profile.
///
/// Keyed to the Privy account, but it records the connected wallet too, because
/// that is what the indexer knows a trader by. Without it a profile exists and
/// shows nothing, which reads as broken.
export function ProfileEditor() {
  const { t } = useI18n();
  const { address } = useAccount();
  const { authenticated, ready, login, getAccessToken, user } = usePrivy();

  const [stored, setProfile] = useState<Profile | null | undefined>(undefined);
  // Derived rather than reset in an effect: signing out has no work to
  // synchronise, so it is simply a different reading of the same state.
  const profile = authenticated ? stored : null;
  const [handle, setHandle] = useState("");
  const [display, setDisplay] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    let live = true;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;

      const r = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const j = await r.json();
      if (!live) return;

      let p: Profile | null = j.profile ?? null;

      // Signing in is enough to exist. An account with no profile is given a
      // generated name here rather than being shown an empty form -- the form
      // was a wall between signing in and appearing on the board at all, and
      // most people simply would not have filled it in.
      if (!p) {
        const made = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token, wallet: address, avatar: privyAvatar(user) }),
        });
        const mj = await made.json();
        if (!live) return;
        p = mj.ok ? mj.profile : null;
      }

      setProfile(p);
      if (p) {
        setHandle(p.handle);
        setDisplay(p.display);
        setBio(p.bio ?? "");
        setAvatar(p.avatar ?? privyAvatar(user) ?? "");
      } else {
        setAvatar(privyAvatar(user) ?? "");
      }
    })();
    return () => { live = false; };
  }, [authenticated, getAccessToken, user, address]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, handle, display, bio, avatar, wallet: address }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "unknown");
      setProfile(j.profile);
      setOpen(false);
    } catch (e) {
      const m = (e as Error).message;
      setError(
        m === "handle-taken" ? t("pf.errTaken")
        : m === "bad-handle" ? t("pf.errHandle")
        : m === "no-name-available" ? t("pf.errNoName")
        : t("pf.errGeneric"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <Card className="p-5 text-center">
        <p className="text-sm text-muted">{t("pf.signInToClaim")}</p>
        <Button className="mt-3" disabled={!ready} onClick={() => login()}>{t("nav.connect")}</Button>
      </Card>
    );
  }

  if (profile && !open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <Avatar src={profile.avatar} name={profile.display} size={40} />
        <div>
          <p className="font-bold text-ink">{profile.display}</p>
          <p className="font-mono text-xs text-faint">@{profile.handle}</p>
        </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/u/${profile.handle}`}>
            <Button variant="ghost" size="sm">{t("pf.view")}</Button>
          </Link>
          <Button size="sm" onClick={() => setOpen(true)}>{t("pf.edit")}</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-5">
      <p className="eyebrow">{t("pf.edit")}</p>
      <p className="text-xs leading-relaxed text-muted">{t("pf.renameHint")}</p>
      <div>
        <p className="mb-1 font-mono text-xs text-faint">{t("pf.handle")}</p>
        <div className="flex items-center border-2 border-line bg-void px-3">
          <span className="font-mono text-muted">@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            maxLength={20}
            spellCheck={false}
            className="w-full bg-transparent px-1 py-2.5 font-mono text-ink outline-none"
          />
        </div>
      </div>
      <div>
        <p className="mb-1 font-mono text-xs text-faint">{t("pf.display")}</p>
        <input
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          maxLength={40}
          className="w-full border-2 border-line bg-void px-3 py-2.5 text-ink outline-none"
        />
      </div>
      <div>
        <p className="mb-1 font-mono text-xs text-faint">{t("pf.bio")}</p>
        <input
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          className="w-full border-2 border-line bg-void px-3 py-2.5 text-sm text-ink outline-none"
        />
      </div>
      <div>
        <p className="mb-1 font-mono text-xs text-faint">{t("pf.avatar")}</p>
        <div className="flex items-center gap-3">
          <Avatar src={avatar || null} name={display || handle} size={40} />
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://…"
            spellCheck={false}
            className="w-full border-2 border-line bg-void px-3 py-2.5 font-mono text-xs text-ink outline-none"
          />
        </div>
      </div>
      {error ? <p className="font-mono text-xs text-pink">{error}</p> : null}
      <div className="flex gap-2">
        <Button className={cx(busy && "opacity-60")} disabled={busy} onClick={() => void save()}>
          {busy ? t("pf.saving") : t("pf.save")}
        </Button>
        {profile ? <Button variant="ghost" onClick={() => setOpen(false)}>{t("pf.cancel")}</Button> : null}
      </div>
    </Card>
  );
}
