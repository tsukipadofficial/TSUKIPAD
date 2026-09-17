import type { Metadata } from "next";
import Link from "next/link";

import { LegalList, LegalPage, LegalSection } from "@/components/LegalPage";
import { NAME, TELEGRAM_URL, X_URL } from "@/lib/brand";
import { MAX_CREATOR_TAX_BPS } from "@/lib/config";

export const metadata: Metadata = {
  title: `Terms of Use — ${NAME}`,
  description: `The terms for using ${NAME}, a non-custodial interface for launching and trading tokens on Arc.`,
};

const link = "underline decoration-lime underline-offset-4 hover:text-lime";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="16 September 2026"
      intro={
        <p>
          These terms apply when you use {NAME} at tsukipad.com. By using the site you agree to them. If you
          do not agree, do not use the site.
        </p>
      }
    >
      <LegalSection id="what" title="What TSUKIPAD is">
        <p>
          {NAME} is a website that lets you interact with smart contracts on the Arc blockchain to launch
          tokens and trade them on Uniswap v4. The contracts run on their own: once deployed, their rules
          are fixed and nobody — including us — can change them.
        </p>
        <p>
          The site is <b>non-custodial</b>. We never hold your funds, tokens, private keys or seed phrase.
          Every transaction is created by you, signed in your own wallet, and final once confirmed.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="Who can use it">
        <LegalList
          items={[
            "You must be at least 18 years old.",
            "You must not be a sanctioned person, or located in a sanctioned or embargoed country or region.",
            "You are responsible for making sure your use is legal where you live, including any tax obligations.",
          ]}
        />
      </LegalSection>

      <LegalSection id="tokens" title="Tokens are launched by users">
        <p>
          Anyone can launch a token. Tokens are created by their launchers, not by {NAME}. We do not review,
          endorse, or vouch for any token, its creator, its name, its image or any claim made about it. A
          token appearing on the site is not a recommendation.
        </p>
        <p>
          We may hide a token or profile from the site — for example, if it appears to be a scam, impersonates
          someone, or infringes someone&apos;s rights. Hiding it from the site does not and cannot change the
          token on the blockchain.
        </p>
      </LegalSection>

      <LegalSection id="fees" title="Fees">
        <p>The fees are set in the contracts and cannot be changed:</p>
        <LegalList
          items={[
            "There is no fee to launch. You pay network gas, in USDC.",
            <>Trades pay a 1% base fee, plus any creator tax the token&apos;s launcher set, up to {MAX_CREATOR_TAX_BPS / 100}%.</>,
            "Fees, including creator tax, are split 70% to the token's chosen recipient and 30% to the platform. A referrer, where there is one, receives 10% out of the platform's share.",
            "During a bonding-curve launch's first five seconds, a snipe tax applies to buys and is paid to the platform.",
          ]}
        />
        <p>
          The <Link href="/docs" className={link}>docs</Link> explain each fee in detail.
        </p>
      </LegalSection>

      <LegalSection id="rules" title="What you must not do">
        <LegalList
          items={[
            "Launch or promote a token to defraud people, including pump-and-dump schemes and fake giveaways.",
            "Impersonate a person, company or project, or suggest an endorsement that does not exist.",
            "Use names, logos or content you do not have the rights to.",
            "Use the site for money laundering, sanctions evasion or any other illegal activity.",
            "Attack, overload, or interfere with the site or the contracts.",
          ]}
        />
      </LegalSection>

      <LegalSection id="risks" title="Risks you accept">
        <LegalList
          items={[
            <><b>Tokens can lose all their value.</b> Most newly launched tokens do. Only use money you can afford to lose.</>,
            <><b>No advice.</b> Nothing on the site is financial, investment, legal or tax advice.</>,
            <><b>Transactions are final.</b> A transaction sent to the wrong address, or at a price you did not intend, cannot be reversed.</>,
            <><b>Selling depends on buyers.</b> You can only sell into USDC that other traders have put into a pool.</>,
            <><b>Software risk.</b> The contracts have not undergone a third-party audit. Smart contracts, the Arc network, Uniswap, wallets and other services can fail or be exploited.</>,
            <><b>Your keys.</b> You are responsible for your wallet and its security. Lost keys cannot be recovered by us.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="warranty" title="No warranty">
        <p>
          The site and the contracts are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind. We do not promise that the site will be available, accurate, or free of
          errors, or that any data it shows — prices, market caps, balances — is correct.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          To the fullest extent the law allows, {NAME} and the people behind it are not liable for any loss
          arising from your use of the site, the contracts or any token, including lost funds, lost profits,
          or losses caused by other users, bugs, exploits, or network failures.
        </p>
        <p>
          You agree to cover any claims, losses or costs brought against us that arise from your breach of
          these terms or your misuse of the site.
        </p>
      </LegalSection>

      <LegalSection id="third" title="Other services">
        <p>
          The site relies on services we do not control, including Arc, Uniswap, Privy, and wallet providers.
          Your use of them is governed by their own terms.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes and contact">
        <p>
          We may update these terms. The date at the top shows when they last changed, and continuing to use
          the site means you accept the current version. Our{" "}
          <Link href="/privacy" className={link}>Privacy Policy</Link> explains how we handle your
          information. Questions: contact us on{" "}
          <a href={X_URL} target="_blank" rel="noopener noreferrer" className={link}>X</a> or{" "}
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={link}>Telegram</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
