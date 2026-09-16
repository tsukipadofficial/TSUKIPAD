// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
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
///      The tax is taken on the *unspecified* currency of the swap: the output
///      of an exact-input swap, the input of an exact-output one. That is the
///      only side whose amount the pool has already settled by the time the hook
///      runs, so charging there needs no second swap and cannot move the price.
///      Buys are charged in the token, sells in USDC.
///
///      What the tax is NOT: it is not the 1% pool fee. That fee belongs to the
///      liquidity -- which for every launch here is a position nobody can pull --
///      and is split with the treasury when it is collected. The tax is extra,
///      set by the creator between 0 and MAX_CREATOR_TAX_BPS at launch, and all
///      of it is the creator's.
///
///      Every parameter is fixed when the pool is registered, by the launchpad
///      that created it. There is no owner, no setter, and no path that raises a
///      tax on a launch that is already trading.
contract TsukiHook is IHooks {
    using PoolIdLibrary for PoolKey;
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
                beforeSwap: false,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
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

    /// @notice Pays a pool's accrued tax to its creator.
    /// @dev Permissionless on purpose -- it always pays the creator recorded at
    ///      launch, so anyone can settle it and nobody can redirect it.
    function claim(PoolKey calldata key) external {
        PoolId id = key.toId();
        Config memory c = configOf[id];
        if (!c.registered) revert NotRegistered();
        uint256 a0 = owed[id][key.currency0];
        uint256 a1 = owed[id][key.currency1];
        if (a0 == 0 && a1 == 0) revert NothingToClaim();
        if (a0 > 0) {
            owed[id][key.currency0] = 0;
            key.currency0.transfer(c.creator, a0);
            emit TaxClaimed(id, c.creator, key.currency0, a0);
        }
        if (a1 > 0) {
            owed[id][key.currency1] = 0;
            key.currency1.transfer(c.creator, a1);
            emit TaxClaimed(id, c.creator, key.currency1, a1);
        }
    }

    // ------------------------------------------------------------- callbacks

    /// @dev A pool wearing this hook must have been registered by a launcher.
    function beforeInitialize(address, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (!configOf[key.toId()].registered) revert NotRegistered();
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Takes the tax out of the unspecified side of the swap and holds it
    ///      for the creator. Returning the amount as the hook's delta is what
    ///      charges the swapper for it.
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        PoolId id = key.toId();
        uint16 taxBps = configOf[id].taxBps;
        if (taxBps == 0) return (IHooks.afterSwap.selector, 0);

        // The pads swap for their own housekeeping -- turning token-side fees
        // into USDC, buying supply back to burn, squaring a pool up at
        // graduation. Taxing those would take a cut of money already owed to
        // the creator and the treasury, so the pads pay no tax on their own
        // swaps. No user swap can reach here as a pad: these are contracts
        // with no call-forwarding path.
        if (sender == launchpad || sender == curve) return (IHooks.afterSwap.selector, 0);

        // Exact input spends currency0 when zeroForOne, so the unspecified side
        // is the other one; exact output flips it.
        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        (Currency currency, int128 amount) =
            specifiedIs0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        if (amount < 0) amount = -amount;

        uint256 fee = (uint256(uint128(amount)) * taxBps) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        poolManager.take(currency, address(this), fee);
        owed[id][currency] += fee;
        emit TaxTaken(id, currency, fee);

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

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
