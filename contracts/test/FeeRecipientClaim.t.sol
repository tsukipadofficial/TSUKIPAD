// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice A launch may earmark its fees for someone who has no wallet yet.
///         Fees are held until an attestation binds an address to the identity.
///         These tests are mostly about what must *not* work.
contract FeeRecipientClaimTest is Test {
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
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");
    address maintainer = makeAddr("maintainer");

    uint256 attestorKey = 0xA11CE;
    address attestor;

    /// Stands in for keccak("x:someproject") -- the identity the fees are for.
    bytes32 constant COMMITMENT = keccak256("x:someproject");

    function setUp() public {
        attestor = vm.addr(attestorKey);

        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(code, 0x20), mload(code))
        }
        launchpad = new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, treasury, 5_000);
        router = new ArcSwapRouter(factoryAddr);
        launchpad.setAttestor(attestor);

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
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: commitment
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address who, address token, uint256 usdcIn) internal {
        vm.startPrank(who);
        usdc.approve(address(router), usdcIn);
        router.exactInputSingle(
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

        vm.warp(block.timestamp + 2 hours);
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
        vm.warp(block.timestamp + 366 days);
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

    function test_nonOwnerCannotSweep() public {
        LaunchToken token = _launch(COMMITMENT);
        vm.warp(block.timestamp + 366 days);
        vm.prank(attacker);
        vm.expectRevert();
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
