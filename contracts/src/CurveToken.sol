// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";

/// @title CurveToken
/// @notice A LaunchToken that starts life on a bonding curve.
///
/// @dev Until the curve graduates, every transfer must have the curve on one
///      side of it: buying from it, selling to it. Wallet-to-wallet transfers
///      open at graduation.
///
///      The restriction exists to protect graduation, not to trap holders. A
///      Uniswap pool's address is predictable before the token even exists, so
///      without it anyone could seed that pool with curve-bought tokens at a
///      price of their choosing and have graduation either fail or hand them
///      the difference. With it, the pool can never hold the token before the
///      curve puts it there, so any liquidity someone places early is USDC
///      only, and moving the price through it costs the graduation nothing.
///
///      Holder rewards work as on a direct launch when the creator opts in:
///      the curve and, later, the pool are excluded, so only real holders earn.
contract CurveToken is LaunchToken {
    /// @notice Set once, by the curve, in the transaction that graduates it.
    bool public graduated;

    event Graduated();

    error TransfersLocked();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        string memory metadataURI_,
        address creator_,
        address usdc_,
        bool rewardsEnabled_,
        address launchpad_,
        address taxCollector_
    ) LaunchToken(name_, symbol_, totalSupply_, metadataURI_, creator_, usdc_, rewardsEnabled_, launchpad_, taxCollector_) {}

    /// @notice Open transfers. Callable only by the curve that deployed this token.
    function graduate() external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        graduated = true;
        emit Graduated();
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mint and burn are always allowed: minting happens once, to the curve,
        // in the constructor, and burning only ever shrinks supply.
        if (!graduated && from != address(0) && to != address(0) && from != launchpad && to != launchpad) {
            revert TransfersLocked();
        }
        super._update(from, to, value);
    }
}
