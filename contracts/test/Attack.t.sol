// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Adversarial tests. Every one of these is an attacker trying to take
///         money or control that is not theirs.
contract AttackTest is Test {
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

    address owner = address(this);
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address holder = makeAddr("holder");
    address attacker = makeAddr("ATTACKER");

    function setUp() public {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);
        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address f;
        assembly { f := create(0, add(code, 0x20), mload(code)) }
        launchpad = new ArcLaunchpad(USDC_ADDR, f, FEE, treasury, 5_000);
        router = new ArcSwapRouter(f);
        usdc.mint(holder, 500_000e6);
        usdc.mint(attacker, 500_000e6);
    }

    function _launch(bool rewards) internal returns (LaunchToken t) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Vic", "VIC", SUPPLY, "", rewards, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i); break;
            }
        }
        vm.prank(creator);
        (address a,) = launchpad.launch(ArcLaunchpad.LaunchParams({
            name: "Vic", symbol: "VIC", metadataURI: "", totalSupply: SUPPLY, salt: salt,
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, creatorAllocationBps: 1_000,
            rewardHolders: rewards, feeRecipient: address(0), buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
        }));
        t = LaunchToken(a);
    }

    function _buy(address who, address t, uint256 amt) internal returns (uint256) {
        vm.startPrank(who);
        usdc.approve(address(router), amt);
        uint256 o = router.exactInputSingle(ArcSwapRouter.ExactInputSingleParams({
            tokenIn: USDC_ADDR, tokenOut: t, fee: FEE, recipient: who,
            deadline: block.timestamp + 1, amountIn: amt, amountOutMinimum: 0
        }));
        vm.stopPrank();
        return o;
    }

    // ---------------- admin surface ----------------

    function test_attackerCannotChangeTreasury() public {
        vm.prank(attacker);
        vm.expectRevert();
        launchpad.setTreasury(attacker);
    }

    function test_attackerCannotChangeProtocolFee() public {
        vm.prank(attacker);
        vm.expectRevert();
        launchpad.setProtocolFeeBps(5_000);
    }

    function test_attackerCannotChangeLaunchFee() public {
        vm.prank(attacker);
        vm.expectRevert();
        launchpad.setLaunchFee(1);
    }

    function test_attackerCannotSeizeOwnership() public {
        vm.prank(attacker);
        vm.expectRevert();
        launchpad.transferOwnership(attacker);
    }

    /// @dev Ownable2Step: a pending owner must accept, so a fat-fingered
    ///      transfer to a dead address cannot brick the protocol.
    function test_ownershipTransferNeedsAcceptance() public {
        launchpad.transferOwnership(attacker);
        assertEq(launchpad.owner(), owner, "owner unchanged until accepted");
    }

    // ---------------- creator / recipient immutability ----------------

    function test_thereIsNoWayToChangeAnyLaunchsCreatorOrRecipient() public {
        LaunchToken t = _launch(false);
        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(t));
        assertEq(l.creator, creator);
        assertEq(l.feeRecipient, creator);

        // No setter exists anywhere in the source.
        string memory src = vm.readFile("src/ArcLaunchpad.sol");
        assertFalse(vm.contains(src, "function setCreator"), "no setCreator");
        assertFalse(vm.contains(src, "function setFeeRecipient"), "no setFeeRecipient");
        assertFalse(vm.contains(src, "l.creator ="), "creator never reassigned");

        // `feeRecipient` is assigned in exactly one place -- claimFeeRecipient --
        // and only for a launch that started with no recipient at all. This
        // launch has one, so no attestation can move it; that is asserted
        // behaviourally below and exhaustively in FeeRecipientClaim.t.sol.
        assertTrue(vm.contains(src, "function claimFeeRecipient"), "only claimFeeRecipient assigns it");

        // Even the owner cannot redirect a creator's fees.
        uint256 attackerBefore = usdc.balanceOf(attacker);
        _buy(holder, address(t), 20_000e6);
        launchpad.collectFees(address(t));
        assertGt(usdc.balanceOf(creator), 0, "fees went to the recorded creator");
        assertEq(usdc.balanceOf(attacker), attackerBefore, "attacker gained nothing");

        // The claim path cannot touch an ordinary launch, whoever calls it.
        launchpad.setAttestor(address(this));
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.NotUnclaimed.selector);
        launchpad.claimFeeRecipient(address(t), attacker, uint64(block.timestamp + 1 hours), hex"00");
    }

    function test_attackerCannotStealCreatorAllocation() public {
        LaunchToken t = _launch(false);
        vm.warp(block.timestamp + 30 minutes);

        // Anyone may trigger the release, but it can only pay the creator.
        vm.prank(attacker);
        launchpad.claimCreatorAllocation(address(t));

        assertEq(t.balanceOf(attacker), 0, "attacker received nothing");
        assertApproxEqRel(t.balanceOf(creator), SUPPLY / 10, 0.001e18, "creator received it");
    }

    // ---------------- callback surface ----------------

    function test_attackerCannotForgeMintCallbackToDrainTokens() public {
        LaunchToken t = _launch(false);
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.UnauthorizedCallback.selector);
        launchpad.uniswapV3MintCallback(1e18, 0, abi.encode(address(t), type(uint256).max));
    }

    function test_attackerCannotForgeSwapCallbackToDrainUsdc() public {
        LaunchToken t = _launch(false);
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.UnauthorizedCallback.selector);
        launchpad.uniswapV3SwapCallback(-1e18, 1e6, abi.encode(address(t)));
    }

    /// @dev The router pays from `payer` encoded in the callback data. A forged
    ///      call must not be able to name someone else as payer.
    function test_attackerCannotForgeRouterCallbackToSpendAnothersTokens() public {
        LaunchToken t = _launch(false);
        _buy(holder, address(t), 10_000e6);

        vm.prank(holder);
        IERC20(address(t)).approve(address(router), type(uint256).max);

        vm.prank(attacker);
        vm.expectRevert(ArcSwapRouter.InvalidCallback.selector);
        router.uniswapV3SwapCallback(1e18, -1e6, abi.encode(address(t), USDC_ADDR, FEE, holder));
    }

    // ---------------- registry surface ----------------

    function test_collectFeesOnAnUnknownTokenReverts() public {
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.NotALaunch.selector);
        launchpad.collectFees(address(0xdead));
    }

    function test_attackerCannotHijackAnotherCreatorsSalt() public {
        // Salts are namespaced by msg.sender, so the same salt yields a
        // different address for a different caller — no front-running a launch.
        address a1 = launchpad.predictTokenAddress(creator, "X", "X", SUPPLY, "", false, bytes32(uint256(7)));
        address a2 = launchpad.predictTokenAddress(attacker, "X", "X", SUPPLY, "", false, bytes32(uint256(7)));
        assertTrue(a1 != a2, "same salt, different creators, different addresses");
    }

    // ---------------- token surface ----------------

    function test_attackerCannotSetThePool() public {
        LaunchToken t = _launch(false);
        vm.prank(attacker);
        vm.expectRevert(LaunchToken.OnlyLaunchpad.selector);
        t.setPool(attacker);
    }

    function test_attackerCannotBurnSomeoneElsesTokens() public {
        LaunchToken t = _launch(false);
        uint256 got = _buy(holder, address(t), 5_000e6);

        // burn() only ever destroys the caller's own balance.
        vm.prank(attacker);
        vm.expectRevert();
        t.burn(got);

        assertEq(t.balanceOf(holder), got, "holder untouched");
    }

    function test_attackerCannotClaimAnotherHoldersRewards() public {
        LaunchToken t = _launch(true);
        _buy(holder, address(t), 20_000e6);
        launchpad.collectFees(address(t));

        uint256 owed = t.pendingRewards(holder);
        assertGt(owed, 0);

        vm.prank(attacker);
        vm.expectRevert(LaunchToken.NothingToClaim.selector);
        t.claimRewards();

        assertEq(t.pendingRewards(holder), owed, "holder's rewards intact");
    }

    /// @dev THE ONE TO WATCH: `notifyRewards` takes an amount parameter and is
    ///      permissionless. If it credits an amount that was never actually
    ///      transferred in, an attacker can inflate the reward accounting until
    ///      claims exceed the contract's balance — bricking payouts for everyone.
    function test_attackerCannotInflateRewardsWithoutPayingIn() public {
        LaunchToken t = _launch(true);
        _buy(holder, address(t), 20_000e6);
        launchpad.collectFees(address(t));

        uint256 realBalance = usdc.balanceOf(address(t));
        uint256 owedBefore = t.pendingRewards(holder);
        console2.log("USDC actually held by the token :", realBalance);
        console2.log("owed to holder before attack    :", owedBefore);

        // Attacker sends nothing, but claims a million dollars arrived.
        vm.prank(attacker);
        t.notifyRewards();

        uint256 owedAfter = t.pendingRewards(holder);
        console2.log("owed to holder after attack     :", owedAfter);
        console2.log("USDC still held                 :", usdc.balanceOf(address(t)));

        assertLe(owedAfter, usdc.balanceOf(address(t)), "claims must never exceed real balance");

        // And the holder must still be able to actually get paid.
        vm.prank(holder);
        t.claimRewards();
    }

    /// @dev The hardening must not break the legitimate case: anyone may still
    ///      top up holders by actually sending USDC and then notifying.
    function test_genuineTopUpStillCreditsHolders() public {
        LaunchToken t = _launch(true);
        _buy(holder, address(t), 20_000e6);
        launchpad.collectFees(address(t));

        uint256 before = t.pendingRewards(holder);

        // A real donation: transfer first, then notify.
        vm.startPrank(attacker);
        usdc.transfer(address(t), 500e6);
        t.notifyRewards();
        vm.stopPrank();

        uint256 gained = t.pendingRewards(holder) - before;
        console2.log("holder gained from a real $500 top-up:", gained);
        assertApproxEqRel(gained, 500e6, 0.01e18, "the full donation reached holders");

        vm.prank(holder);
        uint256 claimed = t.claimRewards();
        assertGt(claimed, 500e6, "and it is genuinely withdrawable");
    }
}
