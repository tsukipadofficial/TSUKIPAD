// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IUniswapV3Factory, IUniswapV3Pool, IUniswapV3SwapCallback} from "./interfaces/IUniswapV3.sol";
import {TickMath} from "./libraries/V3Math.sol";

/// @title ArcSwapRouter
/// @notice Single-hop exact-input router for launch pools.
/// @dev Arc testnet has no canonical Uniswap deployment, so the frontend needs a
///      router of its own to trade. This is deliberately minimal: one hop, exact
///      input, slippage bound. On Arc mainnet, where canonical Uniswap ships day
///      one, point the frontend at the official SwapRouter02 instead — the pools
///      created by the launchpad are ordinary V3 pools and need nothing special.
contract ArcSwapRouter is IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    IUniswapV3Factory public immutable v3Factory;

    error InvalidCallback();
    error InsufficientOutput();
    error Expired();

    constructor(address factory_) {
        v3Factory = IUniswapV3Factory(factory_);
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Swap an exact amount of `tokenIn` for as much `tokenOut` as possible.
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        if (block.timestamp > params.deadline) revert Expired();

        address pool = v3Factory.getPool(params.tokenIn, params.tokenOut, params.fee);
        if (pool == address(0)) revert InvalidCallback();

        bool zeroForOne = params.tokenIn < params.tokenOut;

        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            params.recipient,
            zeroForOne,
            int256(params.amountIn),
            // Swap as far as the pool allows; slippage is enforced on the output.
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            abi.encode(params.tokenIn, params.tokenOut, params.fee, msg.sender)
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        if (amountOut < params.amountOutMinimum) revert InsufficientOutput();
    }

    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        (address tokenIn, address tokenOut, uint24 fee, address payer) =
            abi.decode(data, (address, address, uint24, address));

        // Only a pool the canonical factory produced for this exact triple may call back.
        if (msg.sender != v3Factory.getPool(tokenIn, tokenOut, fee)) revert InvalidCallback();

        uint256 amountOwed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).safeTransferFrom(payer, msg.sender, amountOwed);
    }
}
