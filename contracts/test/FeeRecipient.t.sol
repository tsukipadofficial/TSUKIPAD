// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Tests for redirecting the creator fee share to a third party — a
///         project, charity or public good rather than the launcher's wallet.
contract FeeRecipientTest is Test {
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

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address goodCause = makeAddr("goodCause");
    address alice = makeAddr("alice");

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

        usdc.mint(alice, 500_000e6);
    }

    function _launch(address feeRecipient, bool rewardHolders) internal returns (LaunchToken token) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (
                launchpad.predictTokenAddress(creator, "Fund", "FUND", SUPPLY, "", rewardHolders, bytes32(i))
                    < USDC_ADDR
            ) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Fund",
                symbol: "FUND",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: rewardHolders,
                feeRecipient: feeRecipient,
                buybackAndBurn: false
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address who, address token, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(who);
        usdc.approve(address(router), usdcIn);
        out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC_ADDR,
                tokenOut: token,
                fee: FEE,
                recipient: who,
                deadline: block.timestamp + 1,
                amountIn: usdcIn,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    function test_feesGoToTheNominatedAddressNotTheCreator() public {
        LaunchToken token = _launch(goodCause, false);

        assertEq(launchpad.launchOf(address(token)).feeRecipient, goodCause, "recipient recorded");
        assertEq(launchpad.launchOf(address(token)).creator, creator, "creator still recorded separately");

        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        uint256 causeUsdc = usdc.balanceOf(goodCause);
        console2.log("good cause received (USDC 6dp):", causeUsdc);

        assertGt(causeUsdc, 0, "cause was funded");
        assertEq(usdc.balanceOf(creator), 0, "creator received nothing");
    }

    function test_zeroAddressDefaultsToCreator() public {
        LaunchToken token = _launch(address(0), false);

        assertEq(launchpad.launchOf(address(token)).feeRecipient, creator, "defaults to creator");

        _buy(alice, address(token), 10_000e6);
        launchpad.collectFees(address(token));

        assertGt(usdc.balanceOf(creator), 0, "creator paid as usual");
    }

    /// @dev A launch can both fund a project and reward holders: USDC goes to
    ///      holders, and the token-side fees go to the nominated recipient.
    function test_redirectCombinesWithHolderRewards() public {
        LaunchToken token = _launch(goodCause, true);

        // The creator keeps only the rounding dust from the liquidity mint.
        uint256 creatorDust = token.balanceOf(creator);

        uint256 bought = _buy(alice, address(token), 10_000e6);

        // Sell to generate token-denominated fees as well.
        vm.startPrank(alice);
        IERC20(address(token)).approve(address(router), bought);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: bought,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();

        launchpad.collectFees(address(token));

        assertGt(token.totalRewardsReceived(), 0, "holders got the USDC");
        assertGt(token.balanceOf(goodCause), 0, "cause got the token-side fees");
        assertEq(usdc.balanceOf(creator), 0, "creator got no USDC");
        assertEq(token.balanceOf(creator), creatorDust, "creator got no token fees, only pre-existing dust");
    }

    function test_recipientIsImmutableAfterLaunch() public {
        LaunchToken token = _launch(goodCause, false);

        // There is no setter for it anywhere on the launchpad.
        string memory src = vm.readFile("src/ArcLaunchpad.sol");
        assertFalse(vm.contains(src, "function setFeeRecipient"), "no way to change it");

        // And the recorded value cannot drift.
        assertEq(launchpad.launchOf(address(token)).feeRecipient, goodCause);
    }
}
