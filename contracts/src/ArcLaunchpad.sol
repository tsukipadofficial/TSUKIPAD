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
                feeRecipient: params.feeRecipient == address(0) ? msg.sender : params.feeRecipient,
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
            params.feeRecipient == address(0) ? msg.sender : params.feeRecipient,
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

        IUniswapV3Pool p = IUniswapV3Pool(l.pool);
        p.burn(l.tickLower, l.tickUpper, 0);
        (uint128 owed0, uint128 owed1) =
            p.collect(address(this), l.tickLower, l.tickUpper, type(uint128).max, type(uint128).max);

        uint256 protocol0 = (uint256(owed0) * protocolFeeBps) / 10_000;
        uint256 protocol1 = (uint256(owed1) * protocolFeeBps) / 10_000;
        uint256 creator0 = owed0 - protocol0;
        uint256 creator1 = owed1 - protocol1;

        // Token-side fees always go to the creator. Routing them to holders
        // would mean selling the token into its own pool to realise USDC, which
        // is sell pressure a launch does not need.
        if (creator0 > 0) IERC20(l.token).safeTransfer(l.feeRecipient, creator0);
        if (protocol0 > 0) IERC20(l.token).safeTransfer(treasury, protocol0);

        // USDC-side fees follow the mode chosen at launch.
        if (creator1 > 0) {
            if (l.buybackAndBurn && _canBuyBack(l)) {
                _buybackAndBurn(idxPlusOne - 1, creator1);
            } else if (LaunchToken(l.token).rewardsEnabled()) {
                IERC20(USDC).safeTransfer(l.token, creator1);
                LaunchToken(l.token).notifyRewards();
                emit HolderRewardsFunded(l.token, creator1);
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

    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        if (msg.sender != _swappingPool || _swappingPool == address(0)) revert UnauthorizedCallback();

        // Only the USDC side is ever owed: the launchpad exclusively buys.
        if (amount1Delta <= 0) revert UnexpectedUsdcOwed();
        if (amount0Delta > 0) revert UnexpectedUsdcOwed();
        data; // token address is implied by the authenticated pool

        IERC20(USDC).safeTransfer(msg.sender, uint256(amount1Delta));
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
