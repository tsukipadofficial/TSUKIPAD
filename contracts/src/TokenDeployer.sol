// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";
import {CurveToken} from "./CurveToken.sol";

/// @notice Deploys launch tokens on behalf of the pads.
///
/// @dev Exists for one reason: size. A contract that deploys a token carries
///      that token's entire creation code in its own runtime, and with the
///      Uniswap v4 plumbing added both pads ran past the 24,576-byte limit.
///      Moving the two token bytecodes here buys each pad about 8KB.
///
///      There is nothing to trust here. A token's `launchpad` -- the address
///      allowed to open its pool, move its supply before graduation and burn
///      from it -- is always `msg.sender`, never an argument, so a stranger
///      calling this can only mint themselves a token that answers to them.
///      They cannot produce a token at an address a pad would predict either:
///      the pad is part of the creation code, so a different caller lands at a
///      different address.
contract TokenDeployer {
    /// @notice Every launch, from either pad, in one place.
    /// @dev Both pads deploy through here, so this is the single address an
    ///      indexer or a trading bot can watch to see every TSUKIPAD launch --
    ///      without it they would have to know about, and keep up with, each pad
    ///      separately. `curve` says which shape the launch is: a curve launch
    ///      trades on the pad until it graduates, a direct one is in a Uniswap
    ///      pool from this block.
    ///
    ///      Anyone can call this contract, so anyone can emit this event with a
    ///      `pad` of their choosing. `pad` is indexed for exactly that reason:
    ///      a consumer must filter on the pads it trusts, and treat `creator`
    ///      and the names as claims made by whoever `pad` is.
    event TokenDeployed(
        address indexed token, address indexed pad, address indexed creator, bool curve, string name, string symbol
    );

    /// @notice Deploy a direct-launch token. Its pad is the caller.
    function deployLaunchToken(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        address creator,
        address rewardToken,
        bool rewardsEnabled,
        address taxCollector
    ) external returns (address token) {
        token = address(
            new LaunchToken{salt: salt}(
                name, symbol, totalSupply, metadataURI, creator, rewardToken, rewardsEnabled, msg.sender, taxCollector
            )
        );
        emit TokenDeployed(token, msg.sender, creator, false, name, symbol);
    }

    /// @notice Deploy a bonding-curve token. Its pad is the caller.
    function deployCurveToken(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        address creator,
        address rewardToken,
        bool rewardsEnabled,
        address taxCollector
    ) external returns (address token) {
        token = address(
            new CurveToken{salt: salt}(
                name, symbol, totalSupply, metadataURI, creator, rewardToken, rewardsEnabled, msg.sender, taxCollector
            )
        );
        emit TokenDeployed(token, msg.sender, creator, true, name, symbol);
    }

    /// @dev The hashes a pad needs to predict a token's address, and that the
    ///      site needs to mine a salt. Kept here because the creation code is
    ///      here; a pad holding its own copy would defeat the point.
    function launchTokenInitCodeHash(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        address creator,
        address rewardToken,
        bool rewardsEnabled,
        address pad,
        address taxCollector
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode,
                abi.encode(name, symbol, totalSupply, metadataURI, creator, rewardToken, rewardsEnabled, pad, taxCollector)
            )
        );
    }

    function curveTokenInitCodeHash(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        string calldata metadataURI,
        address creator,
        address rewardToken,
        bool rewardsEnabled,
        address pad,
        address taxCollector
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(CurveToken).creationCode,
                abi.encode(name, symbol, totalSupply, metadataURI, creator, rewardToken, rewardsEnabled, pad, taxCollector)
            )
        );
    }
}
