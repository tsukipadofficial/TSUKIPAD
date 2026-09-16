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
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice A launch may earmark its fees for someone who has no wallet yet.
///         Fees are held until an attestation binds an address to the identity.
///         These tests are mostly about what must *not* work.
contract FeeRecipientClaimTest is TsukiTestBase {

    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;


    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");
    address maintainer = makeAddr("maintainer");

    uint256 attestorKey = 0xA11CE;
    address attestor;

    /// Stands in for keccak("x:someproject") -- the identity the fees are for.
    bytes32 constant COMMITMENT = keccak256("x:someproject");

    function setUp() public {
        attestor = vm.addr(attestorKey);
        StackConfig memory cfg = _defaultConfig(treasury, attestor);
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);

        usdc.mint(alice, 500_000e6);
    }

    function _launch(bytes32 commitment) internal returns (LaunchToken token) {
        return _launch(commitment, "Fund", "FUND");
    }

    /// Distinct name/symbol per launch: the token address is CREATE2-derived
    /// from them, so two identical launches would collide on the same address.
    function _launch(bytes32 commitment, string memory name, string memory symbol)
        internal
        returns (LaunchToken token)
    {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, name, symbol, SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: name,
                symbol: symbol,
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: commitment,
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address who, address token, uint256 usdcIn) internal {
        vm.startPrank(who);
        usdc.approve(address(router), usdcIn);
        router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: false,
                amountIn: usdcIn,
                amountOutMinimum: 0,
                recipient: who,
                deadline: block.timestamp + 1
            })
        );
        vm.stopPrank();
    }

    function _sign(uint256 key, address token, address recipient, bytes32 commitment, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(launchpad), token, recipient, commitment, deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------- the happy path ----------------

    function test_feesAreHeldThenPaidOutOnClaim() public {
        LaunchToken token = _launch(COMMITMENT);
        assertEq(launchpad.launchOf(address(token)).feeRecipient, address(0), "unclaimed at launch");

        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        assertGt(launchpad.escrowUsdc(address(token)), 0, "usdc held in escrow");
        assertEq(usdc.balanceOf(creator), 0, "creator got nothing");
        assertEq(usdc.balanceOf(maintainer), 0, "nobody got it yet");
        console2.log("escrowed USDC (6dp):", launchpad.escrowUsdc(address(token)));

        uint64 deadline = uint64(block.timestamp + 1 hours);
        launchpad.claimFeeRecipient(
            address(token), maintainer, deadline, _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline)
        );

        assertEq(launchpad.launchOf(address(token)).feeRecipient, maintainer, "bound");
        assertEq(launchpad.escrowUsdc(address(token)), 0, "escrow drained");
        assertGt(usdc.balanceOf(maintainer), 0, "maintainer paid");
        assertEq(usdc.balanceOf(creator), 0, "creator still got nothing");
    }

    function test_feesFlowDirectlyAfterClaim() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        launchpad.claimFeeRecipient(
            address(token), maintainer, deadline, _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline)
        );

        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        assertGt(usdc.balanceOf(maintainer), 0, "paid without a second claim");
        assertEq(launchpad.escrowUsdc(address(token)), 0, "nothing escrowed once bound");
    }

    // ---------------- what must not work ----------------

    function test_attackerCannotClaimWithoutAnAttestation() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);

        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.BadAttestation.selector);
        launchpad.claimFeeRecipient(
            address(token), attacker, deadline, _sign(0xBAD, address(token), attacker, COMMITMENT, deadline)
        );
    }

    function test_attestationForOneRecipientCannotBeUsedByAnother() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline);

        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.BadAttestation.selector);
        launchpad.claimFeeRecipient(address(token), attacker, deadline, sig);
    }

    function test_attestationForOneLaunchCannotBeUsedOnAnother() public {
        LaunchToken a = _launch(COMMITMENT, "Fund A", "FUNDA");
        LaunchToken b = _launch(COMMITMENT, "Fund B", "FUNDB");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(attestorKey, address(a), maintainer, COMMITMENT, deadline);

        vm.expectRevert(ArcLaunchpad.BadAttestation.selector);
        launchpad.claimFeeRecipient(address(b), maintainer, deadline, sig);
    }

    function test_claimCannotHappenTwice() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        launchpad.claimFeeRecipient(
            address(token), maintainer, deadline, _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline)
        );

        // Even a valid fresh attestation cannot move an already-bound launch.
        vm.expectRevert(ArcLaunchpad.NotUnclaimed.selector);
        launchpad.claimFeeRecipient(
            address(token), attacker, deadline, _sign(attestorKey, address(token), attacker, COMMITMENT, deadline)
        );
    }

    function test_anOrdinaryLaunchCanNeverBeClaimed() public {
        LaunchToken token = _launch(bytes32(0));
        assertEq(launchpad.launchOf(address(token)).feeRecipient, creator, "creator is recipient");

        uint64 deadline = uint64(block.timestamp + 1 hours);
        vm.expectRevert(ArcLaunchpad.NotUnclaimed.selector);
        launchpad.claimFeeRecipient(
            address(token), attacker, deadline, _sign(attestorKey, address(token), attacker, bytes32(0), deadline)
        );
    }

    function test_expiredAttestationIsRejected() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline);

        vm.warp(vm.getBlockTimestamp() + 2 hours);
        vm.expectRevert(ArcLaunchpad.AttestationExpired.selector);
        launchpad.claimFeeRecipient(address(token), maintainer, deadline, sig);
    }

    function test_ownerCannotTakeEscrowBeforeThePeriodElapses() public {
        LaunchToken token = _launch(COMMITMENT);
        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        vm.expectRevert(ArcLaunchpad.StillClaimable.selector);
        launchpad.sweepUnclaimedFees(address(token));
    }

    function test_sweepPaysTreasuryAndLeavesTheLaunchClaimable() public {
        LaunchToken token = _launch(COMMITMENT);
        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        uint256 creatorBefore = usdc.balanceOf(creator);
        vm.warp(vm.getBlockTimestamp() + 366 days);
        launchpad.sweepUnclaimedFees(address(token));

        assertGt(usdc.balanceOf(treasury), 0, "treasury swept it");
        assertEq(usdc.balanceOf(creator), creatorBefore, "creator gained nothing by waiting");

        // A recipient turning up late still gets everything earned from now on.
        uint64 deadline = uint64(block.timestamp + 1 hours);
        launchpad.claimFeeRecipient(
            address(token), maintainer, deadline, _sign(attestorKey, address(token), maintainer, COMMITMENT, deadline)
        );
        assertEq(launchpad.launchOf(address(token)).feeRecipient, maintainer, "still claimable after a sweep");
    }

    /// @dev The sweep is permissionless now that the contract has no owner, so
    ///      the guarantee moved from "only the owner may call it" to "it does
    ///      not matter who calls it". The destination is hard-coded to the
    ///      treasury, so an attacker calling it can only pay the gas to send
    ///      the protocol its own money.
    function test_anyoneMaySweepButOnlyTheTreasuryIsPaid() public {
        LaunchToken token = _launch(COMMITMENT);
        _buy(alice, address(token), 40_000e6);
        launchpad.collectFees(address(token));

        uint256 escrowed = launchpad.escrowUsdc(address(token));
        assertGt(escrowed, 0, "fees are sitting in escrow");
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 attackerBefore = usdc.balanceOf(attacker);

        vm.warp(vm.getBlockTimestamp() + 366 days);
        vm.prank(attacker);
        launchpad.sweepUnclaimedFees(address(token));

        assertEq(usdc.balanceOf(attacker), attackerBefore, "the caller gains nothing");
        assertEq(usdc.balanceOf(treasury), treasuryBefore + escrowed, "the treasury is paid");
        assertEq(launchpad.escrowUsdc(address(token)), 0, "escrow drained");
    }

    /// @dev Permissionless does not mean unguarded: the age gate still holds
    ///      for every caller, so a live earmark cannot be swept out from under
    ///      the account it belongs to.
    function test_sweepStillRevertsBeforeTheDeadline() public {
        LaunchToken token = _launch(COMMITMENT);
        vm.prank(attacker);
        vm.expectRevert(ArcLaunchpad.StillClaimable.selector);
        launchpad.sweepUnclaimedFees(address(token));
    }

    function test_creatorCannotBindThemselvesWithoutTheAttestor() public {
        LaunchToken token = _launch(COMMITMENT);
        uint64 deadline = uint64(block.timestamp + 1 hours);

        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.BadAttestation.selector);
        launchpad.claimFeeRecipient(
            address(token), creator, deadline, _sign(0xC12EA704, address(token), creator, COMMITMENT, deadline)
        );
    }
}
