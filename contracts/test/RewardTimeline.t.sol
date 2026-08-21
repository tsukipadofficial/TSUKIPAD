// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A narrated walkthrough of who earns what, and when.
///
/// Answers the three questions that decide whether the mechanic is fair:
///   1. Does everyone get the same amount, or is it proportional?
///   2. If a holder sells, do they keep what they earned?
///   3. If someone buys in later, do they get a cut of earlier rewards?
contract RewardTimelineTest is Test {
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    string constant FACTORY_ARTIFACT =
        "tools/node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

    uint24 constant FEE = 10_000;
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    ArcLaunchpad launchpad;
    ArcSwapRouter router;
    MockUSDC usdc;
    LaunchToken token;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice"); // early buyer, later seller
    address bob = makeAddr("bob"); // early buyer, holds throughout
    address carol = makeAddr("carol"); // late joiner

    function setUp() public {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(code, 0x20), mload(code))
        }
        launchpad = new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, treasury, 5_000);
        router = new ArcSwapRouter(factoryAddr);

        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);
        usdc.mint(carol, 100_000e6);
        usdc.mint(address(this), 100_000e6);

        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Rewarder", "RWD", SUPPLY, "", true, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Rewarder",
                symbol: "RWD",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: true,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address who, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(who);
        usdc.approve(address(router), usdcIn);
        out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC_ADDR,
                tokenOut: address(token),
                fee: FEE,
                recipient: who,
                deadline: block.timestamp + 1,
                amountIn: usdcIn,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    function _sellAll(address who) internal {
        uint256 bal = token.balanceOf(who);
        vm.startPrank(who);
        IERC20(address(token)).approve(address(router), bal);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: who,
                deadline: block.timestamp + 1,
                amountIn: bal,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    /// @dev Distribute a known amount directly, so the numbers in the log are
    ///      round and the causation is unambiguous.
    function _distribute(uint256 amountUsdc) internal {
        usdc.transfer(address(token), amountUsdc);
        token.notifyRewards();
    }

    function _line(string memory who, address a) internal view {
        console2.log(
            string.concat("    ", who),
            string.concat(
                _fmtTokens(token.balanceOf(a)), " tokens   claimable $", _fmtUsd(token.pendingRewards(a))
            )
        );
    }

    function _fmtUsd(uint256 raw) internal pure returns (string memory) {
        return string.concat(vm.toString(raw / 1e6), ".", _pad(vm.toString((raw % 1e6) / 1e4)));
    }

    function _fmtTokens(uint256 raw) internal pure returns (string memory) {
        uint256 millions = raw / 1e18 / 1e6;
        return string.concat(vm.toString(millions), "M");
    }

    function _pad(string memory s) internal pure returns (string memory) {
        return bytes(s).length == 1 ? string.concat("0", s) : s;
    }

    function test_rewardTimeline() public {
        console2.log("");
        console2.log("=== 1. Alice and Bob buy in. Alice buys 3x more than Bob. ===");
        _buy(alice, 3_000e6);
        _buy(bob, 1_000e6);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);

        console2.log("");
        console2.log("=== 2. $100 of fees distributed ===");
        _distribute(100e6);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);
        console2.log("    -> split by size, NOT equally. Carol held none, earned none.");

        console2.log("");
        console2.log("=== 3. Carol buys in now (late joiner) ===");
        _buy(carol, 4_000e6);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);
        console2.log("    -> Carol starts at $0. She gets NO share of the earlier $100.");

        console2.log("");
        console2.log("=== 4. Another $100 distributed ===");
        _distribute(100e6);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);
        console2.log("    -> everyone earns from this one, by current size.");

        console2.log("");
        console2.log("=== 5. Alice sells her entire bag ===");
        uint256 aliceBanked = token.pendingRewards(alice);
        _sellAll(alice);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);
        console2.log("    -> Alice keeps everything she earned while holding.");
        assertEq(token.pendingRewards(alice), aliceBanked, "sale preserves accrued rewards");

        console2.log("");
        console2.log("=== 6. A final $100 distributed, after Alice is out ===");
        _distribute(100e6);
        _line("alice ", alice);
        _line("bob   ", bob);
        _line("carol ", carol);
        console2.log("    -> Alice earns nothing more. Bob and Carol split it.");
        assertEq(token.pendingRewards(alice), aliceBanked, "no earnings after exit");

        console2.log("");
        console2.log("=== 7. Alice claims her banked rewards anyway ===");
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 claimed = token.claimRewards();
        console2.log(string.concat("    alice claimed $", _fmtUsd(claimed), " in USDC after fully exiting"));
        assertEq(usdc.balanceOf(alice), before + claimed);
        assertEq(claimed, aliceBanked);
        console2.log("");
    }
}
