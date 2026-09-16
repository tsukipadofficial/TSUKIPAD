// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice What the tape is told when a pool cannot fill the whole order.
///
/// @dev A launch's liquidity is one concentrated range, so selling into a pool
///      that holds no USDC is ordinary: the swap fills what it can, the router
///      hands the rest back, and the seller keeps those tokens. The event has
///      to say so. Emitting the offered amount instead of the filled amount
///      would report a sale that never happened -- inflating the trade tape,
///      every volume figure built from it, and the trader's own position --
///      while the tokens sat in their wallet the whole time.
contract RouterPartialFillTest is TsukiTestBase {
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    function setUp() public {
        _deployStack(_defaultConfig(treasury, address(this)));
        usdc.mint(alice, 1_000_000e6);
        vm.warp(1_000_000);
    }

    function _launch() internal returns (address token) {
        bytes32 salt;
        for (uint256 i = 0; i < 20_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Fill", "FILL", SUPPLY, "ipfs://fill", false, bytes32(i)) < USDC_ADDR)
            {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Fill",
                symbol: "FILL",
                metadataURI: "ipfs://fill",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
    }

    function test_aPartialSellReportsWhatFilled_notWhatWasOffered() public {
        address token = _launch();

        // Buy, then offer back far more than the pool's USDC can ever pay for.
        uint256 bought = _poolBuy(alice, token, 100e6);
        uint256 offered = bought * 4;
        deal(token, alice, offered);

        uint256 tokensBefore = IERC20(token).balanceOf(alice);

        vm.recordLogs();
        uint256 out = _poolSell(alice, token, offered);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 actuallySpent = tokensBefore - IERC20(token).balanceOf(alice);
        assertLt(actuallySpent, offered, "the pool could not take the whole offer");
        assertGt(IERC20(token).balanceOf(alice), 0, "the remainder came back");

        bytes32 topic = keccak256("Swapped(bytes32,address,address,bool,uint256,uint256)");
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != topic) continue;
            (, uint256 amountIn, uint256 amountOut) = abi.decode(logs[i].data, (bool, uint256, uint256));
            assertEq(amountIn, actuallySpent, "the tape reports the filled amount");
            assertEq(amountOut, out, "and what the seller received");
            seen = true;
        }
        assertTrue(seen, "a Swapped event was emitted");
    }

    function test_aFullyFilledSellStillReportsTheWholeAmount() public {
        address token = _launch();
        uint256 bought = _poolBuy(alice, token, 100e6);

        // A tenth of the position is well inside what the pool can absorb.
        uint256 offered = bought / 10;
        uint256 tokensBefore = IERC20(token).balanceOf(alice);

        vm.recordLogs();
        _poolSell(alice, token, offered);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(tokensBefore - IERC20(token).balanceOf(alice), offered, "no refund on a full fill");

        bytes32 topic = keccak256("Swapped(bytes32,address,address,bool,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != topic) continue;
            (, uint256 amountIn,) = abi.decode(logs[i].data, (bool, uint256, uint256));
            assertEq(amountIn, offered, "a full fill reports the whole amount");
        }
    }
}
