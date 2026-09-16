// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {TsukiHook} from "./TsukiHook.sol";
import {TokenDeployer} from "./TokenDeployer.sol";
import {TsukiV4Pool} from "./TsukiV4Pool.sol";
import {TickMath, LiquidityAmounts} from "./libraries/V3Math.sol";

/// @title ArcLaunchpad
/// @notice Launches fixed-supply tokens straight into a Uniswap V3 USDC pool
///         using single-sided liquidity, with no presale and no seed capital.
///
/// @dev The mechanic, in one paragraph:
///
///      A Uniswap V3 position whose range sits entirely above the current price
///      holds only token0. So we deploy the token (forced by CREATE2 to sort
///      below USDC, making it token0), open the pool at exactly `tickLower`, and
///      mint one position over [tickLower, tickUpper] funded purely with tokens.
///      The creator supplies no USDC. Buyers walking the price up the range are
///      what fills the pool with USDC. That range *is* the bonding curve, except
///      it is a real Uniswap pool, so the token is tradeable through any router,
///      aggregator or interface from the very first block — there is no
///      "graduation" step and no migration risk.
///
///      This contract has no owner. Not renounced -- never created. Every
///      configurable value is `immutable`, fixed at deployment and unreachable
///      by anyone afterwards, so there is no key whose loss or theft could
///      change the fee split, redirect the treasury, or alter the terms a
///      creator launched under. Changing any of it means deploying a new
///      launchpad; launches made under this one keep their terms forever.
///
///      Liquidity is permanently locked because this contract owns the position
///      and exposes no code path that calls `burn` with non-zero liquidity. The
///      principal is not locked by policy or by a timelock that someone can let
///      lapse; there is simply no function that can withdraw it. Swap fees
///      accrued by the position remain claimable, split between the creator and
///      the protocol treasury.
contract ArcLaunchpad is TsukiV4Pool, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    /// @notice The ERC20 interface to Arc's native USDC. Quote asset for every launch.
    address public immutable USDC;

    /// @notice Deploys the launch tokens. Only a size measure: carrying the
    ///         token's creation code here put this contract over the 24KB limit.
    TokenDeployer public immutable tokenDeployer;

    /// @notice Fee tier for every launch pool (1% suits volatile launches).
    uint24 public immutable poolFee;

    /// @notice Tick spacing of `poolFee`, cached at construction.
    int24 public immutable tickSpacing;

    /// @notice Hard ceiling on the share of supply a creator may keep, in bps.
    uint16 public constant MAX_CREATOR_ALLOCATION_BPS = 2_000; // 20%

    /// @notice Hard ceiling on the protocol's share of swap fees, in bps.
    /// @dev Without this the owner could set the split to 100% and seize every
    ///      creator's fee share across every launch, retroactively — a single
    ///      compromised key would drain the whole platform's economics. Capping
    ///      it in immutable code means the worst case is bounded at half, and
    ///      creators can verify that before launching.
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 5_000; // 50%

    /// @notice The launchpad this contract is. Read by explorers, scanners and
    ///         aggregators to attribute a launch without needing a hard-coded
    ///         address list.
    /// @dev A constant, so it costs storage nothing and cannot be spoofed by a
    ///      fork that merely copies the bytecode -- a copy is a different
    ///      address, and `LaunchToken.launchpad` names the address that actually
    ///      deployed it.
    string public constant PAD = "TSUKIPAD";
    string public constant PAD_URL = "https://tsukipad.com";

    // ---------------------------------------------------------------------
    // Mutable configuration
    // ---------------------------------------------------------------------

    /// @notice Receives the protocol's cut of swap fees.
    address public immutable treasury;

    /// @notice Protocol share of collected swap fees, in bps. Remainder to creator.
    /// @dev Immutable because it is read live when fees are collected. As a
    ///      mutable value it applied retroactively: changing it would have
    ///      altered the split on every launch ever made here, including ones
    ///      whose creators agreed to different terms. Fixed at deployment, the
    ///      number a creator sees at launch is the number they keep.
    uint16 public immutable protocolFeeBps;

    /// @notice Address permitted to attest that a wallet belongs to the identity
    ///         a launch earmarked its fees for.
    /// @dev This is the one trusted role in the contract, and it is deliberately
    ///      narrow: an attestation can only bind an address to a launch whose
    ///      commitment it names, only once, and it can never move fees that have
    ///      already been claimed or redirect an ordinary launch.
    address public immutable attestor;

    /// @notice How long an unclaimed launch is held before the escrow can be swept.
    /// @dev Without this, an earmark nobody ever claims strands the fees forever.
    ///      The sweep pays the treasury rather than the creator on purpose: paying
    ///      the creator would reward inventing a recipient who never appears.
    uint64 public constant UNCLAIMED_PERIOD = 365 days;

    /// @notice Flat USDC charged to create a launch. Spam control; may be zero.
    uint256 public immutable launchFee;

    // ---------------------------------------------------------------------
    // Launch registry
    // ---------------------------------------------------------------------

    struct Launch {
        address token;
        /// @dev The launch's v4 pool. Pools have no address of their own -- the
        ///      manager holds them all -- so this is the id of the pool key.
        PoolId pool;
        address creator;
        /// @dev Who receives the creator share of swap fees. Defaults to the
        ///      creator, but may point at a project, charity or public good.
        address feeRecipient;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint64 createdAt;
        /// @dev Supply withheld from the pool and sent to the creator at launch.
        uint256 creatorAllocation;
        /// @dev Fee mode: buy the token back and burn it.
        bool buybackAndBurn;
        /// @dev Lifetime USDC spent on buy-backs.
        uint256 usdcSpentOnBuybacks;
        /// @dev Lifetime tokens bought back and destroyed.
        uint256 tokensBurned;
        /// @dev Extra fee the hook charges on every swap of this launch, paid
        ///      wholly to the fee recipient. Fixed at launch.
        uint16 creatorTaxBps;
    }

    /// @notice Every launch, in creation order.
    Launch[] public launches;

    /// @notice token => index into `launches`, offset by one (0 means "not a launch").
    mapping(address => uint256) private _launchIndexPlusOne;

    /// @notice Hash of the identity a launch earmarked its fees for, if any.
    /// @dev While this is set and the launch's `feeRecipient` is still zero, the
    ///      launch is *unclaimed* and its creator-share fees accrue below.
    ///
    ///      Kept beside the registry rather than inside `Launch` deliberately:
    ///      that struct is ABI-encoded on return by `launchOf` and again, as an
    ///      array, by `recentLaunches`, so each field added to it costs bytecode
    ///      several times over -- and this contract is within 2KB of EIP-170
    ///      because it embeds LaunchToken's entire initcode.
    mapping(address => bytes32) public recipientCommitment;

    /// @notice Creator-share fees held for an unclaimed launch.
    mapping(address => uint256) public escrowToken;
    mapping(address => uint256) public escrowUsdc;

    /// @notice Who introduced a launch, and the rate they were promised.
    /// @dev The rate is snapshotted per launch rather than read live. A single
    ///      mutable global would let the owner promise a share and then set it
    ///      to zero, which is a promise nobody should rely on. `address` and
    ///      `uint16` share one slot.
    struct Referral {
        address referrer;
        uint16 bps;
    }

    mapping(address => Referral) public referralOf;

    /// @notice Referral share applied to *new* launches, in bps of swap fees.
    /// @dev Paid entirely out of the protocol's share, never the creator's. A
    ///      creator's half is identical whether or not they were referred --
    ///      otherwise being introduced would cost them money.
    uint16 public immutable referralFeeBps;

    uint16 public constant MAX_REFERRAL_FEE_BPS = 2_000; // 20%

    /// @dev Set only for the duration of a `pool.mint` call, to authenticate the callback.

    /// @dev Set only for the duration of a buy-back `pool.swap`, likewise.

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Launched(
        address indexed token,
        bytes32 indexed poolId,
        address indexed creator,
        address feeRecipient,
        string name,
        string symbol,
        string metadataURI,
        uint256 totalSupply,
        uint256 liquiditySupply,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );

    event HolderRewardsFunded(address indexed token, uint256 usdcAmount);
    event BoughtBackAndBurned(address indexed token, uint256 usdcSpent, uint256 tokensBurned);
    event FeesCollected(address indexed token, uint256 creatorToken, uint256 creatorUsdc, uint256 protocolToken, uint256 protocolUsdc);
    event ReferralPaid(address indexed token, address indexed referrer, uint256 usdcAmount);
    event FeeRecipientClaimed(address indexed token, address indexed recipient, uint256 tokenAmount, uint256 usdcAmount);
    event UnclaimedFeesSwept(address indexed token, uint256 tokenAmount, uint256 usdcAmount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadTokenOrdering();
    error PoolExists();
    error TickOrder();
    error TickAlignment();
    error AllocationTooLarge();
    error ZeroSupply();
    error UnauthorizedCallback();
    error UnexpectedUsdcOwed();
    error NoLiquidityPlaced();
    error TooMuchSupplyUnplaced();
    error LiquidityCostExceedsBudget();
    error NotALaunch();
    error FeeTooHigh();
    error NotUnclaimed();
    error NoAttestor();
    error BadAttestation();
    error AttestationExpired();
    error StillClaimable();
    error ZeroRecipient();
    error SelfReferral();
    error ReferralFeeTooHigh();

    constructor(
        address usdc_,
        IPoolManager poolManager_,
        TsukiHook hook_,
        TokenDeployer tokenDeployer_,
        uint24 poolFee_,
        int24 tickSpacing_,
        address treasury_,
        uint16 protocolFeeBps_,
        address attestor_,
        uint256 launchFee_,
        uint16 referralFeeBps_
    ) TsukiV4Pool(poolManager_, hook_) {
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        if (referralFeeBps_ > MAX_REFERRAL_FEE_BPS || referralFeeBps_ > protocolFeeBps_) {
            revert ReferralFeeTooHigh();
        }
        // Every one of these is permanent from here, so a zero address is not a
        // mistake that can be corrected later -- it is a launchpad that can
        // never pay its treasury, or one whose earmarks can never be claimed.
        if (treasury_ == address(0) || attestor_ == address(0)) revert ZeroRecipient();

        USDC = usdc_;
        tokenDeployer = tokenDeployer_;
        poolFee = poolFee_;
        require(tickSpacing_ > 0, "bad tick spacing");
        tickSpacing = tickSpacing_;

        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        attestor = attestor_;
        launchFee = launchFee_;
        referralFeeBps = referralFeeBps_;
    }

    // ---------------------------------------------------------------------
    // Launching
    // ---------------------------------------------------------------------

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        uint256 totalSupply;
        /// @dev Caller-chosen CREATE2 salt, mined off-chain so the token sorts below USDC.
        bytes32 salt;
        /// @dev Opening price of the pool. Sets the starting market cap.
        int24 tickLower;
        /// @dev Top of the liquidity range. Sets how concentrated the curve is.
        int24 tickUpper;
        /// @dev Share of supply withheld from the pool for the creator, in bps.
        uint16 creatorAllocationBps;
        /// @dev If true, the creator's share of swap fees is paid to holders as
        ///      claimable USDC instead of to the creator. Immutable once launched.
        bool rewardHolders;
        /// @dev Recipient of the creator fee share. Zero means the creator.
        ///      Lets a launch fund a project, charity or public good instead.
        ///      Immutable once launched.
        address feeRecipient;
        /// @dev If true, the creator's USDC fee share is spent buying the token
        ///      back off its own pool and burning it, shrinking supply forever.
        ///      Takes precedence over `rewardHolders`. Immutable once launched.
        bool buybackAndBurn;
        /// @dev Earmark fees for an identity rather than an address, for the case
        ///      where the intended recipient has no wallet yet. Set this to a hash
        ///      of that identity and leave `feeRecipient` zero; fees then accrue
        ///      here until `claimFeeRecipient` binds an address to it.
        ///
        ///      Publishing a hash rather than the handle keeps the earmark
        ///      verifiable after the fact without putting the handle on-chain.
        bytes32 recipientCommitment;
        /// @dev Whoever introduced this launch, paid out of the protocol's share
        ///      of swap fees at the rate in force right now. Zero for none.
        ///      Immutable once launched, like everything else about fee routing.
        address referrer;
        /// @dev Extra fee on every swap, in bps, paid wholly to the fee
        ///      recipient. Charged by the pool's hook, so it applies to buys and
        ///      sells alike for as long as the launch exists. Zero for none;
        ///      capped by the hook at TsukiHook.MAX_CREATOR_TAX_BPS.
        uint16 creatorTaxBps;
    }

    /// @notice Deploy a token, open its USDC pool, and seed it with single-sided liquidity.
    /// @dev `params.salt` must be mined off-chain such that the resulting token address is
    ///      strictly below `USDC`; see `predictTokenAddress`. The salt is namespaced by
    ///      `msg.sender` so nobody can grief a pending launch by claiming its salt first.
    /// @return token The deployed token.
    /// @return pool The Uniswap V3 pool now holding all launch liquidity.
    function launch(LaunchParams calldata params) external nonReentrant returns (address token, PoolId pool) {
        if (params.totalSupply == 0) revert ZeroSupply();
        if (params.creatorAllocationBps > MAX_CREATOR_ALLOCATION_BPS) revert AllocationTooLarge();
        if (params.tickLower >= params.tickUpper) revert TickOrder();
        if (params.tickLower % tickSpacing != 0 || params.tickUpper % tickSpacing != 0) revert TickAlignment();

        if (launchFee > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, treasury, launchFee);
        }

        // --- deploy token -------------------------------------------------
        token = tokenDeployer.deployLaunchToken(
            _saltFor(msg.sender, params.salt),
            params.name,
            params.symbol,
            params.totalSupply,
            params.metadataURI,
            msg.sender,
            USDC,
            params.rewardHolders,
            address(hook)
        );

        // token0 must be the launched token for the single-sided math to hold.
        if (token >= USDC) revert BadTokenOrdering();

        // --- create and open pool ----------------------------------------
        // The hook refuses to initialize a pool it has not been told about, and
        // only this contract can tell it, so a launch's pool cannot exist before
        // this line -- nobody can open it first at a price of their choosing.
        PoolKey memory key = _key(token, USDC, poolFee, tickSpacing);
        pool = key.toId();
        // The pad, not the creator, is the hook's registered recipient. The tax
        // then arrives here and leaves through the same routing as every other
        // fee this launch earns -- to holders if the launch promised that, to
        // escrow if the recipient is still an unproven commitment, to a burn if
        // the launch buys back. Registering the creator directly would route
        // around all three: an earmarked launch would strand its tax in this
        // contract forever, and a holders launch would quietly pay its creator.
        _openPool(key, TickMath.getSqrtRatioAtTick(params.tickLower), address(this), params.creatorTaxBps);

        // Register the liquidity's home before any tokens reach it, so its
        // (permanently locked) balance never accrues holder rewards that nobody
        // could claim. Every v4 pool's tokens live in the manager.
        LaunchToken(token).setPool(address(poolManager));

        // --- seed single-sided liquidity ---------------------------------
        uint256 creatorAmount = (params.totalSupply * params.creatorAllocationBps) / 10_000;
        uint256 liquiditySupply = params.totalSupply - creatorAmount;

        (uint256 spent0, uint256 spent1, uint128 liquidity) =
            _mintLocked(key, params.tickLower, params.tickUpper, liquiditySupply, 0);

        // Pool must never ask for USDC: the range sits entirely above spot.
        if (spent1 != 0) revert UnexpectedUsdcOwed();
        if (spent0 > liquiditySupply) revert LiquidityCostExceedsBudget();

        // Everything except the declared allocation has to actually reach the
        // pool. Liquidity is computed from the range, and for an extreme enough
        // range the rounding keeps a real share of the supply instead of dust --
        // which would hand the creator supply the launch says they do not have,
        // with `creatorAllocation` still reporting the declared figure. A launch
        // that cannot place its liquidity is refused rather than quietly skewed.
        if (liquidity == 0) revert NoLiquidityPlaced();
        if (liquiditySupply - spent0 > liquiditySupply / 1_000) revert TooMuchSupplyUnplaced();

        // --- record ------------------------------------------------------
        launches.push(
            Launch({
                token: token,
                pool: pool,
                creator: msg.sender,
                feeRecipient: params.recipientCommitment != bytes32(0)
                    ? address(0)
                    : (params.feeRecipient == address(0) ? msg.sender : params.feeRecipient),
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidity: liquidity,
                createdAt: uint64(block.timestamp),
                creatorAllocation: creatorAmount,
                buybackAndBurn: params.buybackAndBurn,
                usdcSpentOnBuybacks: 0,
                tokensBurned: 0,
                creatorTaxBps: params.creatorTaxBps
            })
        );
        _launchIndexPlusOne[token] = launches.length;
        if (params.recipientCommitment != bytes32(0)) {
            recipientCommitment[token] = params.recipientCommitment;
        }
        if (params.referrer != address(0) && referralFeeBps > 0) {
            // Blocks only the laziest self-referral. A second wallet defeats it,
            // and no on-chain check can tell two wallets apart -- this is priced
            // in as leakage rather than pretended away.
            if (params.referrer == msg.sender) revert SelfReferral();
            referralOf[token] = Referral({referrer: params.referrer, bps: referralFeeBps});
        }

        // The allocation, plus the rounding dust left over from the mint, goes
        // to the creator now. Buyers can see the allocation on the launch before
        // they buy, which is the protection that matters.
        uint256 remainder = IERC20(token).balanceOf(address(this));
        if (remainder > 0) IERC20(token).safeTransfer(msg.sender, remainder);

        emit Launched(
            token,
            PoolId.unwrap(pool),
            msg.sender,
            params.recipientCommitment != bytes32(0)
                ? address(0)
                : (params.feeRecipient == address(0) ? msg.sender : params.feeRecipient),
            params.name,
            params.symbol,
            params.metadataURI,
            params.totalSupply,
            spent0,
            params.tickLower,
            params.tickUpper,
            liquidity
        );
    }

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    /// @notice Collect swap fees accrued by a launch's locked position.
    /// @dev Permissionless: anyone may trigger it, but proceeds only ever go to the
    ///      creator and the treasury. Principal is untouchable — `burn` is called with
    ///      zero liquidity purely to credit fees, which is the canonical Uniswap poke.
    function collectFees(address token) external nonReentrant {
        uint256 idxPlusOne = _launchIndexPlusOne[token];
        if (idxPlusOne == 0) revert NotALaunch();
        Launch memory l = launches[idxPlusOne - 1];

        // Earmarked, but nobody has proved they are the recipient yet. Fees are
        // held rather than sent, because there is no address that can receive
        // them without weakening the promise the launch made.
        bool unclaimed = recipientCommitment[token] != bytes32(0) && l.feeRecipient == address(0);

        PoolKey memory key = _key(l.token, USDC, poolFee, tickSpacing);
        (uint256 owed0, uint256 owed1) = _collect(key, l.tickLower, l.tickUpper);

        // The creator tax the hook has been holding comes home in the same call.
        // It is not split with the treasury -- all of it is the creator's -- but
        // it follows the same routing, so a holders launch pays holders and an
        // unproven earmark escrows instead of stranding.
        (uint256 tax0, uint256 tax1) = _pullHookTax(key, token);

        // The token side is converted to USDC before anything is split, so every
        // payout is denominated in USDC and nobody is left holding a bag of a
        // token they did not choose to own. These fees are what sellers paid on
        // the way out -- at a 1% tier, selling them back adds 1% on top of a sell
        // that already happened, and only ever after a sell.
        bool burning = l.buybackAndBurn && _canBuyBack(l);

        uint256 protocol0 = (uint256(owed0) * protocolFeeBps) / 10_000;
        uint256 creator0 = uint256(owed0) - protocol0;

        uint256 creatorUsdcFromToken;
        uint256 protocolUsdcFromToken;

        if (burning) {
            // Burn the creator's token-side fees outright. Selling them for USDC
            // only to buy the same token straight back would pay the pool fee and
            // slippage twice to reach the same place, burning ~2% less than just
            // destroying them. The treasury's share is still converted, because
            // the treasury is owed money rather than supply reduction.
            if (creator0 > 0) {
                LaunchToken(l.token).burn(creator0);
                launches[idxPlusOne - 1].tokensBurned += creator0;
                emit BoughtBackAndBurned(l.token, 0, creator0);
                creator0 = 0;
            }
            if (protocol0 >= MIN_FEE_SWAP) {
                (uint256 soldP, uint256 gotP) = _sellFeesForUsdc(l, protocol0);
                protocolUsdcFromToken = gotP;
                protocol0 -= soldP;
            }
        } else if (uint256(owed0) >= MIN_FEE_SWAP) {
            // One swap for the whole token side, then split the proceeds.
            (uint256 sold, uint256 got) = _sellFeesForUsdc(l, uint256(owed0));
            protocolUsdcFromToken = (got * protocolFeeBps) / 10_000;
            creatorUsdcFromToken = got - protocolUsdcFromToken;

            uint256 unsold = uint256(owed0) - sold;
            protocol0 = (unsold * protocolFeeBps) / 10_000;
            creator0 = unsold - protocol0;
        }

        uint256 protocol1 = (uint256(owed1) * protocolFeeBps) / 10_000 + protocolUsdcFromToken;
        uint256 creator1 = (uint256(owed1) - (uint256(owed1) * protocolFeeBps) / 10_000) + creatorUsdcFromToken;

        // A referral is a share of the whole USDC-side fee, taken entirely out of
        // the protocol's half. The creator's half is untouched, so being
        // introduced never costs a creator anything.
        uint256 referral1;
        Referral memory ref = referralOf[token];
        if (ref.referrer != address(0) && ref.bps > 0) {
            referral1 = ((uint256(owed1) + creatorUsdcFromToken + protocolUsdcFromToken) * ref.bps) / 10_000;
            // The rate is bounded below protocolFeeBps at the point it is set, so
            // this cannot normally bind; it is here because rounding and the
            // buy-and-burn path can leave protocol1 smaller than the naive share.
            if (referral1 > protocol1) referral1 = protocol1;
            protocol1 -= referral1;
        }

        // Anything the swap could not clear -- a pool out of range, or a balance
        // below MIN_FEE_SWAP -- is paid in kind rather than stranded. This is the
        // old behaviour, now only a fallback.
        if (creator0 > 0) {
            if (unclaimed) escrowToken[token] += creator0;
            else {
                try IERC20(l.token).transfer(l.feeRecipient, creator0) returns (bool ok) {
                    if (!ok) escrowToken[token] += creator0;
                } catch {
                    escrowToken[token] += creator0;
                }
            }
        }
        if (protocol0 > 0) IERC20(l.token).safeTransfer(treasury, protocol0);

        creator0 += tax0;
        creator1 += tax1;

        // USDC-side fees follow the mode chosen at launch.
        if (creator1 > 0) {
            if (burning) {
                // Anything the pool could not absorb is not lost: it falls
                // through to the recipient like an ordinary USDC fee.
                uint256 unspent = _buybackAndBurn(idxPlusOne - 1, creator1);
                if (unspent > 0) {
                    if (unclaimed) escrowUsdc[token] += unspent;
                    else {
                        try IERC20(USDC).transfer(l.feeRecipient, unspent) returns (bool ok) {
                            if (!ok) escrowUsdc[token] += unspent;
                        } catch {
                            escrowUsdc[token] += unspent;
                        }
                    }
                }
            } else if (LaunchToken(l.token).rewardsEnabled()) {
                IERC20(USDC).safeTransfer(l.token, creator1);
                LaunchToken(l.token).notifyRewards();
                emit HolderRewardsFunded(l.token, creator1);
            } else if (unclaimed) {
                escrowUsdc[token] += creator1;
            } else {
                // Never let the creator's own address block the call. Arc's USDC
                // is a Circle predeploy with a freeze list, and a frozen
                // recipient used to take the treasury's share and the referrer's
                // down with it -- permanently, since the recipient is immutable.
                // Held instead, claimable by the same address once it can
                // receive again.
                try IERC20(USDC).transfer(l.feeRecipient, creator1) returns (bool ok) {
                    if (!ok) escrowUsdc[token] += creator1;
                } catch {
                    escrowUsdc[token] += creator1;
                }
            }
        }
        // Pay the referrer before the treasury, and never let them block it. A
        // referrer can be a contract, or a USDC-blacklisted address; a reverting
        // transfer here would make fee collection impossible for that launch
        // forever, and the creator would lose their fees over someone else's
        // problem. On failure the share falls through to the treasury.
        if (referral1 > 0) {
            try IERC20(USDC).transfer(ref.referrer, referral1) returns (bool ok) {
                if (ok) emit ReferralPaid(token, ref.referrer, referral1);
                else protocol1 += referral1;
            } catch {
                protocol1 += referral1;
            }
        }

        if (protocol1 > 0) IERC20(USDC).safeTransfer(treasury, protocol1);

        emit FeesCollected(token, creator0, creator1, protocol0, protocol1);
    }

    /// @dev Claim whatever creator tax the hook holds for this launch.
    ///      Permissionless there and here; the hook only ever pays the address
    ///      it recorded at launch, which is this contract.
    function _pullHookTax(PoolKey memory key, address token) private returns (uint256 tax0, uint256 tax1) {
        PoolId id = key.toId();
        tax0 = hook.owed(id, key.currency0);
        tax1 = hook.owed(id, key.currency1);
        if (tax0 == 0 && tax1 == 0) return (0, 0);
        hook.claim(key);
        token; // the balances are already known from `owed`; nothing to re-read
    }

    /// @dev Whether a buy-back can actually execute right now.
    ///
    ///      Once the curve is fully bought out the pool holds no more of the
    ///      token and its price has run to the top of the range. A swap asking
    ///      for a price limit above the current price then reverts with `SPL`,
    ///      which would wedge `collectFees` permanently — taking the treasury's
    ///      share down with it. So a sold-out pool falls back to paying the fee
    ///      recipient in USDC instead of burning.
    function _canBuyBack(Launch memory l) private view returns (bool) {
        (, int24 tick,,) = poolManager.getSlot0(l.pool);
        return tick < l.tickUpper;
    }

    /// @dev Spend `usdcAmount` buying the launch token off its own pool, then
    ///      destroy everything bought.
    ///
    ///      This is the only place the launchpad ever trades. It swaps against
    ///      the pool directly rather than through a router, so the buy-back has
    ///      no external dependency and cannot be front-run by a router upgrade.
    ///      The price limit is left wide open because the amount is a fee
    ///      skim — small relative to the pool — and any output is burned, so
    ///      there is no slippage victim to protect.
    /// @return unspent USDC the pool could not absorb, still owed to the launch.
    function _buybackAndBurn(uint256 index, uint256 usdcAmount) private returns (uint256 unspent) {
        Launch storage l = launches[index];

        // zeroForOne = false: paying currency1 (USDC) to receive currency0 (the
        // token). The pad is exempt from its own launches' creator tax, so a
        // buy-back burns everything the USDC bought rather than handing a slice
        // of it back to the creator.
        //
        // Stopped at the top of the launch range: there is no liquidity above
        // it, so a wider limit lets a large buy-back run the price into the
        // global maximum, spend less than it was handed, strand the difference
        // here and knock the launch out of buy-back mode for good.
        (uint256 spent, uint256 bought) = _swapExactIn(
            _key(l.token, USDC, poolFee, tickSpacing),
            false,
            usdcAmount,
            TickMath.getSqrtRatioAtTick(l.tickUpper)
        );
        unspent = usdcAmount - spent;
        if (bought > 0) {
            LaunchToken(l.token).burn(bought);
            l.usdcSpentOnBuybacks += spent;
            l.tokensBurned += bought;
            emit BoughtBackAndBurned(l.token, spent, bought);
        }
    }

    /// @notice Smallest token-fee balance worth converting.
    /// @dev Below this the swap costs more gas than the USDC it returns, and a
    ///      quiet launch would burn gas on dust at every collection.
    uint256 public constant MIN_FEE_SWAP = 1e15; // 0.001 token

    /// @dev Sell exactly `amountIn` of a launch's token back into its own pool.
    ///
    ///      `amountIn` is always the amount collected in *this* call and never a
    ///      balance lookup. The launchpad also custodies escrow for unclaimed
    ///      launches in the same token; selling `balanceOf(this)` would quietly
    ///      spend it.
    ///
    ///      Returns what was sold and what came back. A swap that cannot execute
    ///      returns zero rather than reverting: fees are collected on behalf of
    ///      the creator, and a pool that has drifted out of range must not make
    ///      collecting impossible.
    function _sellFeesForUsdc(Launch memory l, uint256 amountIn)
        private
        returns (uint256 sold, uint256 usdcOut)
    {
        // zeroForOne = true: paying currency0 (the token) to receive currency1
        // (USDC). Routed through `swapForSelf` so a pool that cannot execute the
        // swap leaves fee collection working instead of reverting it.
        try this.swapForSelf(_key(l.token, USDC, poolFee, tickSpacing), true, amountIn) returns (
            uint256 sold_, uint256 out_
        ) {
            sold = sold_;
            usdcOut = out_;
        } catch {
            sold = 0;
            usdcOut = 0;
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function launchCount() external view returns (uint256) {
        return launches.length;
    }

    function launchOf(address token) external view returns (Launch memory) {
        uint256 idxPlusOne = _launchIndexPlusOne[token];
        if (idxPlusOne == 0) revert NotALaunch();
        return launches[idxPlusOne - 1];
    }

    /// @notice Page through launches, newest first.
    function recentLaunches(uint256 offset, uint256 limit) external view returns (Launch[] memory page) {
        uint256 total = launches.length;
        if (offset >= total) return new Launch[](0);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        page = new Launch[](n);
        for (uint256 i = 0; i < n; i++) {
            page[i] = launches[total - 1 - offset - i];
        }
    }

    /// @notice Address a launch would deploy to, for off-chain salt mining.
    /// @dev Mine `salt` until the returned address is strictly below `USDC`. Roughly
    ///      one in five random salts qualifies, so this converges in a handful of tries.
    function predictTokenAddress(
        address creator,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        bool rewardHolders,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initCodeHash = tokenDeployer.launchTokenInitCodeHash(
            name, symbol, totalSupply, metadataURI, creator, USDC, rewardHolders, address(this), address(hook)
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(tokenDeployer), _saltFor(creator, salt), initCodeHash))))
        );
    }

    /// @notice Creation-code hash for the token, so the frontend can mine salts locally.
    function tokenInitCodeHash(
        address creator,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        bool rewardHolders
    ) external view returns (bytes32) {
        return tokenDeployer.launchTokenInitCodeHash(
            name, symbol, totalSupply, metadataURI, creator, USDC, rewardHolders, address(this), address(hook)
        );
    }

    function _saltFor(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, salt));
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Bind a wallet to an earmarked launch and release its held fees.
    /// @dev Whether a wallet belongs to a social identity cannot be decided
    ///      on-chain, so it is decided off-chain and attested to here. The
    ///      attestation is scoped tightly on purpose: it names one launch, one
    ///      recipient and one commitment, carries a deadline, and is bound to
    ///      this contract and chain so it cannot be replayed elsewhere.
    ///
    ///      Binding is one-way. Once set, `feeRecipient` is never zero again, so
    ///      neither the creator nor the owner can redirect a launch that has
    ///      already been claimed -- the promise a launch made about where its
    ///      fees go survives this function.
    function claimFeeRecipient(
        address token,
        address recipient,
        uint64 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (recipient == address(0)) revert ZeroRecipient();
        if (attestor == address(0)) revert NoAttestor();
        if (block.timestamp > deadline) revert AttestationExpired();

        uint256 idxPlusOne = _launchIndexPlusOne[token];
        if (idxPlusOne == 0) revert NotALaunch();
        Launch storage l = launches[idxPlusOne - 1];
        bytes32 commitment = recipientCommitment[token];
        if (commitment == bytes32(0) || l.feeRecipient != address(0)) revert NotUnclaimed();

        // ecrecover directly rather than the OpenZeppelin helper: the library
        // costs ~2.5KB here, and this contract already sits close to EIP-170
        // because it embeds LaunchToken's full initcode. Signature malleability
        // is not a concern for this use -- a malleated signature authorises the
        // identical bound action, and a launch can only be claimed once anyway.
        bytes32 inner =
            keccak256(abi.encode(block.chainid, address(this), token, recipient, commitment, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));

        if (signature.length != 65) revert BadAttestation();
        bytes32 sigR;
        bytes32 sigS;
        uint8 sigV;
        assembly ("memory-safe") {
            sigR := calldataload(signature.offset)
            sigS := calldataload(add(signature.offset, 32))
            sigV := byte(0, calldataload(add(signature.offset, 64)))
        }
        address signer = ecrecover(digest, sigV, sigR, sigS);
        if (signer == address(0) || signer != attestor) revert BadAttestation();

        l.feeRecipient = recipient;

        uint256 owedToken = escrowToken[token];
        uint256 owedUsdc = escrowUsdc[token];
        escrowToken[token] = 0;
        escrowUsdc[token] = 0;

        if (owedToken > 0) IERC20(token).safeTransfer(recipient, owedToken);
        if (owedUsdc > 0) IERC20(USDC).safeTransfer(recipient, owedUsdc);

        emit FeeRecipientClaimed(token, recipient, owedToken, owedUsdc);
    }

    /// @notice Sweep the escrow of a launch nobody claimed, after UNCLAIMED_PERIOD.
    /// @dev Permissionless. With no owner there is nobody privileged to call it,
    ///      and the destination is hard-coded to the treasury rather than taken
    ///      from the caller -- so opening it up lets anyone pay the gas to
    ///      unstick a dead escrow without letting anyone redirect a penny.
    /// @dev Deliberately pays the treasury and not the creator: paying the creator
    ///      would make inventing a recipient who never appears profitable. The
    ///      launch stays claimable afterwards, so a recipient who turns up late
    ///      still receives everything the position earns from then on.
    function sweepUnclaimedFees(address token) external nonReentrant {
        uint256 idxPlusOne = _launchIndexPlusOne[token];
        if (idxPlusOne == 0) revert NotALaunch();
        Launch memory l = launches[idxPlusOne - 1];
        if (recipientCommitment[token] == bytes32(0) || l.feeRecipient != address(0)) revert NotUnclaimed();
        if (block.timestamp < uint256(l.createdAt) + UNCLAIMED_PERIOD) revert StillClaimable();

        uint256 owedToken = escrowToken[token];
        uint256 owedUsdc = escrowUsdc[token];
        escrowToken[token] = 0;
        escrowUsdc[token] = 0;

        if (owedToken > 0) IERC20(token).safeTransfer(treasury, owedToken);
        if (owedUsdc > 0) IERC20(USDC).safeTransfer(treasury, owedUsdc);

        emit UnclaimedFeesSwept(token, owedToken, owedUsdc);
    }





}
