// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";
import {TsukiV4Pool} from "../src/TsukiV4Pool.sol";

/// @notice Adversarial tests. Every one of these is an attacker trying to take
///         money or control that is not theirs.
contract AttackTest is TsukiTestBase {

    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;


    address owner = address(this);
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address holder = makeAddr("holder");
    address attacker = makeAddr("ATTACKER");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);
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
                referrer: address(0),
                creatorTaxBps: 0
        }));
        t = LaunchToken(a);
    }

    function _buy(address who, address t, uint256 amt) internal returns (uint256) {
        return _poolBuy(who, t, amt);
    }

    // ---------------- admin surface ----------------

    /// @dev These used to assert that an attacker could not reach the setters.
    ///      There are no setters: the contract has no owner and every
    ///      configurable value is `immutable`. What is worth asserting now is
    ///      that the terms a creator launched under cannot move for anybody,
    ///      which is a stronger statement than "only the owner may move them".
    function test_configurationCannotBeChangedByAnyone() public view {
        assertEq(launchpad.treasury(), treasury, "treasury fixed at deployment");
        assertEq(launchpad.protocolFeeBps(), 5_000, "fee split fixed at deployment");
        assertEq(launchpad.launchFee(), 0, "launch fee fixed at deployment");
        assertEq(launchpad.attestor(), address(this), "attestor fixed at deployment");
    }

    /// @dev There is no ownership to transfer or seize. The contract was
    ///      deployed without an owner rather than renounced afterwards, so
    ///      there is no window in which one existed and no key that could ever
    ///      have been stolen. Absence of a function cannot be asserted from
    ///      Solidity, so this pins the guarantee to the two things that would
    ///      have been reachable through it.
    function test_thereIsNoOwnerToSeize() public view {
        assertEq(launchpad.treasury(), treasury, "treasury unreachable");
        assertEq(launchpad.protocolFeeBps(), 5_000, "split unreachable");
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

        // The claim path cannot touch an ordinary launch, whoever calls it --
        // this launchpad's attestor is address(this), set at construction.
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.NotUnclaimed.selector);
        launchpad.claimFeeRecipient(address(t), attacker, uint64(block.timestamp + 1 hours), hex"00");
    }

    // ---------------- callback surface ----------------

    /// @dev v4 replaces the two v3 callbacks with a single unlock callback, so
    ///      this is the whole forgeable surface the pad now exposes.
    function test_attackerCannotForgeUnlockCallbackToDrainThePad() public {
        LaunchToken t = _launch(false);
        vm.prank(attacker);
        vm.expectRevert(TsukiV4Pool.NotPoolManager.selector);
        launchpad.unlockCallback(abi.encode(uint8(0), _poolKey(address(t)), int24(0), int24(0), uint256(1e18)));
    }

    /// @dev The pads swap through `swapForSelf`, which only they may call --
    ///      otherwise anyone could spend a pad's balance at a price of their
    ///      choosing and keep the proceeds.
    function test_attackerCannotMakeThePadSwapForThem() public {
        LaunchToken t = _launch(false);
        vm.prank(attacker);
        vm.expectRevert(TsukiV4Pool.NotSelf.selector);
        launchpad.swapForSelf(_poolKey(address(t)), true, 1e18);
    }

    /// @dev The router pays from `payer` encoded in the callback data. A forged
    ///      call must not be able to name someone else as payer.
    function test_attackerCannotForgeRouterCallbackToSpendAnothersTokens() public {
        LaunchToken t = _launch(false);
        _buy(holder, address(t), 10_000e6);

        vm.prank(holder);
        IERC20(address(t)).approve(address(router), type(uint256).max);

        // v4 hands the unlock callback only to the address that asked for it.
        // An attacker calling it directly is refused before any allowance of
        // the holder's could be reached.
        vm.prank(attacker);
        vm.expectRevert(TsukiRouter.NotPoolManager.selector);
        router.unlockCallback(
            abi.encode(
                TsukiRouter.ExactInputSingleParams({
                    key: _poolKey(address(t)),
                    zeroForOne: true,
                    amountIn: 1e18,
                    amountOutMinimum: 0,
                    recipient: attacker,
                    deadline: block.timestamp + 1
                }),
                holder
            )
        );
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

        // The creator's allocation is delivered at launch, so the creator is a
        // holder too and takes their pro-rata share of any top-up.
        uint256 holderBefore = t.pendingRewards(holder);
        uint256 creatorBefore = t.pendingRewards(creator);

        // A real donation: transfer first, then notify.
        vm.startPrank(attacker);
        usdc.transfer(address(t), 500e6);
        t.notifyRewards();
        vm.stopPrank();

        uint256 holderGained = t.pendingRewards(holder) - holderBefore;
        uint256 creatorGained = t.pendingRewards(creator) - creatorBefore;
        console2.log("holder gained from a real $500 top-up: ", holderGained);
        console2.log("creator gained from a real $500 top-up:", creatorGained);
        assertApproxEqRel(holderGained + creatorGained, 500e6, 0.01e18, "the full donation reached holders");
        assertApproxEqRel(
            holderGained * t.balanceOf(creator), creatorGained * t.balanceOf(holder), 0.01e18, "split by holdings"
        );

        uint256 owed = t.pendingRewards(holder);
        vm.prank(holder);
        uint256 claimed = t.claimRewards();
        assertEq(claimed, owed, "and it is genuinely withdrawable");
        assertGt(claimed, holderGained, "donation included");
    }
}
