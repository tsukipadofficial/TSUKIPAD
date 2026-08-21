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
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
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

    /// @dev Holder rewards take precedence over a redirect, the same way
    ///      buy-and-burn does. Both are USDC destinations, and fees are now all
    ///      USDC -- the token side is sold before anything is split -- so there
    ///      is nothing left over for a recipient to receive. The two are already
    ///      mutually exclusive in the create form; this pins the contract-level
    ///      behaviour so the UI cannot drift away from it silently.
    function test_holderRewardsTakePrecedenceOverARedirect() public {
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

        assertGt(token.totalRewardsReceived(), 0, "holders got every USDC of it");
        assertEq(token.balanceOf(goodCause), 0, "cause got no tokens: the token side was converted");
        assertEq(usdc.balanceOf(goodCause), 0, "cause got no USDC either: holder rewards win");
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

    /// @dev Fees arrive on both sides of the pool -- buyers pay theirs in USDC,
    ///      sellers pay theirs in the token -- and everything is paid out in USDC.
    function test_everyPayoutIsUsdcEvenWhenSellersPaidInToken() public {
        LaunchToken token = _launch(goodCause, false);

        uint256 bought = _buy(alice, address(token), 10_000e6);

        // Selling is what produces token-denominated fees.
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

        console2.log("cause USDC (6dp): ", usdc.balanceOf(goodCause));
        console2.log("treasury USDC:    ", usdc.balanceOf(treasury));

        assertGt(usdc.balanceOf(goodCause), 0, "recipient paid in USDC");
        assertGt(usdc.balanceOf(treasury), 0, "treasury paid in USDC");
        assertEq(token.balanceOf(goodCause), 0, "recipient holds none of the token");
        assertEq(token.balanceOf(treasury), 0, "treasury holds none of the token");
    }

    /// @dev The launchpad custodies creator allocations awaiting unlock, so a fee
    ///      swap must sell only what this collection produced. Selling a balance
    ///      lookup instead would quietly spend somebody else's locked allocation.
    function test_feeSwapNeverTouchesALockedCreatorAllocation() public {
        // A launch that withholds 10% of supply for its creator.
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Held", "HELD", SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address held,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Held",
                symbol: "HELD",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 1_000,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
            })
        );

        uint256 owedToCreator = launchpad.launchOf(held).creatorAllocation;
        assertGt(owedToCreator, 0, "allocation is being custodied");
        assertEq(IERC20(held).balanceOf(address(launchpad)), owedToCreator, "held exactly");

        // Churn a *different* launch enough to trigger a fee swap.
        LaunchToken other = _launch(goodCause, false);
        uint256 bought = _buy(alice, address(other), 10_000e6);
        vm.startPrank(alice);
        IERC20(address(other)).approve(address(router), bought);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: address(other),
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: bought,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
        launchpad.collectFees(address(other));

        assertEq(
            IERC20(held).balanceOf(address(launchpad)),
            owedToCreator,
            "the other launch's allocation is untouched"
        );

        // Compare the delta: the creator also received mint dust at launch, so
        // their balance was never just the allocation.
        uint256 before = IERC20(held).balanceOf(creator);
        vm.warp(block.timestamp + 31 minutes);
        launchpad.claimCreatorAllocation(held);
        assertEq(
            IERC20(held).balanceOf(creator) - before, owedToCreator, "creator still receives all of it"
        );
    }
}
