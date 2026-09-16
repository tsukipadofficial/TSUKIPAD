// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

/// @notice The swap route the TSUKIPAD site uses for graduated launches.
///
/// @dev Uniswap's own Universal Router can trade these pools and always will --
///      they are ordinary v4 pools. This exists because the site needs one
///      predictable entry point it can quote against and approve once, with no
///      Permit2 step and no command encoding, and because a pad that depends on
///      a router it does not control is a pad whose trade button can break on
///      somebody else's upgrade.
///
///      It holds nothing. Every swap pulls from the caller, settles with the
///      manager, and pays the recipient inside the same unlock.
contract TsukiRouter is IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;

    IPoolManager public immutable poolManager;

    /// @notice One trade, as the site and the indexer see it.
    /// @dev v4's own Swap event names the contract that called the manager, not
    ///      the person who asked for the trade, so a pad indexing the manager
    ///      alone would credit every trade to this router. This carries the
    ///      trader, which is what positions and the leaderboard are built from.
    event Swapped(
        PoolId indexed id,
        address indexed trader,
        address indexed recipient,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );

    error NotPoolManager();
    error Expired();
    error Slippage();
    error NothingOut();

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    struct ExactInputSingleParams {
        PoolKey key;
        /// @dev True sells currency0 (the launch token) for currency1 (USDC).
        bool zeroForOne;
        uint256 amountIn;
        /// @dev Reverts below this, after the pool fee and any creator tax.
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
    }

    /// @notice Sell an exact amount of one side of a pool for the other.
    /// @return amountOut What the recipient actually received.
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        if (block.timestamp > params.deadline) revert Expired();

        Currency input = params.zeroForOne ? params.key.currency0 : params.key.currency1;
        IERC20(Currency.unwrap(input)).safeTransferFrom(msg.sender, address(this), params.amountIn);

        bytes memory out = poolManager.unlock(abi.encode(params, msg.sender));
        amountOut = abi.decode(out, (uint256));

        if (amountOut == 0) revert NothingOut();
        if (amountOut < params.amountOutMinimum) revert Slippage();

        emit Swapped(
            params.key.toId(), msg.sender, params.recipient, params.zeroForOne, params.amountIn, amountOut
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (ExactInputSingleParams memory p, address payer) = abi.decode(data, (ExactInputSingleParams, address));

        BalanceDelta delta = poolManager.swap(
            p.key,
            SwapParams({
                zeroForOne: p.zeroForOne,
                amountSpecified: -p.amountIn.toInt256(),
                sqrtPriceLimitX96: p.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        (Currency inC, Currency outC) =
            p.zeroForOne ? (p.key.currency0, p.key.currency1) : (p.key.currency1, p.key.currency0);
        int128 inDelta = p.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outDelta = p.zeroForOne ? delta.amount1() : delta.amount0();

        uint256 spent = uint256(uint128(-inDelta));
        uint256 received = outDelta > 0 ? uint256(uint128(outDelta)) : 0;

        poolManager.sync(inC);
        IERC20(Currency.unwrap(inC)).safeTransfer(address(poolManager), spent);
        poolManager.settle();

        if (received > 0) poolManager.take(outC, p.recipient, received);

        // A pool that took less than was offered -- it ran out of liquidity
        // inside the price limit -- leaves the remainder with the payer rather
        // than stranding it here.
        uint256 refund = p.amountIn - spent;
        if (refund > 0) IERC20(Currency.unwrap(inC)).safeTransfer(payer, refund);

        return abi.encode(received);
    }
}
