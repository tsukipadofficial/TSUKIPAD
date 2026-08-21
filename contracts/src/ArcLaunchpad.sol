// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback
} from "./interfaces/IUniswapV3.sol";
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
///      Liquidity is permanently locked because this contract owns the position
///      and exposes no code path that calls `burn` with non-zero liquidity. The
///      principal is not locked by policy or by a timelock that someone can let
///      lapse; there is simply no function that can withdraw it. Swap fees
///      accrued by the position remain claimable, split between the creator and
///      the protocol treasury.
contract ArcLaunchpad is IUniswapV3MintCallback, IUniswapV3SwapCallback, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------

    /// @notice The ERC20 interface to Arc's native USDC. Quote asset for every launch.
    address public immutable USDC;

    /// @notice Uniswap V3 factory used to create pools.
    IUniswapV3Factory public immutable v3Factory;

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

    /// @notice How long a creator's allocation is held before they can claim it.
    /// @dev The allocation is the only supply that is not locked in the pool, so
    ///      it is the only supply that could be dumped on early buyers. Holding
    ///      it briefly means the first minutes of trading cannot be front-run by
    ///      the launcher, without locking founders out of their tokens for good.
    uint64 public constant CREATOR_LOCK_DURATION = 30 minutes;

    // ---------------------------------------------------------------------
    // Mutable configuration
    // ---------------------------------------------------------------------

    /// @notice Receives the protocol's cut of swap fees.
    address public treasury;

    /// @notice Protocol share of collected swap fees, in bps. Remainder to creator.
    uint16 public protocolFeeBps;

    /// @notice Address permitted to attest that a wallet belongs to the identity
    ///         a launch earmarked its fees for.
    /// @dev This is the one trusted role in the contract, and it is deliberately
    ///      narrow: an attestation can only bind an address to a launch whose
    ///      commitment it names, only once, and it can never move fees that have
    ///      already been claimed or redirect an ordinary launch.
    address public attestor;

    /// @notice How long an unclaimed launch is held before the escrow can be swept.
    /// @dev Without this, an earmark nobody ever claims strands the fees forever.
    ///      The sweep pays the treasury rather than the creator on purpose: paying
    ///      the creator would reward inventing a recipient who never appears.
    uint64 public constant UNCLAIMED_PERIOD = 365 days;

    /// @notice Flat USDC charged to create a launch. Spam control; may be zero.
    uint256 public launchFee;

    // ---------------------------------------------------------------------
    // Launch registry
    // ---------------------------------------------------------------------

    struct Launch {
        address token;
        address pool;
        address creator;
        /// @dev Who receives the creator share of swap fees. Defaults to the
        ///      creator, but may point at a project, charity or public good.
        address feeRecipient;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint64 createdAt;
        /// @dev Supply withheld for the creator, held by this contract until `unlockAt`.
        uint256 creatorAllocation;
        /// @dev Timestamp after which the allocation can be claimed.
        uint64 unlockAt;
        /// @dev Set once the allocation has been claimed.
        bool allocationClaimed;
        /// @dev Fee mode: buy the token back and burn it.
        bool buybackAndBurn;
        /// @dev Lifetime USDC spent on buy-backs.
        uint256 usdcSpentOnBuybacks;
        /// @dev Lifetime tokens bought back and destroyed.
        uint256 tokensBurned;
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

    /// @dev Set only for the duration of a `pool.mint` call, to authenticate the callback.
    address private _mintingPool;

    /// @dev Set only for the duration of a buy-back `pool.swap`, likewise.
    address private _swappingPool;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Launched(
        address indexed token,
        address indexed pool,
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
    event CreatorAllocationClaimed(address indexed token, address indexed creator, uint256 amount);
    event FeesCollected(address indexed token, uint256 creatorToken, uint256 creatorUsdc, uint256 protocolToken, uint256 protocolUsdc);
    event TreasuryUpdated(address treasury);
    event ProtocolFeeUpdated(uint16 bps);
    event LaunchFeeUpdated(uint256 fee);
    event AttestorUpdated(address attestor);
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
    error LiquidityCostExceedsBudget();
    error NotALaunch();
    error FeeTooHigh();
    error StillLocked();
    error AllocationAlreadyClaimed();
    error NotUnclaimed();
    error NoAttestor();
    error BadAttestation();
    error AttestationExpired();
    error StillClaimable();
    error ZeroRecipient();

    constructor(address usdc_, address factory_, uint24 poolFee_, address treasury_, uint16 protocolFeeBps_)
        Ownable(msg.sender)
    {
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();

        USDC = usdc_;
        v3Factory = IUniswapV3Factory(factory_);
        poolFee = poolFee_;

        int24 spacing = IUniswapV3Factory(factory_).feeAmountTickSpacing(poolFee_);
        require(spacing != 0, "unsupported fee tier");
        tickSpacing = spacing;

        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
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
    }

    /// @notice Deploy a token, open its USDC pool, and seed it with single-sided liquidity.
    /// @dev `params.salt` must be mined off-chain such that the resulting token address is
    ///      strictly below `USDC`; see `predictTokenAddress`. The salt is namespaced by
    ///      `msg.sender` so nobody can grief a pending launch by claiming its salt first.
    /// @return token The deployed token.
    /// @return pool The Uniswap V3 pool now holding all launch liquidity.
    function launch(LaunchParams calldata params) external nonReentrant returns (address token, address pool) {
        if (params.totalSupply == 0) revert ZeroSupply();
        if (params.creatorAllocationBps > MAX_CREATOR_ALLOCATION_BPS) revert AllocationTooLarge();
        if (params.tickLower >= params.tickUpper) revert TickOrder();
        if (params.tickLower % tickSpacing != 0 || params.tickUpper % tickSpacing != 0) revert TickAlignment();

        if (launchFee > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, treasury, launchFee);
        }

        // --- deploy token -------------------------------------------------
        token = address(
            new LaunchToken{salt: _saltFor(msg.sender, params.salt)}(
                params.name,
                params.symbol,
                params.totalSupply,
                params.metadataURI,
                msg.sender,
                USDC,
                params.rewardHolders
            )
        );

        // token0 must be the launched token for the single-sided math to hold.
        if (token >= USDC) revert BadTokenOrdering();

        // --- create and open pool ----------------------------------------
        if (v3Factory.getPool(token, USDC, poolFee) != address(0)) revert PoolExists();
        pool = v3Factory.createPool(token, USDC, poolFee);
        IUniswapV3Pool(pool).initialize(TickMath.getSqrtRatioAtTick(params.tickLower));

        // Register the pool before any tokens reach it, so its (permanently
        // locked) balance never accrues holder rewards that nobody could claim.
        LaunchToken(token).setPool(pool);

        // --- seed single-sided liquidity ---------------------------------
        uint256 creatorAmount = (params.totalSupply * params.creatorAllocationBps) / 10_000;
        uint256 liquiditySupply = params.totalSupply - creatorAmount;

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount0(
            TickMath.getSqrtRatioAtTick(params.tickLower),
            TickMath.getSqrtRatioAtTick(params.tickUpper),
            liquiditySupply
        );

        _mintingPool = pool;
        (uint256 spent0, uint256 spent1) =
            IUniswapV3Pool(pool).mint(address(this), params.tickLower, params.tickUpper, liquidity, abi.encode(token, liquiditySupply));
        _mintingPool = address(0);

        // Pool must never ask for USDC: the range sits entirely above spot.
        if (spent1 != 0) revert UnexpectedUsdcOwed();

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
                unlockAt: uint64(block.timestamp) + CREATOR_LOCK_DURATION,
                allocationClaimed: creatorAmount == 0,
                buybackAndBurn: params.buybackAndBurn,
                usdcSpentOnBuybacks: 0,
                tokensBurned: 0
            })
        );
        _launchIndexPlusOne[token] = launches.length;
        if (params.recipientCommitment != bytes32(0)) {
            recipientCommitment[token] = params.recipientCommitment;
        }

        // The allocation stays here until the lock expires. Only the rounding
        // dust left over from the mint goes out now, so the launchpad holds
        // exactly what it owes the creator.
        uint256 remainder = IERC20(token).balanceOf(address(this));
        if (remainder > creatorAmount) {
            IERC20(token).safeTransfer(msg.sender, remainder - creatorAmount);
        }

        emit Launched(
            token,
            pool,
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

    /// @inheritdoc IUniswapV3MintCallback
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external override {
        if (msg.sender != _mintingPool || _mintingPool == address(0)) revert UnauthorizedCallback();

        (address token, uint256 budget) = abi.decode(data, (address, uint256));

        if (amount1Owed != 0) revert UnexpectedUsdcOwed();
        if (amount0Owed > budget) revert LiquidityCostExceedsBudget();

        IERC20(token).safeTransfer(msg.sender, amount0Owed);
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

        IUniswapV3Pool p = IUniswapV3Pool(l.pool);
        p.burn(l.tickLower, l.tickUpper, 0);
        (uint128 owed0, uint128 owed1) =
            p.collect(address(this), l.tickLower, l.tickUpper, type(uint128).max, type(uint128).max);

        // Convert the token side to USDC before splitting anything, so every
        // payout is denominated in USDC and nobody is left holding a bag of a
        // token they did not choose to own.
        //
        // These fees are what sellers paid on the way out -- a 1% fee tier means
        // selling them back adds 1% on top of a sell that already happened, and
        // only ever after a sell. The alternative, paying them out in kind, hands
        // creators and the treasury dust across every dead launch.
        uint256 usdcFromToken;
        uint256 unsoldToken = owed0;
        if (owed0 >= MIN_FEE_SWAP) {
            (uint256 sold, uint256 got) = _sellFeesForUsdc(l, owed0);
            usdcFromToken = got;
            unsoldToken = owed0 - sold;
        }

        uint256 totalUsdc = uint256(owed1) + usdcFromToken;

        uint256 protocol0 = (unsoldToken * protocolFeeBps) / 10_000;
        uint256 protocol1 = (totalUsdc * protocolFeeBps) / 10_000;
        uint256 creator0 = unsoldToken - protocol0;
        uint256 creator1 = totalUsdc - protocol1;

        // Anything the swap could not clear -- a pool out of range, or a balance
        // below MIN_FEE_SWAP -- is paid in kind rather than stranded. This is the
        // old behaviour, now only a fallback.
        if (creator0 > 0) {
            if (unclaimed) escrowToken[token] += creator0;
            else IERC20(l.token).safeTransfer(l.feeRecipient, creator0);
        }
        if (protocol0 > 0) IERC20(l.token).safeTransfer(treasury, protocol0);

        // USDC-side fees follow the mode chosen at launch.
        if (creator1 > 0) {
            if (l.buybackAndBurn && _canBuyBack(l)) {
                _buybackAndBurn(idxPlusOne - 1, creator1);
            } else if (LaunchToken(l.token).rewardsEnabled()) {
                IERC20(USDC).safeTransfer(l.token, creator1);
                LaunchToken(l.token).notifyRewards();
                emit HolderRewardsFunded(l.token, creator1);
            } else if (unclaimed) {
                escrowUsdc[token] += creator1;
            } else {
                IERC20(USDC).safeTransfer(l.feeRecipient, creator1);
            }
        }
        if (protocol1 > 0) IERC20(USDC).safeTransfer(treasury, protocol1);

        emit FeesCollected(token, creator0, creator1, protocol0, protocol1);
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
        (, int24 tick,,,,,) = IUniswapV3Pool(l.pool).slot0();
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
    function _buybackAndBurn(uint256 index, uint256 usdcAmount) private {
        Launch storage l = launches[index];

        _swappingPool = l.pool;
        // zeroForOne = false: paying token1 (USDC) to receive token0 (the token).
        // Stop at the top of the launch range: there is no liquidity above it,
        // so a wider limit only risks running the price into the global maximum.
        (int256 amount0,) = IUniswapV3Pool(l.pool).swap(
            address(this),
            false,
            int256(usdcAmount),
            TickMath.getSqrtRatioAtTick(l.tickUpper),
            abi.encode(l.token)
        );
        _swappingPool = address(0);

        uint256 bought = uint256(-amount0);
        if (bought > 0) {
            LaunchToken(l.token).burn(bought);
            l.usdcSpentOnBuybacks += usdcAmount;
            l.tokensBurned += bought;
            emit BoughtBackAndBurned(l.token, usdcAmount, bought);
        }
    }

    /// @notice Smallest token-fee balance worth converting.
    /// @dev Below this the swap costs more gas than the USDC it returns, and a
    ///      quiet launch would burn gas on dust at every collection.
    uint256 public constant MIN_FEE_SWAP = 1e15; // 0.001 token

    /// @dev Sell exactly `amountIn` of a launch's token back into its own pool.
    ///
    ///      `amountIn` is always the amount collected in *this* call and never a
    ///      balance lookup. The launchpad also custodies creator allocations
    ///      awaiting unlock and escrow for unclaimed launches, all in the same
    ///      token; selling `balanceOf(this)` would quietly spend those.
    ///
    ///      Returns what was sold and what came back. A swap that cannot execute
    ///      returns zero rather than reverting: fees are collected on behalf of
    ///      the creator, and a pool that has drifted out of range must not make
    ///      collecting impossible.
    function _sellFeesForUsdc(Launch memory l, uint256 amountIn)
        private
        returns (uint256 sold, uint256 usdcOut)
    {
        _swappingPool = l.pool;
        // zeroForOne = true: paying token0 (the token) to receive token1 (USDC).
        // Stop at the bottom of the launch range -- there is no liquidity below
        // it, and the price should never be pushed under the opening tick.
        try IUniswapV3Pool(l.pool).swap(
            address(this),
            true,
            int256(amountIn),
            TickMath.getSqrtRatioAtTick(l.tickLower),
            abi.encode(l.token)
        ) returns (int256 amount0, int256 amount1) {
            sold = uint256(amount0);
            usdcOut = uint256(-amount1);
        } catch {
            sold = 0;
            usdcOut = 0;
        }
        _swappingPool = address(0);
    }

    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        if (msg.sender != _swappingPool || _swappingPool == address(0)) revert UnauthorizedCallback();

        // The launchpad swaps in both directions now: it buys the token back
        // with USDC for buy-and-burn, and sells collected token fees for USDC so
        // that every payout is denominated in USDC. Exactly one side is ever
        // owed, and the pool is already authenticated by `_swappingPool`.
        if (amount0Delta > 0) {
            IERC20(abi.decode(data, (address))).safeTransfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(USDC).safeTransfer(msg.sender, uint256(amount1Delta));
        } else {
            revert UnexpectedUsdcOwed();
        }
    }

    /// @notice Release a creator's locked allocation once the lock has expired.
    /// @dev Permissionless: anyone may trigger it, but the tokens only ever go to
    ///      the creator recorded at launch.
    function claimCreatorAllocation(address token) external nonReentrant {
        uint256 idxPlusOne = _launchIndexPlusOne[token];
        if (idxPlusOne == 0) revert NotALaunch();
        Launch storage l = launches[idxPlusOne - 1];

        if (l.allocationClaimed) revert AllocationAlreadyClaimed();
        if (block.timestamp < l.unlockAt) revert StillLocked();

        uint256 amount = l.creatorAllocation;
        l.allocationClaimed = true;
        if (amount > 0) IERC20(token).safeTransfer(l.creator, amount);

        emit CreatorAllocationClaimed(token, l.creator, amount);
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
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode,
                abi.encode(name, symbol, totalSupply, metadataURI, creator, USDC, rewardHolders)
            )
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _saltFor(creator, salt), initCodeHash))))
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
        return keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode,
                abi.encode(name, symbol, totalSupply, metadataURI, creator, USDC, rewardHolders)
            )
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
    /// @dev Deliberately pays the treasury and not the creator: paying the creator
    ///      would make inventing a recipient who never appears profitable. The
    ///      launch stays claimable afterwards, so a recipient who turns up late
    ///      still receives everything the position earns from then on.
    function sweepUnclaimedFees(address token) external onlyOwner nonReentrant {
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

    /// @notice Set the address permitted to attest wallet ownership of an identity.
    function setAttestor(address attestor_) external onlyOwner {
        attestor = attestor_;
        emit AttestorUpdated(attestor_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setProtocolFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        launchFee = fee;
        emit LaunchFeeUpdated(fee);
    }
}
