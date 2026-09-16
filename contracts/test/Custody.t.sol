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
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice The launchpad custodies two different things denominated in the
///         same tokens: liquidity principal (in the pool) and escrow for
///         launches nobody has claimed yet. Creator allocations are not among
///         them -- they leave in the launch transaction. Fee handling moves
///         money constantly and must never reach either.
///
///         These tests exist because that separation is invisible in normal use
///         -- it only breaks when several launches are in different states at
///         once, which is exactly what production looks like and tests usually
///         do not.
contract CustodyTest is TsukiTestBase {
    using StateLibrary for IPoolManager;


    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;


    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address maintainer = makeAddr("maintainer");

    uint256 attestorKey = 0xA11CE;
    bytes32 constant COMMITMENT = keccak256("x:someproject");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, vm.addr(attestorKey));
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);

        usdc.mint(alice, 2_000_000e6);
    }

    function _launch(string memory name, string memory sym, uint256 devBuyUsdc, bytes32 commitment)
        internal
        returns (LaunchToken token)
    {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, name, sym, SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        if (devBuyUsdc > 0) {
            usdc.mint(creator, devBuyUsdc);
            vm.prank(creator);
            usdc.approve(address(launchpad), devBuyUsdc);
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: name,
                symbol: sym,
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: devBuyUsdc,
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

    function _buy(address token, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(alice);
        usdc.approve(address(router), usdcIn);
        out = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: false,
                amountIn: usdcIn,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp + 1
            })
        );
        vm.stopPrank();
    }

    function _sell(address token, uint256 tokensIn) internal {
        vm.startPrank(alice);
        IERC20(token).approve(address(router), tokensIn);
        router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: true,
                amountIn: tokensIn,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp + 1
            })
        );
        vm.stopPrank();
    }

    /// Buy then sell, so fees accrue on both sides of the pool.
    function _churn(address token, uint256 usdcIn) internal {
        _sell(token, _buy(token, usdcIn));
    }

    /// @dev Put tokens in escrow for an earmarked, unclaimed launch. Sells too
    ///      small to be worth converting (below MIN_FEE_SWAP) leave the token
    ///      side in kind, and the creator's share of that is escrowed rather
    ///      than sold -- so this is the one state in which the launchpad holds a
    ///      launch's own token on someone else's behalf.
    function _escrowTokenFees(LaunchToken token) internal returns (uint256 escrowed) {
        _buy(address(token), 5_000e6);
        for (uint256 i = 0; i < 4; i++) {
            _sell(address(token), 0.05 ether); // 1% fee = 0.0005 token, under the swap threshold
            launchpad.collectFees(address(token));
        }
        escrowed = launchpad.escrowToken(address(token));
        assertGt(escrowed, 0, "token fees are in escrow");
        assertEq(IERC20(address(token)).balanceOf(address(launchpad)), escrowed, "held exactly");
    }

    function _claim(LaunchToken token, address recipient) internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(launchpad), address(token), recipient, COMMITMENT, deadline))
        );
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(attestorKey, digest);
        launchpad.claimFeeRecipient(address(token), recipient, deadline, abi.encodePacked(r, sg, v));
    }

    function _positionLiquidity(LaunchToken token) internal view returns (uint128 liq) {
        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(token));
        (liq,,) = IPoolManager(address(manager)).getPositionInfo(
            _poolId(address(token)), address(launchpad), l.tickLower, l.tickUpper, bytes32(0)
        );
    }

    /// @dev The core solvency property: for every launch, the launchpad holds at
    ///      least what it owes in that launch's token -- its escrowed token
    ///      fees -- no matter what fee activity has happened.
    function _assertSolvent(LaunchToken token, string memory when) internal view {
        uint256 owed = launchpad.escrowToken(address(token));
        assertGe(IERC20(address(token)).balanceOf(address(launchpad)), owed, when);
    }

    // ------------------------------------------------------------------

    function test_escrowedTokensAreUntouchedByFeeActivityAnywhere() public {
        LaunchToken held = _launch("Held", "HELD", 1_000e6, COMMITMENT);
        LaunchToken busy = _launch("Busy", "BUSY", 1_000e6, bytes32(0));

        uint256 owed = _escrowTokenFees(held);
        _assertSolvent(held, "solvent once escrow accrues");

        // Hammer a different launch: buys, sells, and repeated fee collections,
        // each of which swaps token fees back through that launch's pool.
        for (uint256 i = 0; i < 3; i++) {
            _churn(address(busy), 25_000e6);
            launchpad.collectFees(address(busy));
            _assertSolvent(held, "solvent while another launch churns");
        }

        assertEq(IERC20(address(held)).balanceOf(address(launchpad)), owed, "escrow exactly preserved");
        assertEq(launchpad.escrowToken(address(held)), owed, "and still owed in full");
        assertEq(IERC20(address(busy)).balanceOf(address(launchpad)), 0, "the busy launch keeps nothing back");
    }

    function test_escrowOfOneLaunchIsNotSpendableByAnother() public {
        LaunchToken a = _launch("Earmark A", "EMA", 0, COMMITMENT);
        LaunchToken b = _launch("Earmark B", "EMB", 0, COMMITMENT);

        _churn(address(a), 40_000e6);
        _churn(address(b), 40_000e6);
        launchpad.collectFees(address(a));
        launchpad.collectFees(address(b));

        uint256 escrowA = launchpad.escrowUsdc(address(a));
        uint256 escrowB = launchpad.escrowUsdc(address(b));
        assertGt(escrowA, 0, "a accrued");
        assertGt(escrowB, 0, "b accrued");
        console2.log("escrow A (USDC 6dp):", escrowA);
        console2.log("escrow B (USDC 6dp):", escrowB);

        // Claiming A must pay exactly A's escrow and leave B's alone.
        _claim(a, maintainer);

        assertEq(usdc.balanceOf(maintainer), escrowA, "paid exactly A's escrow");
        assertEq(launchpad.escrowUsdc(address(b)), escrowB, "B's escrow untouched");
        assertGe(usdc.balanceOf(address(launchpad)), escrowB, "still solvent for B");
    }

    function test_liquidityPrincipalNeverShrinks() public {
        LaunchToken token = _launch("Locked", "LOCK", 0, bytes32(0));
        uint128 atLaunch = _positionLiquidity(token);
        assertGt(atLaunch, 0, "position exists");

        for (uint256 i = 0; i < 3; i++) {
            _churn(address(token), 50_000e6);
            launchpad.collectFees(address(token));
            assertEq(_positionLiquidity(token), atLaunch, "principal unchanged by fee collection");
        }

        // Fees are credited with a zero-liquidity `modifyLiquidity`, and no
        // call anywhere in the stack passes a negative delta, so there is no
        // code path that withdraws principal.
        string memory src = vm.readFile("src/TsukiV4Pool.sol");
        assertTrue(vm.contains(src, "liquidityDelta: 0"), "fees credited with a zero-liquidity call");
        assertFalse(vm.contains(src, "liquidityDelta: -"), "nothing withdraws principal");
    }

    function test_feesAreNotDrawnFromCustodiedBalances() public {
        // An earmarked launch holding token escrow, then churned hard.
        LaunchToken token = _launch("Both", "BOTH", 1_500e6, COMMITMENT);
        _escrowTokenFees(token);

        for (uint256 i = 0; i < 3; i++) {
            _churn(address(token), 30_000e6);
            launchpad.collectFees(address(token));
            _assertSolvent(token, "solvent through its own fee churn");
        }

        assertGt(launchpad.escrowUsdc(address(token)), 0, "USDC escrow accrued too");
        assertGe(usdc.balanceOf(address(launchpad)), launchpad.escrowUsdc(address(token)), "USDC escrow fully backed");
    }

    /// @dev The sharpest case, and the one worth stating plainly: tokens held in
    ///      escrow for a launch are the very token that launch's fee collection
    ///      sells. Paying fees in USDC means swapping that token back through
    ///      its own pool, while the launchpad holds a balance of it that belongs
    ///      to someone else.
    ///
    ///      The two must not touch. The swap sells only what this collection
    ///      produced; the escrowed tokens are the recipient's and stay whole
    ///      until they claim.
    function test_escrowStaysWholeWhileItsOwnTokenIsSold() public {
        LaunchToken token = _launch("Escrow Earner", "EERN", 1_000e6, COMMITMENT);
        uint256 escrowed = _escrowTokenFees(token);

        // Trade hard, then collect. Collection sells this launch's token fees.
        for (uint256 i = 0; i < 3; i++) {
            _churn(address(token), 40_000e6);
            launchpad.collectFees(address(token));

            assertEq(
                IERC20(address(token)).balanceOf(address(launchpad)),
                escrowed,
                "escrowed tokens are exactly as they were, mid-flight"
            );
        }

        console2.log("USDC escrow from fees (6dp):", launchpad.escrowUsdc(address(token)));
        console2.log("tokens still in escrow:     ", escrowed);

        assertEq(
            launchpad.escrowToken(address(token)),
            escrowed,
            "no new token escrow: the fee side was sold, never held in kind"
        );

        // The claim then pays out in full, untouched by any of it.
        _claim(token, maintainer);
        assertEq(IERC20(address(token)).balanceOf(maintainer), escrowed, "recipient receives every escrowed token");
        assertEq(IERC20(address(token)).balanceOf(address(launchpad)), 0, "nothing of theirs left behind");
    }
}
