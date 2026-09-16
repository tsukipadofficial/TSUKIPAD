"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { STORAGE_PREFIX } from "./brand";

export type Lang = "en" | "ja";

/// Every user-facing string in the app.
///
/// Kept as one flat typed object rather than JSON files so that a missing or
/// misspelled key is a TypeScript error rather than a blank space at runtime.
/// Values may contain `{name}` placeholders, filled by the second argument to `t`.
const STRINGS = {
  // --- chrome ---------------------------------------------------------
  "nav.board": { en: "Board", ja: "ボード" },
  "nav.launch": { en: "Launch", ja: "発行" },
  "nav.connect": { en: "Sign in", ja: "サインイン" },
  "nav.connecting": { en: "Connecting…", ja: "接続中…" },
  "nav.switchToArc": { en: "Switch to Arc", ja: "Arcに切替" },
  "nav.copyAddress": { en: "Click to copy full address", ja: "クリックで全アドレスをコピー" },
  "nav.copied": { en: "Copied", ja: "コピーしました" },
  "nav.signOut": { en: "Sign out", ja: "サインアウト" },
  "nav.explorer": { en: "Explorer", ja: "エクスプローラ" },
  "nav.dark": { en: "Dark", ja: "ダーク" },
  "nav.light": { en: "Light", ja: "ライト" },

  "footer.chain": { en: "Built on Arc Network · Arc Testnet · chain 5042002", ja: "Arc Network上に構築 · Arcテストネット · チェーン 5042002" },
  /// Required by the Arc Brand Guidelines and Partner Toolkit. Kept in English
  /// in both locales because it is a legal attribution, not UI copy.
  "footer.trademark": {
    en: "Arc is a trademark of Circle Internet Group, Inc. This project is not affiliated with or endorsed by Circle.",
    ja: "Arc は Circle Internet Group, Inc. の商標です。本プロジェクトは Circle と提携しておらず、承認も受けていません。",
  },
  "footer.independent": {
    en: "An independent project. Not built, operated or reviewed by Circle.",
    ja: "独立したプロジェクトです。Circle による開発・運営・審査は受けていません。",
  },
  "footer.disclaimer": {
    en: "Testnet only. Tokens launched here have no value. Liquidity is locked permanently by contract — but that is not a substitute for your own research.",
    ja: "テストネット専用です。ここで発行されるトークンに価値はありません。流動性はコントラクトにより恒久的にロックされますが、ご自身での調査に代わるものではありません。",
  },

  // --- hero -----------------------------------------------------------
  "hero.badge.testnet": { en: "Arc Testnet", ja: "Arcテストネット" },
  "hero.title.1": { en: "Launch at", ja: "時価総額" },
  "hero.title.2": { en: "Tradeable", ja: "どこでも" },
  "hero.title.3": { en: "everywhere", ja: "即座に取引" },
  "hero.title.4": { en: "instantly.", ja: "から発行。" },
  "hero.body": {
    en: "Open straight into a real Uniswap v4 pool paired with USDC, or start on a bonding curve that graduates into one at a $52K market cap. Either way you launch",
    ja: "USDCとペアの本物のUniswap v4プールで直接開始するか、時価総額$52KでUniswapへ移行するボンディングカーブから始められます。どちらの場合も",
  },
  "hero.body.bold": { en: "without putting up a cent", ja: "自己資金ゼロで発行でき" },
  "hero.body.end": { en: ", and it is locked forever by contract.", ja: "、流動性はコントラクトにより恒久的にロックされます。" },
  "hero.cta": { en: "Launch a token →", ja: "トークンを発行 →" },

  "how.title": { en: "How it works", ja: "仕組み" },
  "how.1.t": { en: "Deploy", ja: "デプロイ" },
  "how.1.b": { en: "Fixed supply, no mint, no owner, no tax.", ja: "固定供給。ミント機能・オーナー権限・税なし。" },
  "how.2.t": { en: "Open pool", ja: "プール開設" },
  "how.2.b": { en: "A USDC pool opens at your chosen $3K market cap.", ja: "指定した時価総額（例：$3,000）でUSDCプールが開きます。" },
  "how.3.t": { en: "Seed", ja: "供給" },
  "how.3.b": { en: "100% of supply becomes single-sided liquidity. You pay nothing.", ja: "供給量の100%が片側流動性になります。費用はかかりません。" },
  "how.4.t": { en: "Trade", ja: "取引" },
  "how.4.b": { en: "Live on Uniswap from block one, or start on a bonding curve that graduates into a locked pool.", ja: "最初のブロックからUniswapで取引するか、ロックされたプールへ移行するボンディングカーブから始めます。" },

  "stats.launches": { en: "Launches", ja: "発行数" },
  "stats.combinedCap": { en: "Combined cap", ja: "合計時価総額" },

  // --- board ----------------------------------------------------------
  "board.sort.new": { en: "Fresh", ja: "新着" },
  "board.sort.mcap": { en: "Top cap", ja: "時価総額順" },
  "board.sort.climbing": { en: "Climbing", ja: "上昇率順" },
  "board.search": { en: "Search name, ticker or address…", ja: "名称・ティッカー・アドレスで検索…" },
  "board.empty.title": { en: "No launches yet.", ja: "まだ発行がありません。" },
  "board.empty.body": { en: "The board is empty. Be the first token on Arc.", ja: "ボードは空です。Arc最初のトークンを発行しましょう。" },
  "board.empty.cta": { en: "Launch the first one →", ja: "最初の一つを発行 →" },
  "board.noMatch.title": { en: "Nothing matches that.", ja: "該当するものがありません。" },
  "board.noMatch.body": { en: "Try a different ticker or address.", ja: "別のティッカーやアドレスをお試しください。" },
  "board.error.title": { en: "Could not reach the launchpad.", ja: "ローンチパッドに接続できませんでした。" },
  "board.error.body": {
    en: "Check that the RPC is reachable and the contract address is correct.",
    ja: "RPCへの接続とコントラクトアドレスをご確認ください。",
  },

  // --- launch card ----------------------------------------------------
  "card.new": { en: "new", ja: "新着" },
  "card.soldOut": { en: "sold out", ja: "完売" },
  "card.earns": { en: "earns", ja: "報酬" },
  "card.funds": { en: "funds", ja: "寄付" },
  "card.supplySold": { en: "{pct} of supply sold", ja: "供給の{pct}が売却済" },
  "card.by": { en: "by {addr}", ja: "発行者 {addr}" },
  "card.ceiling": { en: "{amount} ceiling", ja: "上限 {amount}" },

  // --- create form ----------------------------------------------------
  "create.title": { en: "Launch a token", ja: "トークンを発行" },
  "create.subtitle": {
    en: "Fixed supply, no mint function, no owner keys. Start on a bonding curve or open straight into Uniswap — either way you provide",
    ja: "固定供給、ミント機能なし、オーナー権限なし。ボンディングカーブから始めるか、Uniswapで直接開始します。どちらも",
  },
  "create.subtitle.bold": { en: "no USDC at all", ja: "USDCの拠出は一切不要" },
  "create.subtitle.end": { en: "— and that liquidity can never be withdrawn.", ja: "で、その流動性は引き出すことができません。" },

  "field.name": { en: "Name", ja: "名称" },
  "field.name.hint": { en: "2–32 characters", ja: "2〜32文字" },
  "field.ticker": { en: "Ticker", ja: "ティッカー" },
  "field.ticker.hint": { en: "A–Z and 0–9, 2–10 characters", ja: "英数字（A〜Z、0〜9）2〜10文字" },
  "field.description": { en: "Description", ja: "説明" },
  "field.description.ph": { en: "What is this?", ja: "どんなトークンですか？" },
  "field.picture": { en: "Picture", ja: "画像" },
  "field.optional": { en: "optional", ja: "任意" },
  "field.website": { en: "Website", ja: "ウェブサイト" },
  "field.telegram": { en: "Telegram", ja: "Telegram" },

  "image.choose": { en: "Choose an image", ja: "画像を選択" },
  "image.processing": { en: "Processing…", ja: "処理中…" },
  "image.drop": { en: "or drop it here · resized to 128px, kept fully on-chain", ja: "またはドラッグ＆ドロップ · 128pxに縮小し、完全オンチェーンで保存" },
  "image.stored": { en: "Stored on-chain", ja: "オンチェーンに保存" },
  "image.remove": { en: "Remove", ja: "削除" },
  "image.nearLimit": {
    en: "This image is near the size limit. A simpler picture would cost less gas.",
    ja: "画像サイズが上限に近づいています。よりシンプルな画像の方がガス代を抑えられます。",
  },

  "field.openingMcap": { en: "Opening market cap", ja: "開始時価総額" },
  "field.openingMcap.hint": { en: "Where trading starts. Nobody can buy in lower.", ja: "取引開始価格です。これより安く購入することはできません。" },
  "field.ceiling": { en: "Ceiling", ja: "上限価格" },
  "field.ceiling.hint": { en: "Top of the liquidity range. Above this, no supply is left to buy.", ja: "流動性レンジの上限です。これを超えると購入できる供給がなくなります。" },

  "field.fees": { en: "Who earns the swap fees", ja: "取引手数料の受取先" },
  "fees.creator.t": { en: "You keep them", ja: "自分が受け取る" },
  "fees.creator.b": { en: "Fees accrue to you as USDC, claimable any time.", ja: "USDCで手数料が蓄積され、いつでも請求できます。" },
  "fees.holders.t": { en: "Holders earn", ja: "保有者に分配" },
  "fees.holders.b": { en: "Fees become USDC that every holder claims pro-rata. Cashable.", ja: "手数料はUSDCとなり、保有量に応じて全保有者が請求できます。換金可能です。" },
  "fees.redirect.t": { en: "Send them to a project", ja: "プロジェクトに寄付" },
  "fees.redirect.b": { en: "Fund a dev, a repo or a cause. You earn nothing from this launch.", ja: "開発者やリポジトリ、活動を支援します。発行者の収益はゼロになります。" },
  "fees.burn.t": { en: "Buy back and burn", ja: "買い戻して焼却" },
  "fees.burn.b": {
    en: "Fees buy the token off its own pool and destroy it. Supply shrinks forever.",
    ja: "手数料でプールからトークンを買い戻し、焼却します。供給量は永久に減少します。",
  },
  "fees.burn.note": { en: "Every trade permanently shrinks the supply.", ja: "全ての取引が供給量を永久に減らします。" },
  "preview.badge.burn": { en: "deflationary", ja: "デフレ型" },
  "preview.badge.burn.b": {
    en: "Trading fees buy the token back and burn it, so supply only ever falls.",
    ja: "取引手数料でトークンを買い戻して焼却するため、供給量は減る一方です。",
  },
  "burn.title": { en: "Buy back & burn", ja: "買い戻し・焼却" },
  "burn.body": {
    en: "This launch spends its fee share buying {sym} off the market and destroying it. Supply only ever falls.",
    ja: "このトークンは手数料で{sym}を市場から買い戻し、焼却します。供給量は減る一方です。",
  },
  "burn.spent": { en: "Spent buying back", ja: "買い戻し総額" },
  "burn.burned": { en: "Supply destroyed", ja: "焼却済供給量" },
  "burn.ofSupply": { en: "{pct} of the original supply is gone", ja: "当初供給量の{pct}が焼却済" },
  "token.deflationary": { en: "deflationary", ja: "デフレ型" },
  "card.burns": { en: "burns", ja: "焼却" },
  "facts.fees.burn": { en: "Buy the token back and burn it", ja: "買い戻して焼却" },
  "fees.immutable": { en: "This cannot be changed after launch.", ja: "発行後は変更できません。" },
  "fees.holders.note": { en: "Holding the token pays real USDC.", ja: "トークンを保有するだけで実際のUSDCが得られます。" },

  "field.recipient": { en: "Recipient wallet", ja: "受取ウォレット" },
  "field.recipient.hint": { en: "Where the fees are actually sent.", ja: "手数料が実際に送られる先です。" },
  "field.funds": { en: "Who it funds", ja: "支援先" },
  "field.funds.hint": { en: "An X handle, a GitHub repo, or a link. Shown on the token page.", ja: "Xのハンドル、GitHubリポジトリ、またはリンク。トークンページに表示されます。" },
  "field.funds.warning": {
    en: "Nobody can prove a social account owns a wallet, so this label is only a claim. The recipient address is always displayed next to it.",
    ja: "SNSアカウントとウォレットの所有関係は証明できないため、この表記はあくまで自己申告です。受取アドレスは常に併記されます。",
  },

  "field.allocation": { en: "Creator allocation — {pct}%", ja: "発行者の取り分 — {pct}%" },
  "field.allocation.none": { en: "Nothing withheld. The purest fair launch.", ja: "留保なし。最も公平な発行方式です。" },
  "field.allocation.some": {
    en: "You keep {amount}M tokens, sent to your wallet at launch. Buyers can see this.",
    ja: "{amount}Mトークンを留保し、発行時にウォレットへ送られます。購入者からも確認できます。",
  },

  // --- bonding curve -------------------------------------------------
  "create.type": { en: "Launch type", ja: "発行方式" },
  "create.type.curve.t": { en: "Bonding curve", ja: "ボンディングカーブ" },
  "create.type.curve.b": {
    en: "Trades on a curve until {goal} is raised, then graduates into a locked Uniswap pool at a {mcap} market cap.",
    ja: "{goal}が集まるまでカーブ上で取引され、時価総額{mcap}でロックされたUniswapプールへ移行します。",
  },
  "create.type.direct.t": { en: "Direct pool", ja: "ダイレクトプール" },
  "create.type.direct.b": {
    en: "Opens straight into a Uniswap v4 pool. Tradeable anywhere from block one.",
    ja: "最初からUniswap v4プールで開始。最初のブロックからどこでも取引できます。",
  },
  "curve.devBuy": { en: "Developer buy", ja: "開発者購入" },
  "curve.devBuy.hint": {
    en: "{bal} USDC available. Bought in the launch transaction, free of the snipe tax.",
    ja: "利用可能: {bal} USDC。発行トランザクション内で購入され、スナイプ税はかかりません。",
  },
  "curve.devBuy.graduates": {
    en: "This buys out the whole curve: the launch graduates in the same transaction.",
    ja: "カーブ全体を買い切るため、発行と同時に移行します。",
  },
  "curve.max": { en: "Max", ja: "最大" },
  "curve.advanced": { en: "Advanced", ja: "詳細設定" },
  "curve.holders.t": { en: "Holder fee sharing", ja: "ホルダーへの手数料分配" },
  "curve.holders.off": { en: "Creator fees go to the creator wallet", ja: "発行者手数料は発行者ウォレットへ" },
  "curve.holders.on": { en: "Creator fees go to holders", ja: "発行者手数料はホルダーへ" },
  "curve.holders.b": {
    en: "Route this launch's creator fees to its holders, split pro rata for each holder to claim.",
    ja: "この発行の発行者手数料をホルダーへ保有量に応じて分配し、各自が受け取れるようにします。",
  },
  "curve.wallet": { en: "Creator wallet", ja: "発行者ウォレット" },
  "curve.wallet.hint": {
    en: "Receives creator fees and the creator tax. Leave blank to use your connected wallet.",
    ja: "発行者手数料と発行者税を受け取ります。空欄なら接続中のウォレットを使います。",
  },
  "curve.tax": { en: "Creator tax", ja: "発行者税" },
  "curve.tax.hint": {
    en: "Traders pay {total} in total, {yours} of it yours. Up to {max}. The pool's hook charges it on buys and sells alike, on the curve and after graduation -- the rate never changes.",
    ja: "取引手数料は合計{total}、うち{yours}があなたの取り分です。上限{max}。フックが買いと売りの両方に課金し、カーブ中も移行後も同じ料率です。",
  },
  "curve.exempt": { en: "Snipe tax exemptions", ja: "スナイプ税の免除" },
  "curve.exempt.hint": {
    en: "Buys in the launch second pay 99%, decaying to zero across 5s. Declare the wallets your team opens with (up to {n}).",
    ja: "発行直後の購入は99%課税され、5秒でゼロまで減衰します。チームが最初に使うウォレットを指定できます（最大{n}件）。",
  },
  "curve.exempt.ph": { en: "0x wallet address", ja: "0x ウォレットアドレス" },
  "curve.pv.launchFee": { en: "Launch fee", ja: "発行手数料" },
  "curve.pv.free": { en: "Free", ja: "無料" },
  "curve.pv.paired": { en: "Paired with", ja: "ペア資産" },
  "curve.pv.tradeFee": { en: "Trade fee", ja: "取引手数料" },
  "curve.pv.tradeFee.v": { en: "{total} · {yours} yours", ja: "{total} · うち{yours}" },
  "curve.pv.window": { en: "Launch window", ja: "発行直後" },
  "curve.pv.window.v": { en: "99% snipe tax, 5s", ja: "99%スナイプ税、5秒" },
  "curve.pv.opens": { en: "Opens at", ja: "開始時価総額" },
  "curve.pv.graduation": { en: "Graduation", ja: "移行条件" },
  "curve.pv.graduation.v": { en: "{goal} raised · {mcap}", ja: "{goal}調達 · {mcap}" },
  "curve.pv.pool": { en: "Then trades on", ja: "移行先" },
  "curve.pv.liquidity": { en: "Liquidity", ja: "流動性" },
  "curve.pv.liquidity.v": { en: "Locked forever", ja: "永久ロック" },
  "curve.pv.explain": {
    en: "Buyers push the price up the curve. Once {goal} has been raised the curve sells out, and that USDC plus the supply held back becomes a Uniswap v4 pool at the same price, locked forever.",
    ja: "購入によって価格がカーブを上昇します。{goal}が集まるとカーブは完売し、そのUSDCと留保された供給が同じ価格でUniswap v4プールとなり、永久にロックされます。",
  },
  "curve.badge": { en: "bonding curve", ja: "ボンディングカーブ" },
  "curve.graduated": { en: "graduated", ja: "移行済" },
  "curve.progress": { en: "Bonding curve progress", ja: "ボンディングカーブの進捗" },
  "curve.raised": { en: "{raised} of {goal} raised", ja: "{goal}中{raised}調達" },
  "curve.graduatesAt": { en: "Graduates at", ja: "移行時価総額" },
  "curve.toGo": { en: "Left to graduate", ja: "移行まで残り" },
  "curve.explain": {
    en: "When the curve sells out, {goal} and the supply held back move into a Uniswap v4 pool at the same price, and that liquidity is locked forever. Until then tokens are bought from and sold back to the curve, and cannot be sent between wallets.",
    ja: "カーブが完売すると、{goal}と留保された供給が同じ価格でUniswap v4プールへ移り、その流動性は永久にロックされます。それまではカーブとの売買のみで、ウォレット間の送金はできません。",
  },
  "curve.graduatedExplain": {
    en: "This launch sold out its curve and now trades in a locked Uniswap v4 pool at the 1% fee tier.",
    ja: "この発行はカーブを完売し、現在はロックされたUniswap v4プール（手数料1%）で取引されています。",
  },
  "curve.fees.title": { en: "Creator fees", ja: "発行者手数料" },
  "curve.fees.owed": { en: "waiting to be paid out", ja: "支払い待ち" },
  "curve.fees.body": {
    en: "Fees build up here as people trade. Anyone can trigger the payout; it only ever goes to {to}.",
    ja: "取引のたびにここに手数料が貯まります。支払いは誰でも実行でき、送金先は常に{to}です。",
  },
  "curve.fees.holders": { en: "the holders", ja: "ホルダー" },
  "curve.fees.pay": { en: "Pay out", ja: "支払う" },
  "curve.fees.collect": { en: "Collect pool fees", ja: "プール手数料を回収" },
  "curve.fees.working": { en: "Working…", ja: "処理中…" },
  "facts.transfers": { en: "Transfers", ja: "送金" },
  "facts.transfers.locked": { en: "Open at graduation", ja: "移行時に解放" },
  "facts.transfers.open": { en: "Open", ja: "可能" },
  "facts.fees.curve": { en: "{total} on curve trades, {yours} to {to}", ja: "カーブ取引で{total}、うち{yours}が{to}へ" },
  "facts.graduation": { en: "Graduation", ja: "移行" },
  "trade.fee": { en: "Fee", ja: "手数料" },
  "trade.snipeTax": { en: "Includes a {pct} snipe tax. It falls to zero within 5 seconds of launch.", ja: "{pct}のスナイプ税を含みます。発行から5秒以内にゼロになります。" },
  "trade.curveGraduates": { en: "This buy finishes the curve and graduates the launch. You are only charged the {used} it takes.", ja: "この購入でカーブが完売し、移行します。請求されるのは必要な{used}のみです。" },
  "trade.onCurve": { en: "Trading on the bonding curve", ja: "ボンディングカーブで取引中" },
  "card.graduated": { en: "graduated", ja: "移行済" },
  "card.toGraduation": { en: "{pct} to graduation", ja: "移行まで{pct}" },
  "card.graduatesAt": { en: "graduates at {amount}", ja: "移行 {amount}" },
  "board.filter.all": { en: "All", ja: "すべて" },
  "board.filter.curve": { en: "Curve", ja: "カーブ" },
  "board.filter.graduated": { en: "Graduated", ja: "移行済" },
  "board.filter.direct": { en: "Direct", ja: "ダイレクト" },

  "preview.title": { en: "Launch preview", ja: "プレビュー" },
  "preview.opensAt": { en: "Opens at", ja: "開始時価総額" },
  "preview.ceiling": { en: "Ceiling", ja: "上限" },
  "preview.openingPrice": { en: "Opening price", ja: "開始価格" },
  "preview.fillsCurve": { en: "Fills curve", ja: "完売までの購入額" },
  "preview.fillsCurve.sub": { en: "buying to sell out", ja: "全供給の売却に必要な額" },
  "preview.supply": { en: "{n} supply", ja: "供給量 {n}" },
  "preview.explain": {
    en: "Roughly {amount} of net buying takes this from {start} to its ceiling, at which point every token has been sold. The ceiling mainly sets how much headroom the token has — it barely changes the early price action, so pick it for ambition, not for speed.",
    ja: "およそ{amount}の純購入で{start}から上限に到達し、その時点で全トークンが売却されます。上限は主に伸びしろを決めるもので、初期の値動きにはほとんど影響しません。速度ではなく目標の高さで選んでください。",
  },
  "fees.split": { en: "Trading fees", ja: "取引手数料の配分" },
  "preview.badge.direct": { en: "Uniswap v4 · 1% fee", ja: "Uniswap v4 · 手数料1%" },
  "preview.feesTo": { en: "Fees to", ja: "手数料の行き先" },
  "preview.explain.short": {
    en: "Opens at {start} with every token already in the pool, and the liquidity is locked at launch. Nobody can buy in lower than you.",
    ja: "全供給をプールに入れた状態で{start}から取引開始。流動性は発行時にロックされ、あなたより安く買える人はいません。",
  },
  "fees.split.v": { en: "{creator} creator / {protocol} protocol", ja: "発行者{creator} / プロトコル{protocol}" },
  "preview.badge.creator": { en: "creator fees", ja: "発行者が受取" },
  "preview.badge.holders": { en: "holder rewards", ja: "保有者に分配" },
  "preview.badge.funds": { en: "funds a project", ja: "プロジェクトに寄付" },
  "preview.badge.creator.b": { en: "You collect the creator share of every trade.", ja: "全ての取引の発行者分を受け取ります。" },
  "preview.badge.holders.b": { en: "Every buyer earns claimable USDC just for holding, funded by trading fees.", ja: "取引手数料を原資に、保有するだけでUSDCを獲得できます。" },
  "preview.badge.funds.b": { en: "Every trade funds {target}. You earn nothing.", ja: "全ての取引が{target}を支援します。発行者の収益はありません。" },
  "preview.badge.funds.fallback": { en: "the nominated wallet", ja: "指定されたウォレット" },

  "cost.title": { en: "Your cost to launch", ja: "発行にかかる費用" },
  "cost.gas": { en: "+ gas", ja: "＋ガス代" },
  "cost.body": {
    en: "Single-sided liquidity means the pool is seeded entirely with your token. Gas is paid in USDC, since that is Arc's native gas asset.",
    ja: "片側流動性のため、プールはあなたのトークンのみで構成されます。ArcのネイティブガスはUSDCなので、ガス代もUSDCで支払います。",
  },

  "cta.launch": { en: "Launch it →", ja: "発行する →" },
  "cta.notDeployed": { en: "Contracts not deployed", ja: "コントラクト未デプロイ" },
  "cta.connect": { en: "Connect a wallet", ja: "ウォレットを接続" },
  "cta.switchNetwork": { en: "Switch to Arc Testnet", ja: "Arcテストネットに切替" },
  "cta.working": { en: "Working…", ja: "処理中…" },

  "status.hashing": { en: "Computing deployment hash…", ja: "デプロイハッシュを計算中…" },
  "status.mining": { en: "Mining a token address below USDC…", ja: "USDCより小さいアドレスを探索中…" },
  "status.found": { en: "Found {addr}… in {n} attempts. Confirm in your wallet.", ja: "{n}回で{addr}…を発見しました。ウォレットで承認してください。" },
  "status.launching": { en: "Launching…", ja: "発行中…" },
  "status.approving": { en: "Approve USDC for your developer buy…", ja: "開発者購入のためUSDCを承認してください…" },
  "curve.pv.name": { en: "Your token", ja: "あなたのトークン" },
  "curve.pv.ticker": { en: "ticker", ja: "ティッカー" },
  "cost.devBuy": { en: "your developer buy, + gas", ja: "開発者購入分 ＋ガス代" },
  "err.nameLength": { en: "Name must be 2–32 characters.", ja: "名称は2〜32文字で入力してください。" },
  "err.ticker": { en: "Ticker must be 2–10 characters, letters and digits only.", ja: "ティッカーは英数字2〜10文字で入力してください。" },

  // --- token page -----------------------------------------------------
  "token.liquidityLocked": { en: "liquidity locked", ja: "流動性ロック済" },
  "token.holdersEarn": { en: "holders earn USDC", ja: "保有者がUSDCを獲得" },
  "token.feesFund": { en: "fees fund a project", ja: "手数料をプロジェクトへ" },
  "token.launchedAgo": { en: "launched {t}", ja: "{t}に発行" },
  "token.fromLaunch": { en: "{n}× from launch", ja: "発行時比 {n}倍" },
  "curve.start": { en: "{amount} start", ja: "開始 {amount}" },
  "curve.toFill": { en: "{amount} to fill", ja: "完売まで {amount}" },
  "curve.ceiling": { en: "{amount} ceiling", ja: "上限 {amount}" },
  "token.priceCurve": { en: "Price curve", ja: "価格カーブ" },
  "token.supplySold": { en: "{pct} of supply sold", ja: "供給の{pct}が売却済" },
  "token.price": { en: "Price", ja: "価格" },
  "token.marketCap": { en: "Market cap", ja: "時価総額" },
  "token.leftToFill": { en: "Left to fill", ja: "完売までの残り" },
  "token.ceiling": { en: "Ceiling", ja: "上限" },
  "token.curveExplain": {
    en: "{pct} of the supply is already sold, yet {amount} of buying is still needed to reach the ceiling. Those numbers differ because liquidity is concentrated: the early supply sells cheaply, and most of the dollars arrive near the top of the range.",
    ja: "供給の{pct}が既に売却済ですが、上限到達にはさらに{amount}の購入が必要です。流動性が集中しているためで、初期の供給は安価に売れ、大半の資金はレンジ上部で入ります。",
  },
  "token.liveTrades": { en: "Live trades", ja: "取引履歴" },
  "token.tradesLoading": { en: "Loading recent trades…", ja: "取引履歴を読込中…" },
  "token.noTrades": { en: "No trades yet. Be the first.", ja: "まだ取引がありません。最初の取引者になりましょう。" },
  "token.buy": { en: "BUY", ja: "買い" },
  "token.sell": { en: "SELL", ja: "売り" },
  "token.notFound": { en: "Not a launch from this pad.", ja: "このローンチパッド発行のトークンではありません。" },
  "token.notFound.body": { en: "{addr} was not created here.", ja: "{addr}はここで発行されていません。" },
  "token.loadFailed": { en: "Could not load this token.", ja: "このトークンを読み込めませんでした。" },
  "token.loadFailedBody": {
    en: "The network did not answer. This is not a problem with the token — retrying.",
    ja: "ネットワークが応答しませんでした。トークン側の問題ではありません。再試行しています。",
  },
  "token.back": { en: "Back to the board", ja: "ボードに戻る" },
  "token.notConfigured": { en: "Contracts are not configured yet.", ja: "コントラクトが未設定です。" },

  "facts.title": { en: "Contract facts", ja: "コントラクト情報" },
  "facts.supply": { en: "Supply", ja: "供給量" },
  "facts.mint": { en: "Mint function", ja: "ミント機能" },
  "facts.mint.v": { en: "None — supply is fixed forever", ja: "なし — 供給量は永久に固定" },
  "facts.owner": { en: "Owner keys", ja: "オーナー権限" },
  "facts.owner.v": { en: "None — the token has no admin", ja: "なし — 管理者は存在しません" },
  "facts.tax": { en: "Transfer tax", ja: "送金税" },
  "facts.tax.v": { en: "None", ja: "なし" },
  "facts.liquidity": { en: "Liquidity", ja: "流動性" },
  "facts.liquidity.v": { en: "Locked permanently; no withdrawal path exists", ja: "恒久的にロック。引き出し手段は存在しません" },
  "facts.creator": { en: "Creator", ja: "発行者" },
  "facts.metadata": { en: "Metadata", ja: "メタデータ" },
  "facts.metadata.img": { en: "Fully on-chain, image included", ja: "画像を含め完全オンチェーン" },
  "facts.metadata.plain": { en: "Stored on-chain", ja: "オンチェーンに保存" },
  "facts.fees": { en: "Swap fees", ja: "取引手数料" },
  "facts.fees.holders": { en: "Shared with holders as claimable USDC", ja: "USDCとして保有者に分配" },
  "facts.fees.creator": { en: "Collected by the creator", ja: "発行者が受領" },
  "facts.fees.earmarked": { en: "Held for a named account until claimed", ja: "指定アカウントが受け取るまで保管" },
  "facts.fees.claimed": { en: "Sent to the claimed account at {addr}", ja: "受取済みアカウント {addr} へ送金" },
  "facts.fees.redirect": { en: "Sent to {addr}", ja: "{addr}へ送金" },

  "rug.title": { en: "Why this can't rug", ja: "ラグプルできない理由" },
  "rug.body": {
    en: "The pool's liquidity position is owned by the launchpad contract, which exposes no function that burns it. Fees can be claimed; principal cannot be moved — not by the creator, not by the launchpad owner, not by anyone.",
    ja: "プールの流動性ポジションはローンチパッドのコントラクトが保有し、これを焼却する関数は存在しません。手数料は請求できますが元本は移動できません。発行者もローンチパッド運営者も、誰も動かせません。",
  },

  // --- trade panel ----------------------------------------------------
  "trade.youPay": { en: "You pay", ja: "支払い" },
  "trade.youReceive": { en: "You receive", ja: "受取" },
  "trade.balance": { en: "balance {n} {sym}", ja: "残高 {n} {sym}" },
  "trade.priceImpact": { en: "Price impact", ja: "価格影響" },
  "trade.slippage": { en: "Max slippage", ja: "最大スリッページ" },
  "trade.approve": { en: "Approve {sym}", ja: "{sym}を承認" },
  "trade.approving": { en: "Approving…", ja: "承認中…" },
  "trade.confirming": { en: "Confirming…", ja: "確認中…" },
  "trade.checkWallet": { en: "Check wallet…", ja: "ウォレットを確認…" },
  "trade.buySym": { en: "Buy {sym}", ja: "{sym}を買う" },
  "trade.sellSym": { en: "Sell {sym}", ja: "{sym}を売る" },
  "trade.wrongNetwork": { en: "Wrong network", ja: "ネットワークが違います" },
  "trade.quoteUnavailable": { en: "Quote unavailable — check balance and approval.", ja: "見積もりを取得できません。残高と承認をご確認ください。" },
  "trade.soldOut": {
    en: "The curve is fully bought out — there is no supply left in the range. You can still sell into it.",
    ja: "カーブは完売しました。レンジ内に供給は残っていません。売却は引き続き可能です。",
  },

  // --- rewards --------------------------------------------------------
  "rewards.title": { en: "Holder rewards", ja: "保有者報酬" },
  "rewards.body": {
    en: "This launch shares its trading fees. Hold {sym} and you earn real USDC — claimable any time, no staking, no lock-up.",
    ja: "このトークンは取引手数料を分配します。{sym}を保有するだけで実際のUSDCを獲得でき、ステーキングやロックなしでいつでも請求できます。",
  },
  "rewards.canClaim": { en: "You can claim", ja: "請求可能額" },
  "rewards.paidOut": { en: "Paid to holders", ja: "保有者への分配総額" },
  "rewards.claimed": { en: "Claimed {amount} USDC.", ja: "{amount} USDCを請求しました。" },
  "rewards.claim": { en: "Claim {amount}", ja: "{amount}を請求" },
  "rewards.nothingYet": { en: "Nothing to claim yet", ja: "請求できる報酬はまだありません" },
  "rewards.buyToEarn": { en: "Buy {sym} to start earning", ja: "{sym}を購入して報酬を獲得" },
  "rewards.sweep": { en: "Sweep new fees from the pool into rewards", ja: "プールの手数料を報酬に反映する" },


  // --- fee redirect ---------------------------------------------------
  "redirect.title": { en: "Where the fees go", ja: "手数料の送金先" },
  "redirect.body": { en: "The creator takes nothing from this launch. Trading fees are sent to:", ja: "発行者はこのトークンから収益を得ません。取引手数料は次の宛先に送られます：" },
  "claimed.title": { en: "Fees claimed", ja: "手数料の受取先（確定）" },
  "claimed.body": {
    en: "The account this launch earmarked its fees for has proved ownership of a wallet. Every future fee goes straight there:",
    ja: "このローンチが指定したアカウントがウォレットの所有を証明しました。以降の手数料はこのアドレスに直接送られます：",
  },
  "claimed.by": { en: "claimed by {target}", ja: "{target} が受取済み" },
  "redirect.claimed": {
    en: "Claimed to fund {target}. Nobody can prove a social account owns a wallet — verify the address yourself before trusting the claim.",
    ja: "{target}への支援を表明しています。SNSアカウントとウォレットの所有関係は証明できないため、アドレスをご自身でご確認ください。",
  },
  // --- uncollected fees -------------------------------------------------
  "fees.title": { en: "Still in the pool", ja: "プール内の未回収分" },
  "fees.loading": { en: "Reading the pool…", ja: "プールを読込中…" },
  "fees.row.creator": { en: "Creator", ja: "発行者" },
  "fees.row.referrer": { en: "Referrer", ja: "紹介者" },
  "fees.row.protocol": { en: "Protocol", ja: "プロトコル" },
  "fees.you": { en: "you", ja: "あなた" },
  "fees.anyone": {
    en: "Fees the pool has earned but nobody has swept yet. Anyone can collect; whoever presses it pays the gas, and the fees always go to the addresses recorded at launch.",
    ja: "プールが獲得済みで、まだ回収されていない手数料です。誰でも回収でき、押した人がガス代を負担します。手数料は必ずローンチ時に記録されたアドレスへ送られます。",
  },
  "fees.collect": { en: "Collect fees", ja: "手数料を回収" },
  "fees.collecting": { en: "Collecting…", ja: "回収中…" },
  // --- referrals --------------------------------------------------------
  "nav.referrals": { en: "Referrals", ja: "紹介" },
  "ref.title": { en: "Bring people in.", ja: "仲間を連れてくる。" },
  "ref.sub": {
    en: "Share your link. When someone launches a token through it, you earn 10% of that token's swap fees for as long as it trades.",
    ja: "リンクを共有してください。そのリンク経由でトークンがローンチされると、その取引が続く限り取引手数料の10%を獲得できます。",
  },
  "ref.signInFirst": { en: "Sign in to get your link.", ja: "サインインしてリンクを取得してください。" },
  "ref.yourLink": { en: "Your link", ja: "あなたのリンク" },
  "ref.copy": { en: "Copy", ja: "コピー" },
  "ref.howItWorks": {
    en: "The link records you in the visitor's browser. When they launch, you are written onto that token permanently — the rate is fixed at launch and cannot be changed afterwards, by us or anyone.",
    ja: "リンクは訪問者のブラウザにあなたを記録します。ローンチ時にそのトークンへ恒久的に記録され、料率はローンチ時に固定され、後から誰も変更できません。",
  },
  "ref.yourLaunches": { en: "Launches you brought in", ja: "あなたが紹介したローンチ" },
  "ref.count": { en: "{n} launches", ja: "{n}件" },
  "ref.loading": { en: "Reading the board…", ja: "ボードを読込中…" },
  "ref.empty": {
    en: "Nothing yet. Share your link and it will show up here.",
    ja: "まだありません。リンクを共有すると、ここに表示されます。",
  },
  "ref.paidAutomatically": {
    en: "Referrals are paid straight to your wallet whenever anyone collects that launch's fees — there is nothing here to claim. Open a launch to collect it yourself.",
    ja: "紹介報酬は、誰かがそのローンチの手数料を回収した時点であなたのウォレットへ直接支払われます。ここで請求する必要はありません。自分で回収するにはローンチを開いてください。",
  },
  // --- earmarking a recipient -------------------------------------------
  "field.recipient.wallet": { en: "A wallet", ja: "ウォレット" },
  "field.recipient.identity": { en: "An account", ja: "アカウント" },
  "field.identity": { en: "Whose account", ja: "対象アカウント" },
  "field.identity.hint": {
    en: "For someone who has no wallet yet. Fees are held until they prove the account is theirs.",
    ja: "ウォレットを持っていない相手向け。本人確認が済むまで手数料は保管されます。",
  },
  "field.identity.escrow": {
    en: "Fees will be held for {who} until they sign in and prove the account is theirs. Nobody else can take them — not you, and not us.",
    ja: "{who} がサインインして本人確認をするまで、手数料は保管されます。あなたにも当方にも引き出せません。",
  },
  // --- claiming an earmarked launch -------------------------------------
  "nav.claim": { en: "Claim", ja: "受取" },
  "claim.title": { en: "Claim fees earmarked for you.", ja: "あなた宛の手数料を受け取る。" },
  "claim.sub": {
    en: "Someone launched a token and set its fees aside for your account. Sign in with that account to collect them.",
    ja: "誰かがあなたのアカウント宛に手数料を確保してローンチしました。そのアカウントでサインインして受け取ってください。",
  },
  "claim.signInFirst": { en: "Sign in with the account the fees were earmarked for.", ja: "対象アカウントでサインインしてください。" },
  "claim.tokenLabel": { en: "Token address", ja: "トークンアドレス" },
  "claim.providerLabel": { en: "Which account", ja: "アカウント種別" },
  "claim.payTo": { en: "Fees will be paid to {addr}", ja: "手数料は {addr} に支払われます" },
  "claim.check": { en: "Check my account", ja: "アカウントを確認" },
  "claim.checking": { en: "Checking…", ja: "確認中…" },
  "claim.verified": { en: "Verified as @{handle} — you can claim this.", ja: "@{handle} として確認できました。受け取れます。" },
  "claim.claim": { en: "Claim the fees", ja: "手数料を受け取る" },
  "claim.claiming": { en: "Claiming…", ja: "受取処理中…" },
  "claim.done": { en: "Claimed.", ja: "受け取りました。" },
  "claim.doneBody": {
    en: "Everything held for you has been paid out, and future fees from this launch go straight to your wallet.",
    ja: "保管されていた分は支払われ、今後の手数料はあなたのウォレットへ直接送られます。",
  },
  "claim.note": {
    en: "We check the account with the provider itself. Only the account the launch named can claim, and only once.",
    ja: "アカウントは各プロバイダで確認します。ローンチ時に指定されたアカウントのみが、一度だけ受け取れます。",
  },
  "claim.errSignIn": { en: "Sign in again — that session has expired.", ja: "セッションが切れました。再度サインインしてください。" },
  "claim.errNotLinked": { en: "No {p} account is linked to this sign-in.", ja: "このサインインに {p} アカウントが連携されていません。" },
  "claim.errNotEarmarked": { en: "That launch did not earmark its fees for anyone.", ja: "そのローンチは手数料を誰にも指定していません。" },
  "claim.errNotYours": { en: "That launch earmarked its fees for a different account.", ja: "そのローンチは別のアカウント宛です。" },
  "claim.errBadToken": { en: "That is not a token address.", ja: "トークンアドレスではありません。" },
  "claim.errUnavailable": { en: "Claiming is not available yet.", ja: "受取はまだ利用できません。" },
  "claim.errChain": { en: "The chain rejected it. It may already have been claimed.", ja: "チェーンに拒否されました。既に受け取り済みの可能性があります。" },
  "claim.errGeneric": { en: "Something went wrong. Try again.", ja: "エラーが発生しました。再試行してください。" },
  "token.earmarked": { en: "Fees earmarked, unclaimed", ja: "手数料は確保済み・未受取" },
  "token.earmarkedBody": {
    en: "This launch set its fees aside for a social account rather than a wallet. They are held here, untouchable by the creator and by us, until that account signs in and proves it.",
    ja: "このローンチは手数料をウォレットではなくソーシャルアカウント宛に確保しています。本人が確認するまで、発行者にも当方にも引き出せません。",
  },
  "token.earmarkedCta": { en: "Is this you? Claim it", ja: "あなたですか？受け取る" },
  // --- leaderboard and profiles -----------------------------------------
  "nav.leaderboard": { en: "Traders", ja: "トレーダー" },
  "lb.title": { en: "Who is actually winning.", ja: "実際に勝っているのは誰か。" },
  "lb.sub": {
    en: "Every position, rebuilt from the pools themselves. Realised profit is settled; unrealised moves with the price and is calculated fresh on every load.",
    ja: "すべてのポジションをプールから再構築しています。確定損益は確定済み、含み損益は価格に応じて読込ごとに再計算されます。",
  },
  "lb.byPnl": { en: "Net PNL", ja: "純損益" },
  "lb.byVolume": { en: "Volume", ja: "取引高" },
  "lb.loading": { en: "Reading positions…", ja: "ポジションを読込中…" },
  "lb.empty": {
    en: "Nobody has traded yet. The board fills itself as launches trade.",
    ja: "まだ取引がありません。取引が始まると自動的に表示されます。",
  },
  "lb.positions": { en: "{n} open", ja: "保有{n}件" },
  "lb.note": {
    en: "Positions are indexed from on-chain swaps, so anyone who trades appears here whether or not they have a profile. Cost basis is weighted average.",
    ja: "ポジションはオンチェーンのスワップから集計されるため、プロフィールの有無にかかわらず反映されます。取得単価は加重平均です。",
  },

  "pf.errNoName": { en: "Could not assign a name. Try again.", ja: "名前を割り当てられませんでした。再試行してください。" },
  "pf.renameHint": {
    en: "You were given a name automatically. Change it to anything not already taken.",
    ja: "名前は自動で割り当てられています。未使用の名前であれば自由に変更できます。",
  },
  "pf.avatar": { en: "Picture URL", ja: "画像URL" },
  "pf.earned": { en: "Fees earned", ja: "獲得手数料" },
  "pf.since": { en: "Trading since {d}", ja: "{d} から取引" },
  "pf.topTrade": { en: "Best trade", ja: "最高の取引" },
  "pf.positions": { en: "Positions", ja: "ポジション" },
  // --- boards ------------------------------------------------------------
  "lb.tabPnl": { en: "Top PNL", ja: "損益ランキング" },
  "lb.tabEarners": { en: "Top earners", ja: "獲得額ランキング" },
  "lb.topTrades": { en: "Top trades", ja: "ベストトレード" },
  "lb.earned": { en: "earned", ja: "獲得" },
  "lb.emptyEarners": {
    en: "Nobody has been paid launch fees yet. Launch a token and the board fills itself.",
    ja: "まだ手数料を受け取った人はいません。トークンを発行すれば自動で反映されます。",
  },
  "lb.earnersNote": {
    en: "Fees the launchpad has paid out: creator shares, referral shares and claimed earmarks. The protocol treasury is excluded from its own board.",
    ja: "ローンチパッドが支払った手数料（発行者・紹介者・指定先の受取分）。運営トレジャリーは対象外です。",
  },
  "lb.mcap": { en: "MC", ja: "時価総額" },
  "lb.entry": { en: "entry", ja: "取得" },
  "pf.notFound": { en: "No such profile.", ja: "プロフィールが見つかりません。" },
  "pf.notFoundBody": { en: "Nobody has claimed this name.", ja: "この名前はまだ登録されていません。" },
  "pf.netPnl": { en: "Net PNL", ja: "純損益" },
  "pf.realized": { en: "Realised", ja: "確定" },
  "pf.unrealized": { en: "Unrealised", ja: "含み" },
  "pf.volume": { en: "Buy volume", ja: "取引高" },
  "pf.holding": { en: "Holding", ja: "保有額" },
  "pf.open": { en: "Open", ja: "保有中" },
  "pf.closed": { en: "Closed", ja: "決済済" },
  "pf.noPositions": { en: "No positions yet.", ja: "ポジションはまだありません。" },
  "pf.avgEntry": { en: "avg entry", ja: "平均取得" },
  "pf.spent": { en: "spent", ja: "投入額" },
  "pf.noWallet": {
    en: "This profile has no wallet linked, so there is nothing to show yet.",
    ja: "このプロフィールにはウォレットが未連携のため、表示できるものがありません。",
  },
  "pf.edit": { en: "Edit profile", ja: "プロフィール編集" },
  "pf.save": { en: "Save", ja: "保存" },
  "pf.saving": { en: "Saving…", ja: "保存中…" },
  "pf.handle": { en: "Handle", ja: "ハンドル" },
  "pf.display": { en: "Display name", ja: "表示名" },
  "pf.bio": { en: "Bio", ja: "自己紹介" },
  "pf.errHandle": { en: "3–20 characters: letters, numbers, underscore.", ja: "3〜20文字（英数字とアンダースコア）。" },
  "pf.errTaken": { en: "That handle is taken.", ja: "そのハンドルは使用済みです。" },
  "pf.errGeneric": { en: "Could not save. Try again.", ja: "保存できませんでした。再試行してください。" },
  "pf.yours": { en: "This is you", ja: "あなたのプロフィール" },
  "pf.claim": { en: "Claim your profile", ja: "プロフィールを作成" },
  "pf.view": { en: "View", ja: "表示" },
  "pf.cancel": { en: "Cancel", ja: "キャンセル" },
  "pf.signInToClaim": { en: "Sign in to claim a profile and appear by name.", ja: "サインインしてプロフィールを作成すると、名前で表示されます。" },
  "fees.row.earmarked": { en: "Held for the earmark", ja: "指定先のため保管" },
  "fees.anyoneEarmarked": {
    en: "Fees the pool has earned but nobody has swept yet. Anyone can collect; the earmarked share then joins what is already held in escrow below, and only the named account can take it out.",
    ja: "プールが獲得済みで、まだ回収されていない手数料です。誰でも回収でき、指定先の分は下記のエスクロー残高に加算されます。引き出せるのは指定アカウントのみです。",
  },
  "copy.hint": { en: "click to copy", ja: "クリックでコピー" },
  "copy.done": { en: "Copied", ja: "コピー完了" },
  "token.explorer": { en: "explorer", ja: "エクスプローラ" },
  "token.earmarkedHeld": { en: "held in escrow", ja: "エスクローに保管中" },
} as const;

export type StringKey = keyof typeof STRINGS;

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

const STORAGE_KEY = `${STORAGE_PREFIX}.lang`;

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start at "en" so the server and first client render agree; the stored
  // or browser-detected preference is applied in an effect straight after.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    // Storage throws outright in a locked-down private window, which would take
    // the whole effect -- and the browser-language fallback -- down with it.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* no stored preference available */
    }
    if (stored === "en" || stored === "ja") {
      setLangState(stored);
      return;
    }
    if (navigator.language?.toLowerCase().startsWith("ja")) setLangState("ja");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* the choice just won't outlive the tab */
    }
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let out: string = STRINGS[key][lang];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/// Shorthand for components that only need the translate function.
export function useT() {
  return useI18n().t;
}
