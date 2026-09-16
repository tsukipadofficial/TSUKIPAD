// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

import {TsukiHook} from "./TsukiHook.sol";
import {TickMath, LiquidityAmounts} from "./libraries/V3Math.sol";

/// @notice The Uniswap v4 plumbing both pads share.
///
/// @dev Arc has both Uniswap v3 and v4. The pads use v4 for one reason: a hook.
///      A creator tax has to keep applying after a launch graduates, and v4 is
///      the only version where a pool can charge one without a transfer tax --
///      which v3 pools reject on the sell side, leaving a tax that hits buyers
///      and lets sellers out free.
///
///      Everything in v4 happens inside `unlock`: the manager hands control
///      back, the caller runs its operations, and every currency it touched has
///      to net to zero before the call returns. This contract wraps the four
///      operations the pads need -- open a pool, place liquidity nobody can
///      remove, collect the fees that liquidity earned, and sell one side for
///      the other -- so neither pad has to hold the accounting in its head.
///
///      Positions are owned by the pad contract itself with no path that passes
///      a negative `liquidityDelta`, which is what makes the liquidity locked:
///      not a burned LP token, but the absence of any code that could withdraw.
abstract contract TsukiV4Pool is IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;

    IPoolManager public immutable poolManager;

    /// @dev The tax hook every launch pool wears. Immutable, and it refuses any
    ///      pool this pad did not register, so no launch can be opened against
    ///      it by anyone else.
    TsukiHook public immutable hook;

    error NotPoolManager();
    error NotUnlocked();
    error NotSelf();

    /// @dev What the current unlock is for. v4 gives one callback for every
    ///      operation, so the pad says up front which one it asked for.
    enum Op {
        MINT,
        COLLECT,
        SWAP
    }

    constructor(IPoolManager poolManager_, TsukiHook hook_) {
        poolManager = poolManager_;
        hook = hook_;
    }

    // ------------------------------------------------------------- pool key

    /// @dev Token is always currency0: every launch address is mined below
    ///      USDC's, which is what lets the pads speak in "token side" and "USDC
    ///      side" everywhere instead of currency0/currency1.
    function _key(address token, address usdc, uint24 fee, int24 spacing) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(token),
            currency1: Currency.wrap(usdc),
            fee: fee,
            tickSpacing: spacing,
            hooks: IHooks(address(hook))
        });
    }

    // ------------------------------------------------------------ operations

    /// @dev Registers the launch's tax with the hook and opens the pool at
    ///      `sqrtPriceX96`. Registration must come first: the hook rejects the
    ///      initialize of any pool it does not know, which is also why nobody
    ///      can create this pool before the pad does.
    function _openPool(PoolKey memory key, uint160 sqrtPriceX96, address creator, uint16 taxBps) internal {
        hook.register(key, creator, taxBps);
        poolManager.initialize(key, sqrtPriceX96);
    }

    /// @dev Places liquidity that can never be withdrawn, paying for it out of
    ///      this contract's balance, and returns what each side actually cost.
    function _mintLocked(PoolKey memory key, int24 tickLower, int24 tickUpper, uint256 max0, uint256 max1)
        internal
        returns (uint256 spent0, uint256 spent1, uint128 liquidity)
    {
        (uint160 current,,,) = poolManager.getSlot0(key.toId());
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            current, TickMath.getSqrtRatioAtTick(tickLower), TickMath.getSqrtRatioAtTick(tickUpper), max0, max1
        );
        if (liquidity == 0) return (0, 0, 0);

        bytes memory out = poolManager.unlock(abi.encode(Op.MINT, key, tickLower, tickUpper, uint256(liquidity)));
        (spent0, spent1) = abi.decode(out, (uint256, uint256));
    }

    /// @dev Credits and withdraws the fees the locked position has earned.
    ///      `liquidityDelta` is zero, the canonical way to settle fees without
    ///      touching the position itself.
    function _collect(PoolKey memory key, int24 tickLower, int24 tickUpper)
        internal
        returns (uint256 fee0, uint256 fee1)
    {
        bytes memory out = poolManager.unlock(abi.encode(Op.COLLECT, key, tickLower, tickUpper, uint256(0)));
        (fee0, fee1) = abi.decode(out, (uint256, uint256));
    }

    /// @dev Sells `amountIn` of one side for the other, all of it, price limit
    ///      wide open. Used to turn token-side fees into USDC and to buy back
    ///      supply for burning -- never to move the price on purpose.
    function _swapExactIn(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        internal
        returns (uint256 spent, uint256 received)
    {
        return _swapExactIn(key, zeroForOne, amountIn, 0);
    }

    /// @dev `priceLimitX96` of zero means "as far as the pool will go". A real
    ///      limit stops the swap at a price instead, which is what a buy-back
    ///      wants: past the top of a launch's range there is no liquidity, and a
    ///      swap that runs into it spends less than it was given and leaves the
    ///      difference stranded.
    function _swapExactIn(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 priceLimitX96)
        internal
        returns (uint256 spent, uint256 received)
    {
        bytes memory out = poolManager.unlock(abi.encode(Op.SWAP, key, zeroForOne, amountIn, priceLimitX96));
        (spent, received) = abi.decode(out, (uint256, uint256));
    }

    /// @dev `_swapExactIn` behind an external call, so a caller can `try` it.
    ///      A pool that cannot execute right now -- drifted out of range, or
    ///      holding nothing on the side being sold -- must not make collecting
    ///      fees impossible for the creator and the treasury.
    function swapForSelf(PoolKey calldata key, bool zeroForOne, uint256 amountIn)
        external
        returns (uint256 spent, uint256 received)
    {
        if (msg.sender != address(this)) revert NotSelf();
        return _swapExactIn(key, zeroForOne, amountIn, 0);
    }

    // -------------------------------------------------------------- callback

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Op op = abi.decode(data[:32], (Op));

        if (op == Op.SWAP) {
            (, PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 priceLimitX96) =
                abi.decode(data, (Op, PoolKey, bool, uint256, uint160));
            BalanceDelta delta = poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -amountIn.toInt256(),
                    sqrtPriceLimitX96: priceLimitX96 != 0
                        ? priceLimitX96
                        : (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                }),
                ""
            );
            (Currency inC, Currency outC) =
                zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
            int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
            int128 outDelta = zeroForOne ? delta.amount1() : delta.amount0();

            uint256 spent = uint256(uint128(-inDelta));
            uint256 received = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
            if (spent > 0) _settle(inC, spent);
            if (received > 0) poolManager.take(outC, address(this), received);
            return abi.encode(spent, received);
        }

        (, PoolKey memory key, int24 tickLower, int24 tickUpper, uint256 liquidity) =
            abi.decode(data, (Op, PoolKey, int24, int24, uint256));

        if (op == Op.MINT) {
            (BalanceDelta caller,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int256(liquidity),
                    salt: bytes32(0)
                }),
                ""
            );
            // Adding liquidity is always owed to the pool: both sides negative.
            uint256 owed0 = caller.amount0() < 0 ? uint256(uint128(-caller.amount0())) : 0;
            uint256 owed1 = caller.amount1() < 0 ? uint256(uint128(-caller.amount1())) : 0;
            if (owed0 > 0) _settle(key.currency0, owed0);
            if (owed1 > 0) _settle(key.currency1, owed1);
            return abi.encode(owed0, owed1);
        }

        // COLLECT
        (, BalanceDelta fees) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            ""
        );
        uint256 fee0 = fees.amount0() > 0 ? uint256(uint128(fees.amount0())) : 0;
        uint256 fee1 = fees.amount1() > 0 ? uint256(uint128(fees.amount1())) : 0;
        if (fee0 > 0) poolManager.take(key.currency0, address(this), fee0);
        if (fee1 > 0) poolManager.take(key.currency1, address(this), fee1);
        return abi.encode(fee0, fee1);
    }

    /// @dev v4 settles by telling the manager to take stock, sending the tokens,
    ///      and then having it count what arrived.
    function _settle(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
