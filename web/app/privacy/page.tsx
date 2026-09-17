import type { Metadata } from "next";

import { LegalList, LegalPage, LegalSection } from "@/components/LegalPage";
import { NAME, TELEGRAM_URL, X_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy — ${NAME}`,
  description: `What ${NAME} collects, why, who it is shared with, and what is public on the blockchain.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="16 September 2026"
      intro={
        <p>
          {NAME} is a website for launching and trading tokens on Arc. We collect as little as we can.
          There are no ads and no analytics trackers. This page explains what we do collect, what is
          public by the nature of a blockchain, and the services involved.
        </p>
      }
    >
      <LegalSection id="blockchain" title="The blockchain is public">
        <p>
          Everything you do on-chain through {NAME} — launching a token, trading, collecting fees,
          claiming rewards — is recorded on the Arc blockchain. That record is public, permanent, and
          linked to your wallet address. Anyone can read it, and neither we nor anyone else can change or
          delete it.
        </p>
        <p>
          The site reads this public data to show token pages, live trades, positions, the leaderboard
          and earnings. We store copies of it to make those pages fast; the originals are on-chain.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <LegalList
          items={[
            <>
              <b>Sign-in.</b> When you sign in, our sign-in provider, Privy, gives us an account ID for
              you, your wallet address, and any accounts you chose to link (such as an email address, or an
              X or GitHub username).
            </>,
            <>
              <b>Your profile.</b> If you create one: a handle, display name, bio, avatar image link and the
              wallet it belongs to. Profiles are public and appear on your profile page and the leaderboard.
            </>,
            <>
              <b>Referrals.</b> If you arrived through a referral link, we record which wallet referred your
              account. This is permanent, so a referral cannot be taken away from whoever made it.
            </>,
            <>
              <b>Fee claims for social accounts.</b> If you claim fees earmarked for an X or GitHub account,
              we check with Privy that the account is linked to you, and sign a confirmation. We do not keep
              your social account&apos;s credentials.
            </>,
            <>
              <b>Token details you publish.</b> A token&apos;s name, symbol, image, description and links are
              written on-chain when you launch it. They are public and permanent.
            </>,
            <>
              <b>Technical logs.</b> Our hosting provider records standard request information, such as IP
              address, browser type and pages requested, to operate and secure the site.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="use" title="How we use it">
        <LegalList
          items={[
            "To sign you in and show your wallet, balances and positions.",
            "To display profiles, token pages, live trades and the leaderboard.",
            "To credit referrals and approve fee claims for social accounts.",
            "To keep the site working, secure, and free of abuse.",
          ]}
        />
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </LegalSection>

      <LegalSection id="browser" title="Stored in your browser">
        <p>
          The site keeps a few settings in your browser so it remembers them: your language, your light or
          dark theme, your wallet connection, and a referral link you arrived through. These are
          functional, not tracking. Clearing your browser data removes them.
        </p>
      </LegalSection>

      <LegalSection id="providers" title="Services we rely on">
        <p>These providers process data on our behalf to run the site:</p>
        <LegalList
          items={[
            <><b>Privy</b> — sign-in and embedded wallets.</>,
            <><b>Vercel</b> — hosting, and the technical logs described above.</>,
            <><b>Upstash</b> — the database that stores profiles, referrals and copies of public on-chain data.</>,
            <><b>Blockchain data providers</b> (Alchemy and Arc&apos;s public network endpoints) — reading the chain and sending your transactions. They see your wallet address and IP address when your browser contacts them.</>,
            <><b>Google Fonts</b> — serves the Japanese typeface, which shares your IP address with Google.</>,
            <><b>WalletConnect</b> — if you connect a mobile wallet through it.</>,
          ]}
        />
        <p>Each provider handles data under its own privacy policy.</p>
      </LegalSection>

      <LegalSection id="choices" title="Your choices">
        <LegalList
          items={[
            "You can use the site to browse without signing in.",
            "You can edit your profile at any time, or ask us to delete it and your referral record.",
            "Anything written to the blockchain cannot be deleted, by us or anyone else.",
          ]}
        />
      </LegalSection>

      <LegalSection id="security" title="Security and retention">
        <p>
          We keep off-chain data only as long as the site needs it, and protect it with access controls.
          We never hold your private keys or seed phrase, and we will never ask for them.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>{NAME} is not intended for anyone under 18, and we do not knowingly collect their information.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes and contact">
        <p>
          If this policy changes, we will update the date at the top of this page. For questions or
          requests about your information, contact us on{" "}
          <a href={X_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-lime underline-offset-4 hover:text-lime">
            X
          </a>{" "}
          or{" "}
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-lime underline-offset-4 hover:text-lime">
            Telegram
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
