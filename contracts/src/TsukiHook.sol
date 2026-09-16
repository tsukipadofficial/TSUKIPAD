// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";

/// @notice The creator tax, charged on every swap of a TSUKIPAD launch.
///
/// @dev Uniswap v4 hook. Arc has no Uniswap v3 the pads can rely on, but it does
///      have v4, and v4 is the only version where a launch can keep charging its
///      tax after graduation: a hook sits inside the pool and takes its cut of
///      the swap itself. On v3 the same thing is only expressible as a transfer
///      tax, which v3 pools reject on the sell side -- a tax that applies to
///      buyers and not to sellers is a worse deal than no tax at all.
///
///      The tax is always taken in USDC, never in the launch token. Which
///      callback takes it depends only on which side of the swap USDC is on:
///      when USDC is the amount the trader specified (a buy of "spend this
///      much", a sell of "get me this much"), `beforeSwap` skims it off that
///      amount before the pool sees it; when USDC is the other side, `afterSwap`
///      skims it off what the pool produced. Either way a 10% tax on a $100 buy
///      is $10 -- not 10% of the tokens at the marginal price, which on a fresh
///      single-sided range can be worth most of the buy once sold, and whose
///      sale would crash the price it was taken at.
///
///      What the tax is NOT: it is not the 1% pool fee. That fee belongs to the
///      liquidity -- which for every launch here is a position nobody can pull --
///      and is split with the treasury when it is collected. The tax is extra,
///      set by the creator between 0 and MAX_CREATOR_TAX_BPS at launch, and all
///      of it is the creator's.
///
///      The tax is booked, not moved, while the swap is in flight. A hook that
///      pulls real USDC out of the manager mid-swap fails on a pool the manager
///      holds no USDC for yet -- every fresh direct launch, whose first buy is
///      the first USDC to arrive -- and on a shared manager quietly borrows
///      other pools' reserves until the trader settles. So the callbacks mint
///      the hook an internal claim on the manager for the amount, which is
///      what v4's accounting is for, and `claim` turns those claims into real
///      USDC in a transaction of its own, when the manager has long since been
///      paid.
///
///      Every parameter is fixed when the pool is registered, by the launchpad
///      that created it. There is no owner, no setter, and no path that raises a
///      tax on a launch that is already trading.
contract TsukiHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeCast for uint256;

    /// @dev The same ceiling the curve enforces, so a launch cannot graduate into
    ///      a pool that taxes harder than its curve did.
    uint16 public constant MAX_CREATOR_TAX_BPS = 1_000; // 10%

    IPoolManager public immutable poolManager;

    /// @dev Only these may register a pool: the direct launchpad and the curve.
    ///      Anyone can point a pool at this hook, but an unregistered pool is
    ///      refused at initialize, so nobody else's pool can wear this tax.
    address public immutable launchpad;
    address public immutable curve;

    struct Config {
        address creator; // receives the whole tax
        uint16 taxBps; // 0 = no tax, the common case
        bool registered;
    }

    mapping(PoolId => Config) public configOf;

    /// @dev Tax taken and not yet claimed, per pool and currency.
    mapping(PoolId => mapping(Currency => uint256)) public owed;

    event PoolRegistered(PoolId indexed id, address indexed creator, uint16 taxBps);
    event TaxTaken(PoolId indexed id, Currency indexed currency, uint256 amount);
    event TaxClaimed(PoolId indexed id, address indexed to, Currency indexed currency, uint256 amount);

    error NotALauncher();
    error AlreadyRegistered();
    error NotRegistered();
    error TaxTooHigh();
    error NotPoolManager();
    error HookNotImplemented();
    error NothingToClaim();
    error NotTheRecipient();

    constructor(IPoolManager poolManager_, address launchpad_, address curve_) {
        poolManager = poolManager_;
        launchpad = launchpad_;
        curve = curve_;
        // Fails the deployment outright if the mined address does not carry
        // exactly the permission bits the callbacks below implement.
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @notice Declares the tax for a pool before it is initialized.
    /// @dev Called by the launchpad or the curve in the same transaction that
    ///      creates the pool. Once set it can never be changed: there is no
    ///      second write path to `configOf`.
    function register(PoolKey calldata key, address creator, uint16 taxBps) external {
        if (msg.sender != launchpad && msg.sender != curve) revert NotALauncher();
        if (taxBps > MAX_CREATOR_TAX_BPS) revert TaxTooHigh();
        PoolId id = key.toId();
        if (configOf[id].registered) revert AlreadyRegistered();
        configOf[id] = Config({creator: creator, taxBps: taxBps, registered: true});
        emit PoolRegistered(id, creator, taxBps);
    }

    /// @notice Pays a pool's accrued tax to its recorded recipient.
    /// @dev Only that recipient may call it. The recipient is the pad that
    ///      opened the pool, and the pad learns how much arrived by reading
    ///      `owed` in the same transaction it claims -- a claim by anyone else
    ///      would land the money in the pad untracked, where no code can reach
    ///      it. A large buyer would even be paid to do that, since the pad sells
    ///      what it collects into the pool they are about to dump into.
    function claim(PoolKey calldata key) external {
        PoolId id = key.toId();
        Config memory c = configOf[id];
        if (!c.registered) revert NotRegistered();
        if (msg.sender != c.creator) revert NotTheRecipient();
        uint256 a0 = owed[id][key.currency0];
        uint256 a1 = owed[id][key.currency1];
        if (a0 == 0 && a1 == 0) revert NothingToClaim();
        owed[id][key.currency0] = 0;
        owed[id][key.currency1] = 0;
        poolManager.unlock(abi.encode(key, c.creator, a0, a1));
        if (a0 > 0) emit TaxClaimed(id, c.creator, key.currency0, a0);
        if (a1 > 0) emit TaxClaimed(id, c.creator, key.currency1, a1);
    }

    /// @dev Burns the claims the swaps minted and takes the real currency to
    ///      the recipient. Only ever entered from `claim`.
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (PoolKey memory key, address to, uint256 a0, uint256 a1) = abi.decode(data, (PoolKey, address, uint256, uint256));
        if (a0 > 0) {
            poolManager.burn(address(this), key.currency0.toId(), a0);
            poolManager.take(key.currency0, to, a0);
        }
        if (a1 > 0) {
            poolManager.burn(address(this), key.currency1.toId(), a1);
            poolManager.take(key.currency1, to, a1);
        }
        return "";
    }

    // ------------------------------------------------------------- callbacks

    /// @dev A pool wearing this hook must have been registered by a launcher.
    function beforeInitialize(address, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (!configOf[key.toId()].registered) revert NotRegistered();
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Where USDC sits in this swap. A trader specifies either what they
    ///      pay (exact input) or what they get (exact output); the pool works
    ///      out the other side. The tax is skimmed from USDC wherever it is.
    function _usdcIsSpecified(SwapParams calldata params) private pure returns (bool) {
        bool exactInput = params.amountSpecified < 0;
        // Exact input: the specified side is the input, which is currency1
        // (USDC) when not zeroForOne. Exact output: the specified side is the
        // output, which is currency1 when zeroForOne.
        return exactInput ? !params.zeroForOne : params.zeroForOne;
    }

    function _taxOn(address sender, PoolId id) private view returns (uint16) {
        uint16 taxBps = configOf[id].taxBps;
        if (taxBps == 0) return 0;
        // The pads swap for their own housekeeping -- turning token-side pool
        // fees into USDC, buying supply back to burn. Taxing those would take
        // a cut of money already owed to the creator and the treasury, so the
        // pads pay no tax on their own swaps. No user swap can reach here as a
        // pad: these are contracts with no call-forwarding path.
        if (sender == launchpad || sender == curve) return 0;
        return taxBps;
    }

    /// @dev USDC is the specified amount: skim the tax off it before the pool
    ///      sees it. Returning the amount as the hook's delta on the specified
    ///      side is what charges the trader; `take` is what realises it.
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        uint16 taxBps = _taxOn(sender, id);
        if (taxBps == 0 || !_usdcIsSpecified(params)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 amount = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);
        uint256 fee = (amount * taxBps) / 10_000;
        if (fee == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        poolManager.mint(address(this), key.currency1.toId(), fee);
        owed[id][key.currency1] += fee;
        emit TaxTaken(id, key.currency1, fee);

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt128(), 0), 0);
    }

    /// @dev USDC is the other side: skim the tax off what the pool produced.
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        PoolId id = key.toId();
        uint16 taxBps = _taxOn(sender, id);
        if (taxBps == 0 || _usdcIsSpecified(params)) return (IHooks.afterSwap.selector, 0);

        int128 amount = delta.amount1();
        if (amount < 0) amount = -amount;
        uint256 fee = (uint256(uint128(amount)) * taxBps) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        poolManager.mint(address(this), key.currency1.toId(), fee);
        owed[id][key.currency1] += fee;
        emit TaxTaken(id, key.currency1, fee);

        return (IHooks.afterSwap.selector, fee.toInt128());
    }

    // The permission bits above are false for everything else, so the pool
    // manager never calls these. They exist to satisfy IHooks.

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
