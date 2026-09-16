// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CurveToken} from "./CurveToken.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";

import {TsukiHook} from "./TsukiHook.sol";
import {TokenDeployer} from "./TokenDeployer.sol";
import {TsukiV4Pool} from "./TsukiV4Pool.sol";
import {TickMath, FullMath, LiquidityAmounts} from "./libraries/V3Math.sol";

/// @title TsukiCurve
/// @notice Launches tokens onto a USDC bonding curve that graduates into a
///         permanently locked Uniswap V3 pool once it sells out.
///
/// @dev The curve is a constant-product market over *virtual* reserves:
///
///          (virtualTokens + tokensLeft) * (virtualUsdc + usdcRaised) = k
///
///      where `tokensLeft` counts the whole unsold supply, including the slice
///      held back for the pool. Only `curveSupply` is ever sold. When the last
///      of it goes, the curve holds exactly `usdcRaised` and `lpSupply`, and
///      those two become a full-range position at the curve's final price.
///
///      The virtual reserves are chosen so that final price is also
///      `usdcRaised / lpSupply` -- the price the pool opens at. Graduation
///      therefore moves the price by nothing: whoever buys the last token on
///      the curve and whoever buys the first one in the pool pay the same.
///      Solving the two constraints gives
///
///          virtualUsdc   = lpSupply * graduationUsdc / (totalSupply - 2 * lpSupply)
///          virtualTokens = virtualUsdc * lpSupply / graduationUsdc
///
///      With a 1B supply, 20% for the pool and $10,400 to graduate, a launch
///      opens at a ~$3,250 market cap and graduates at ~$52,000.
///
///      Like ArcLaunchpad this contract has no owner. Every parameter is
///      immutable, so the terms a creator launches under are the terms they
///      keep, and the graduated position has no code path that can withdraw it.
contract TsukiCurve is TsukiV4Pool, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    string public constant PAD = "TSUKIPAD";
    string public constant PAD_URL = "https://tsukipad.com";

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    /// @notice Every curve launch has the same supply, so every curve has the
    ///         same shape and a market cap means the same thing on all of them.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    uint16 public constant MAX_TRADE_FEE_BPS = 200; // 2%
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 5_000; // 50% of fees

    /// @notice Ceiling on the extra fee a creator may add to curve trades, in bps.
    /// @dev Charged on top of the base fee and split with the treasury on the
    ///      same terms, so the treasury earns `protocolFeeBps` of every cent a
    ///      trader pays regardless of what rate a creator picks.
    ///      It applies on the curve and, through the hook the pool is opened
    ///      with, on every swap after graduation too -- the rate a buyer pays
    ///      does not change the day a launch graduates.
    uint16 public constant MAX_CREATOR_TAX_BPS = 1_000; // 10%

    /// @notice Most wallets a launch may exempt from the snipe tax.
    uint256 public constant MAX_SNIPE_EXEMPT = 16;

    /// @notice Buy tax on the opening seconds of a launch, in bps.
    /// @dev Quartered every second: 99%, ~25%, ~6%, ~1.5%, ~0.4%, then nothing.
    ///      High enough that a bot buying in the launch block pays more than
    ///      it could make, gone before a person has finished reading the page.
    ///      The creator is exempt, so a launch can still open with a dev buy.
    uint256 public constant MAX_SNIPE_TAX_BPS = 9_900;
    uint256 public constant SNIPE_WINDOW = 5 seconds;

    /// @notice Smallest token-fee balance worth selling for USDC.
    uint256 public constant MIN_FEE_SWAP = 1e15;

    address public immutable USDC;

    /// @notice Deploys the curve tokens. A size measure, see ArcLaunchpad.
    TokenDeployer public immutable tokenDeployer;

    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    address public immutable treasury;

    /// @notice Fee on every curve trade, in bps of the USDC leg.
    uint16 public immutable tradeFeeBps;
    /// @notice Protocol share of trading and pool fees, in bps. Remainder to the creator.
    uint16 public immutable protocolFeeBps;
    /// @notice Flat USDC charged to create a launch. May be zero.
    uint256 public immutable launchFee;

    /// @notice USDC the curve must raise, net of fees, to graduate.
    uint256 public immutable graduationUsdc;
    /// @notice Tokens held back from the curve to seed the pool.
    uint256 public immutable lpSupply;
    /// @notice Tokens sold on the curve.
    uint256 public immutable curveSupply;
    uint256 public immutable virtualUsdc;
    uint256 public immutable virtualTokens;
    /// @dev The curve invariant, (virtualTokens + TOTAL_SUPPLY) * virtualUsdc.
    uint256 private immutable _k;

    // ---------------------------------------------------------------------
    // Registry
    // ---------------------------------------------------------------------

    struct Curve {
        address token;
        address creator;
        /// @dev Receives the creator share of every fee. Fixed at launch.
        address feeRecipient;
        /// @dev The graduated pool. Zero until graduation. v4 pools have no
        ///      address of their own -- the manager holds every pool -- so a
        ///      launch is identified by the id derived from its key.
        PoolId pool;
        uint64 createdAt;
        bool graduated;
        /// @dev Extra fee on curve trades, paid to `feeRecipient`. Fixed at launch.
        uint16 creatorTaxBps;
        /// @dev Liquidity of the locked full-range position, once graduated.
        uint128 liquidity;
        uint256 tokensSold;
        /// @dev USDC held for the curve, net of fees. Frozen at graduation.
        uint256 usdcRaised;
    }

    Curve[] private curves;
    mapping(address => uint256) private _indexPlusOne;

    /// @notice Wallets a launch declared free of its snipe tax, such as a team's.
    mapping(address => mapping(address => bool)) public snipeExempt;

    /// @notice USDC fees owed to a launch's creator, claimable at any time.
    /// @dev Accrued rather than pushed so that a creator whose address cannot
    ///      receive USDC can never make trading on their launch revert.
    mapping(address => uint256) public creatorFeesOwed;
    /// @notice USDC fees owed to the treasury, swept permissionlessly.
    uint256 public protocolFeesOwed;


    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event Launched(address indexed token, address indexed creator, string name, string symbol, string metadataURI);
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 usdcAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 tokensSold,
        uint256 usdcRaised
    );
    event Graduated(address indexed token, bytes32 indexed poolId, uint256 usdcToPool, uint256 tokensToPool, uint128 liquidity);
    event FeesCollected(address indexed token, uint256 usdcFees, uint256 tokenFeesUnsold);
    event CreatorFeesClaimed(address indexed token, address indexed recipient, uint256 amount);
    event HolderRewardsFunded(address indexed token, uint256 amount);
    event ProtocolFeesSwept(uint256 amount);

    error BadConfig();
    error BadTokenOrdering();
    error NotALaunch();
    error AlreadyGraduated();
    error NotGraduated();
    error NothingOut();
    error Slippage();
    error ExceedsSold();
    error UnauthorizedCallback();
    error OverBudget();

    constructor(
        address usdc_,
        IPoolManager poolManager_,
        TsukiHook hook_,
        TokenDeployer tokenDeployer_,
        uint24 poolFee_,
        int24 tickSpacing_,
        address treasury_,
        uint16 protocolFeeBps_,
        uint16 tradeFeeBps_,
        uint256 launchFee_,
        uint256 graduationUsdc_,
        uint16 lpSupplyBps_
    ) TsukiV4Pool(poolManager_, hook_) {
        if (
            treasury_ == address(0) || protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS || tradeFeeBps_ > MAX_TRADE_FEE_BPS
                || graduationUsdc_ == 0 || lpSupplyBps_ == 0 || lpSupplyBps_ >= 5_000 || tickSpacing_ <= 0
        ) revert BadConfig();

        USDC = usdc_;
        tokenDeployer = tokenDeployer_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        tradeFeeBps = tradeFeeBps_;
        launchFee = launchFee_;
        graduationUsdc = graduationUsdc_;

        uint256 lp = (TOTAL_SUPPLY * lpSupplyBps_) / 10_000;
        lpSupply = lp;
        curveSupply = TOTAL_SUPPLY - lp;

        uint256 vUsdc = FullMath.mulDiv(lp, graduationUsdc_, TOTAL_SUPPLY - 2 * lp);
        uint256 vTokens = FullMath.mulDiv(vUsdc, lp, graduationUsdc_);
        if (vUsdc == 0 || vTokens == 0) revert BadConfig();
        virtualUsdc = vUsdc;
        virtualTokens = vTokens;
        _k = (vTokens + TOTAL_SUPPLY) * vUsdc;
    }

    // ---------------------------------------------------------------------
    // Launching
    // ---------------------------------------------------------------------

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        /// @dev Mined off-chain so the token sorts below USDC; see `predictTokenAddress`.
        bytes32 salt;
        /// @dev USDC the creator spends buying their own launch in the same
        ///      transaction, free of the snipe tax. Zero for none.
        uint256 devBuyUsdc;
        uint256 minTokensOut;
        /// @dev Receives the creator share of fees. Zero means the creator.
        address feeRecipient;
        /// @dev Extra fee on curve trades for the fee recipient, up to MAX_CREATOR_TAX_BPS.
        uint16 creatorTaxBps;
        /// @dev Pay the creator share to holders, pro rata, instead of the recipient.
        bool rewardHolders;
        /// @dev Wallets that skip the snipe tax, up to MAX_SNIPE_EXEMPT.
        address[] snipeExempt;
    }

    function launch(LaunchParams calldata p) external nonReentrant returns (address token) {
        if (p.creatorTaxBps > MAX_CREATOR_TAX_BPS || p.snipeExempt.length > MAX_SNIPE_EXEMPT) revert BadConfig();
        if (launchFee > 0) IERC20(USDC).safeTransferFrom(msg.sender, treasury, launchFee);

        token = tokenDeployer.deployCurveToken(
            _saltFor(msg.sender, p.salt),
            p.name,
            p.symbol,
            TOTAL_SUPPLY,
            p.metadataURI,
            msg.sender,
            USDC,
            p.rewardHolders,
            address(hook)
        );
        // The launched token must be token0, as on ArcLaunchpad, so a graduated
        // pool reads exactly like a direct launch's pool everywhere downstream.
        if (token >= USDC) revert BadTokenOrdering();

        address recipient = p.feeRecipient == address(0) ? msg.sender : p.feeRecipient;
        curves.push(
            Curve({
                token: token,
                creator: msg.sender,
                feeRecipient: recipient,
                pool: PoolId.wrap(bytes32(0)),
                createdAt: uint64(block.timestamp),
                graduated: false,
                creatorTaxBps: p.creatorTaxBps,
                liquidity: 0,
                tokensSold: 0,
                usdcRaised: 0
            })
        );
        _indexPlusOne[token] = curves.length;
        // The fee recipient is exempt without being listed, like the creator:
        // a team opening its own launch should not pay its own snipe tax.
        snipeExempt[token][recipient] = true;
        for (uint256 i = 0; i < p.snipeExempt.length; i++) {
            snipeExempt[token][p.snipeExempt[i]] = true;
        }

        emit Launched(token, msg.sender, p.name, p.symbol, p.metadataURI);

        if (p.devBuyUsdc > 0) _buy(curves.length - 1, p.devBuyUsdc, p.minTokensOut, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy from a curve with up to `usdcIn`. Only what fills is charged,
    ///         so a buy that finishes the curve pays for the tokens left and no more.
    function buy(address token, uint256 usdcIn, uint256 minTokensOut, address recipient)
        external
        nonReentrant
        returns (uint256 tokensOut, uint256 usdcUsed)
    {
        return _buy(_index(token), usdcIn, minTokensOut, recipient);
    }

    function sell(address token, uint256 tokensIn, uint256 minUsdcOut, address recipient)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        Curve storage c = curves[_index(token)];
        if (c.graduated) revert AlreadyGraduated();
        if (tokensIn > c.tokensSold) revert ExceedsSold();

        uint256 fee;
        uint256 gross;
        (usdcOut, fee, gross) = _quoteSell(c.tokensSold, c.usdcRaised, tokensIn, _feeBps(c));
        if (usdcOut == 0) revert NothingOut();
        if (usdcOut < minUsdcOut) revert Slippage();

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);

        c.tokensSold -= tokensIn;
        c.usdcRaised -= gross;
        _accrueTradeFee(c, fee);

        IERC20(USDC).safeTransfer(recipient, usdcOut);
        emit Trade(token, msg.sender, false, usdcOut, tokensIn, fee, c.tokensSold, c.usdcRaised);
    }

    function _buy(uint256 idx, uint256 usdcIn, uint256 minTokensOut, address recipient)
        private
        returns (uint256 tokensOut, uint256 usdcUsed)
    {
        Curve storage c = curves[idx];
        if (c.graduated) revert AlreadyGraduated();

        uint256 fee;
        uint256 tax;
        (tokensOut, usdcUsed, fee, tax) =
            _quoteBuy(c.tokensSold, c.usdcRaised, usdcIn, _feeBps(c), _snipeTaxBps(c, msg.sender));
        if (tokensOut == 0) revert NothingOut();
        if (tokensOut < minTokensOut) revert Slippage();

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), usdcUsed);

        c.tokensSold += tokensOut;
        c.usdcRaised += usdcUsed - fee - tax;
        _accrueTradeFee(c, fee);
        // The snipe tax goes to the treasury in full. Splitting it with the
        // creator would pay a creator for sniping their own launch from a
        // second wallet.
        protocolFeesOwed += tax;

        IERC20(c.token).safeTransfer(recipient, tokensOut);
        emit Trade(c.token, msg.sender, true, usdcUsed, tokensOut, fee + tax, c.tokensSold, c.usdcRaised);

        if (c.tokensSold == curveSupply) _graduate(idx);
    }

    /// @dev Total fee on a curve trade: the base fee plus the creator's tax.
    function _feeBps(Curve storage c) private view returns (uint256) {
        return uint256(tradeFeeBps) + c.creatorTaxBps;
    }

    /// @dev Split a curve trade's fee. The base fee is shared with the protocol;
    ///      the creator tax, being the creator's own addition, is not.
    /// @dev The base fee and the creator tax are split the same way, so a
    ///      creator's rate never changes what the treasury earns per trade as a
    ///      share -- it is always `protocolFeeBps` of everything traders pay.
    function _accrueTradeFee(Curve storage c, uint256 fee) private {
        if (fee == 0) return;
        uint256 protocol = (fee * protocolFeeBps) / 10_000;
        protocolFeesOwed += protocol;
        creatorFeesOwed[c.token] += fee - protocol;
    }

    // ---------------------------------------------------------------------
    // Curve math
    // ---------------------------------------------------------------------

    /// @dev Returns what `usdcIn` buys, how much of it is used, and the fee and
    ///      tax taken from what is used. Rounds in the curve's favour throughout.
    function _quoteBuy(uint256 sold, uint256 raised, uint256 usdcIn, uint256 feeBps, uint256 taxBps)
        private
        view
        returns (uint256 tokensOut, uint256 used, uint256 fee, uint256 tax)
    {
        uint256 remaining = curveSupply - sold;
        if (remaining == 0 || usdcIn == 0) return (0, 0, 0, 0);

        uint256 x = virtualTokens + TOTAL_SUPPLY - sold;
        uint256 y = virtualUsdc + raised;

        used = usdcIn;
        (fee, tax) = _buyFees(used, feeBps, taxBps);
        uint256 newX = Math.ceilDiv(_k, y + used - fee - tax);
        tokensOut = newX < x ? x - newX : 0;

        if (tokensOut >= remaining) {
            // Charge only for what is left: the USDC that, after fee and tax,
            // lands the curve exactly on its final reserves.
            tokensOut = remaining;
            uint256 needed = Math.ceilDiv(_k, x - remaining) - y;
            used = FullMath.mulDivRoundingUp(needed, 1e8, (10_000 - feeBps) * (10_000 - taxBps));
            if (used > usdcIn) used = usdcIn;
            (fee, tax) = _buyFees(used, feeBps, taxBps);
        }
    }

    function _buyFees(uint256 amount, uint256 feeBps, uint256 taxBps) private pure returns (uint256 fee, uint256 tax) {
        fee = (amount * feeBps) / 10_000;
        tax = ((amount - fee) * taxBps) / 10_000;
    }

    function _quoteSell(uint256 sold, uint256 raised, uint256 tokensIn, uint256 feeBps)
        private
        view
        returns (uint256 usdcOut, uint256 fee, uint256 gross)
    {
        if (tokensIn == 0 || tokensIn > sold) return (0, 0, 0);
        uint256 x = virtualTokens + TOTAL_SUPPLY - sold;
        uint256 y = virtualUsdc + raised;
        uint256 newY = Math.ceilDiv(_k, x + tokensIn);
        gross = newY < y ? y - newY : 0;
        if (gross > raised) gross = raised;
        fee = (gross * feeBps) / 10_000;
        usdcOut = gross - fee;
    }

    function _snipeTaxBps(Curve storage c, address trader) private view returns (uint256) {
        if (trader == c.creator || snipeExempt[c.token][trader]) return 0;
        uint256 elapsed = block.timestamp - c.createdAt;
        if (elapsed >= SNIPE_WINDOW) return 0;
        return MAX_SNIPE_TAX_BPS >> (2 * elapsed);
    }

    // ---------------------------------------------------------------------
    // Graduation
    // ---------------------------------------------------------------------

    function _graduate(uint256 idx) private {
        Curve storage c = curves[idx];
        c.graduated = true;
        address token = c.token;
        CurveToken(token).graduate();

        PoolKey memory key = _key(token, USDC, poolFee, tickSpacing);
        c.pool = key.toId();
        // Holder rewards must not accrue to liquidity. In v4 every pool's
        // tokens sit in the manager, so that is the address to exclude.
        CurveToken(token).setPool(address(poolManager));

        // The price the curve ended at, carried straight into the pool: the
        // first pool trade costs what the last curve trade would have. Nobody
        // can have opened this pool first -- the hook refuses to initialize a
        // pool this contract has not registered -- so unlike a v3 launch there
        // is no squaring-up swap to make, and no way to front-run the price.
        uint160 target = _sqrtPriceX96(virtualUsdc + c.usdcRaised, virtualTokens + lpSupply);
        // This contract, not the creator, is what the hook pays: the tax then
        // leaves through `claimCreatorFees`, which is what honours a launch that
        // promised its fees to holders. Registering the creator directly would
        // pay them personally while the curve's identical pre-graduation tax
        // went to holders.
        _openPool(key, target, address(this), c.creatorTaxBps);

        uint256 tokenBudget = lpSupply;
        uint256 usdcBudget = c.usdcRaised;

        int24 lower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        int24 upper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        (uint256 spent0, uint256 spent1, uint128 liquidity) =
            _mintLocked(key, lower, upper, tokenBudget, usdcBudget);
        c.liquidity = liquidity;

        // Rounding leaves a sliver of one side unplaced. Tokens are burned so
        // supply matches what exists in the market; USDC goes to the treasury.
        if (tokenBudget > spent0) CurveToken(token).burn(tokenBudget - spent0);
        if (usdcBudget > spent1) protocolFeesOwed += usdcBudget - spent1;

        emit Graduated(token, PoolId.unwrap(key.toId()), spent1, spent0, liquidity);
    }

    function _sqrtPriceX96(uint256 usdcReserve, uint256 tokenReserve) private pure returns (uint160) {
        return uint160(Math.sqrt(FullMath.mulDiv(usdcReserve, 1 << 192, tokenReserve)));
    }

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    /// @notice Collect swap fees earned by a graduated launch's locked position.
    /// @dev Permissionless. `burn` is only ever called with zero liquidity, the
    ///      canonical poke that credits fees; there is no path that removes the
    ///      position. The token side is sold for USDC before splitting so every
    ///      payout is in USDC; whatever cannot be sold is split in kind.
    function collectFees(address token) external nonReentrant {
        Curve storage c = curves[_index(token)];
        if (!c.graduated) revert NotGraduated();

        PoolKey memory key = _key(token, USDC, poolFee, tickSpacing);
        int24 lower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        int24 upper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        (uint256 owed0, uint256 owed1) = _collect(key, lower, upper);

        // Whatever creator tax the hook is holding for this launch comes home in
        // the same call. Unlike pool fees it is not split with the treasury.
        PoolId id = key.toId();
        uint256 tax0 = hook.owed(id, key.currency0);
        uint256 tax1 = hook.owed(id, key.currency1);
        if (tax0 > 0 || tax1 > 0) hook.claim(key);

        uint256 usdc = owed1;
        uint256 unsold = owed0;
        if (owed0 >= MIN_FEE_SWAP) {
            // Routed through `swapForSelf` so a pool that cannot execute the
            // swap right now leaves collection working -- this is the only path
            // to the treasury's share as well as the creator's.
            try this.swapForSelf(key, true, owed0) returns (uint256 sold, uint256 got) {
                unsold -= sold;
                usdc += got;
            } catch {}
        }

        if (usdc > 0) {
            uint256 protocol = (usdc * protocolFeeBps) / 10_000;
            protocolFeesOwed += protocol;
            creatorFeesOwed[token] += usdc - protocol;
        }
        // The pool-side tax is split like everything else and rides the same
        // claim path, so a holders launch still pays holders.
        if (tax1 > 0) {
            uint256 taxProtocol = (tax1 * protocolFeeBps) / 10_000;
            protocolFeesOwed += taxProtocol;
            creatorFeesOwed[token] += tax1 - taxProtocol;
        }
        // The token side joins `unsold`, which is already split below.
        if (tax0 > 0) unsold += tax0;
        if (unsold > 0) {
            uint256 protocolTokens = (unsold * protocolFeeBps) / 10_000;
            if (protocolTokens > 0) IERC20(token).safeTransfer(treasury, protocolTokens);
            if (unsold > protocolTokens) IERC20(token).safeTransfer(c.feeRecipient, unsold - protocolTokens);
        }

        emit FeesCollected(token, usdc, unsold);
    }

    /// @notice Pay a launch's accrued creator fees out. Permissionless.
    /// @dev Goes to the fee recipient, or to holders if the launch chose that.
    ///      Holder rewards are funded here rather than on every trade, so a
    ///      trade never pays for the reward bookkeeping.
    function claimCreatorFees(address token) external nonReentrant {
        Curve storage c = curves[_index(token)];
        uint256 amount = creatorFeesOwed[token];
        if (amount == 0) revert NothingOut();
        creatorFeesOwed[token] = 0;
        if (CurveToken(token).rewardsEnabled()) {
            IERC20(USDC).safeTransfer(token, amount);
            CurveToken(token).notifyRewards();
            emit HolderRewardsFunded(token, amount);
        } else {
            IERC20(USDC).safeTransfer(c.feeRecipient, amount);
            emit CreatorFeesClaimed(token, c.feeRecipient, amount);
        }
    }

    /// @notice Pay accrued protocol fees to the treasury. Permissionless.
    function sweepProtocolFees() external nonReentrant {
        uint256 amount = protocolFeesOwed;
        if (amount == 0) revert NothingOut();
        protocolFeesOwed = 0;
        IERC20(USDC).safeTransfer(treasury, amount);
        emit ProtocolFeesSwept(amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function curveCount() external view returns (uint256) {
        return curves.length;
    }

    function isCurve(address token) external view returns (bool) {
        return _indexPlusOne[token] != 0;
    }

    function curveOf(address token) external view returns (Curve memory) {
        return curves[_index(token)];
    }

    /// @notice A launch by creation index, for paging through the registry.
    function curveAt(uint256 index) external view returns (Curve memory) {
        return curves[index];
    }

    /// @notice What `usdcIn` would buy for `trader` right now, including any snipe tax.
    function quoteBuy(address token, uint256 usdcIn, address trader)
        external
        view
        returns (uint256 tokensOut, uint256 usdcUsed, uint256 fee)
    {
        Curve storage c = curves[_index(token)];
        if (c.graduated) return (0, 0, 0);
        uint256 tax;
        (tokensOut, usdcUsed, fee, tax) =
            _quoteBuy(c.tokensSold, c.usdcRaised, usdcIn, _feeBps(c), _snipeTaxBps(c, trader));
        fee += tax;
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 usdcOut, uint256 fee) {
        Curve storage c = curves[_index(token)];
        if (c.graduated) return (0, 0);
        (usdcOut, fee,) = _quoteSell(c.tokensSold, c.usdcRaised, tokensIn, _feeBps(c));
    }

    function snipeTaxBps(address token, address trader) external view returns (uint256) {
        return _snipeTaxBps(curves[_index(token)], trader);
    }

    function predictTokenAddress(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        bool rewardHolders,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initCodeHash = tokenInitCodeHash(creator, name, symbol, metadataURI, rewardHolders);
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(tokenDeployer), _saltFor(creator, salt), initCodeHash))))
        );
    }

    /// @notice Creation-code hash for a launch's token, so salts can be mined locally.
    function tokenInitCodeHash(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        bool rewardHolders
    ) public view returns (bytes32) {
        return tokenDeployer.curveTokenInitCodeHash(
            name, symbol, TOTAL_SUPPLY, metadataURI, creator, USDC, rewardHolders, address(this), address(hook)
        );
    }

    function _index(address token) private view returns (uint256) {
        uint256 i = _indexPlusOne[token];
        if (i == 0) revert NotALaunch();
        return i - 1;
    }

    function _saltFor(address creator, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, salt));
    }
}
