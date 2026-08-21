// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice The launchpad custodies three different things denominated in the
///         same tokens: liquidity principal (in the pool), creator allocations
///         awaiting unlock, and escrow for launches nobody has claimed yet. Fee
///         handling moves money constantly and must never reach any of them.
///
///         These tests exist because that separation is invisible in normal use
///         -- it only breaks when several launches are in different states at
///         once, which is exactly what production looks like and tests usually
///         do not.
contract CustodyTest is Test {
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
    address maintainer = makeAddr("maintainer");

    uint256 attestorKey = 0xA11CE;
    bytes32 constant COMMITMENT = keccak256("x:someproject");

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
        launchpad.setAttestor(vm.addr(attestorKey));

        usdc.mint(alice, 2_000_000e6);
    }

    function _launch(string memory name, string memory sym, uint16 allocBps, bytes32 commitment)
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
                creatorAllocationBps: allocBps,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: commitment
            })
        );
        token = LaunchToken(t);
    }

    /// Buy then sell, so fees accrue on both sides of the pool.
    function _churn(address token, uint256 usdcIn) internal {
        vm.startPrank(alice);
        usdc.approve(address(router), usdcIn);
        uint256 out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC_ADDR,
                tokenOut: token,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: usdcIn,
                amountOutMinimum: 0
            })
        );
        IERC20(token).approve(address(router), out);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: out,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    function _positionLiquidity(LaunchToken token) internal view returns (uint128 liq) {
        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(token));
        bytes32 key = keccak256(abi.encodePacked(address(launchpad), l.tickLower, l.tickUpper));
        (liq,,,,) = IUniswapV3Pool(l.pool).positions(key);
    }

    /// @dev The core solvency property: for every launch, the launchpad holds at
    ///      least what it owes -- the creator's unclaimed allocation plus any
    ///      escrowed token fees -- no matter what fee activity has happened.
    function _assertSolvent(LaunchToken token, string memory when) internal view {
        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(token));
        uint256 owed = (l.allocationClaimed ? 0 : l.creatorAllocation) + launchpad.escrowToken(address(token));
        assertGe(IERC20(address(token)).balanceOf(address(launchpad)), owed, when);
    }

    // ------------------------------------------------------------------

    function test_lockedAllocationIsUntouchedByFeeActivityAnywhere() public {
        LaunchToken held = _launch("Held", "HELD", 1_000, bytes32(0)); // 10% withheld
        LaunchToken busy = _launch("Busy", "BUSY", 0, bytes32(0));

        uint256 owed = launchpad.launchOf(address(held)).creatorAllocation;
        assertGt(owed, 0, "an allocation is being custodied");
        _assertSolvent(held, "solvent at launch");

        // Hammer a different launch: buys, sells, and repeated fee collections,
        // each of which now swaps token fees back through that launch's pool.
        for (uint256 i = 0; i < 3; i++) {
            _churn(address(busy), 25_000e6);
            launchpad.collectFees(address(busy));
            _assertSolvent(held, "solvent while another launch churns");
        }

        assertEq(IERC20(address(held)).balanceOf(address(launchpad)), owed, "allocation exactly preserved");

        uint256 before = IERC20(address(held)).balanceOf(creator);
        vm.warp(block.timestamp + 31 minutes);
        launchpad.claimCreatorAllocation(address(held));
        assertEq(IERC20(address(held)).balanceOf(creator) - before, owed, "creator receives all of it");
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
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(launchpad), address(a), maintainer, COMMITMENT, deadline))
        );
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(attestorKey, digest);
        launchpad.claimFeeRecipient(address(a), maintainer, deadline, abi.encodePacked(r, sg, v));

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

        // burn() is only ever called with zero liquidity -- the Uniswap idiom for
        // crediting fees -- so there is no code path that withdraws principal.
        string memory src = vm.readFile("src/ArcLaunchpad.sol");
        assertTrue(vm.contains(src, "p.burn(l.tickLower, l.tickUpper, 0)"), "poke only");
    }

    function test_feesAreNotDrawnFromCustodiedBalances() public {
        // A launch with both a locked allocation and an earmark, churned hard.
        LaunchToken token = _launch("Both", "BOTH", 1_500, COMMITMENT);
        uint256 alloc = launchpad.launchOf(address(token)).creatorAllocation;

        for (uint256 i = 0; i < 3; i++) {
            _churn(address(token), 30_000e6);
            launchpad.collectFees(address(token));
            _assertSolvent(token, "solvent through its own fee churn");
        }

        assertGe(
            IERC20(address(token)).balanceOf(address(launchpad)),
            alloc + launchpad.escrowToken(address(token)),
            "allocation plus escrow still fully backed"
        );
    }

    /// @dev The sharpest case, and the one worth stating plainly: a creator with
    ///      tokens still locked earns fees on the same launch. Those fees are
    ///      paid in USDC, and paying them involves selling that very token --
    ///      the same token the launchpad is holding on that creator's behalf.
    ///
    ///      The two must not touch. The USDC owed to the creator comes from fees
    ///      the pool accrued; the tokens held for the creator are theirs and stay
    ///      whole until the lock expires.
    function test_creatorEarnsUsdcWhileTheirOwnTokensStayLocked() public {
        LaunchToken token = _launch("Locked Earner", "LERN", 1_000, bytes32(0));

        uint256 locked = launchpad.launchOf(address(token)).creatorAllocation;
        uint256 tokensAtLaunch = IERC20(address(token)).balanceOf(creator); // mint dust only
        assertGt(locked, 0, "creator has tokens locked");
        assertEq(IERC20(address(token)).balanceOf(address(launchpad)), locked, "held exactly");

        // Trade hard, then collect. Collection sells this launch's token fees.
        for (uint256 i = 0; i < 3; i++) {
            _churn(address(token), 40_000e6);
            launchpad.collectFees(address(token));

            assertEq(
                IERC20(address(token)).balanceOf(address(launchpad)),
                locked,
                "locked allocation is exactly as it was, mid-flight"
            );
        }

        console2.log("creator USDC from fees (6dp):", usdc.balanceOf(creator));
        console2.log("creator tokens still locked:  ", locked);

        assertGt(usdc.balanceOf(creator), 0, "creator was paid, in USDC");
        assertEq(
            IERC20(address(token)).balanceOf(creator),
            tokensAtLaunch,
            "and received no tokens: the fee side never came out in kind"
        );
        assertEq(IERC20(address(token)).balanceOf(address(launchpad)), locked, "lock still whole after fees");

        // The lock then releases in full, untouched by any of it.
        vm.warp(block.timestamp + 31 minutes);
        launchpad.claimCreatorAllocation(address(token));
        assertEq(
            IERC20(address(token)).balanceOf(creator) - tokensAtLaunch,
            locked,
            "creator receives every locked token"
        );
        assertEq(IERC20(address(token)).balanceOf(address(launchpad)), 0, "nothing of theirs left behind");
    }

    /// @dev And the same again with a second creator's lock sitting alongside, so
    ///      one creator's fees can never be paid out of another creator's lock.
    function test_oneCreatorsFeesNeverTouchAnothersLock() public {
        LaunchToken mine = _launch("Mine", "MINE", 1_000, bytes32(0));
        LaunchToken theirs = _launch("Theirs", "THRS", 2_000, bytes32(0));

        uint256 theirLock = launchpad.launchOf(address(theirs)).creatorAllocation;
        assertGt(theirLock, 0, "the other lock exists");

        for (uint256 i = 0; i < 3; i++) {
            _churn(address(mine), 40_000e6);
            launchpad.collectFees(address(mine));
            assertEq(
                IERC20(address(theirs)).balanceOf(address(launchpad)),
                theirLock,
                "the other creator's lock never moves"
            );
        }

        assertGt(usdc.balanceOf(creator), 0, "fees were paid out");
        assertEq(IERC20(address(theirs)).balanceOf(address(launchpad)), theirLock, "still whole at the end");
    }
}
