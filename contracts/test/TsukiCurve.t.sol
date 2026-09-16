// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {TsukiCurve} from "../src/TsukiCurve.sol";
import {CurveToken} from "../src/CurveToken.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {TickMath, FullMath} from "../src/libraries/V3Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";

/// @notice Bonding-curve launches, run against a real Uniswap v4 pool manager.
contract TsukiCurveTest is TsukiTestBase {
    uint16 constant PROTOCOL_FEE_BPS = 5_000;
    uint16 constant TRADE_FEE_BPS = 100; // 1%
    uint256 constant GRADUATION_USDC = 9_350e6;
    uint16 constant LP_BPS = 1_798;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address team = makeAddr("team");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = PROTOCOL_FEE_BPS;
        cfg.curveTradeFeeBps = TRADE_FEE_BPS;
        cfg.curveGraduationUsdc = GRADUATION_USDC;
        cfg.curveLpBps = LP_BPS;
        _deployStack(cfg);

        for (uint256 i = 0; i < 3; i++) {
            address who = [alice, bob, creator][i];
            usdc.mint(who, 1_000_000e6);
            vm.prank(who);
            usdc.approve(address(curve), type(uint256).max);
        }
        vm.warp(1_000_000);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _params(bytes32 salt) internal pure returns (TsukiCurve.LaunchParams memory p) {
        p.name = "Moon";
        p.symbol = "MOON";
        p.metadataURI = "ipfs://moon";
        p.salt = salt;
    }

    function _mine(TsukiCurve.LaunchParams memory p) internal view returns (bytes32) {
        for (uint256 i = 0; i < 5_000; i++) {
            address predicted =
                curve.predictTokenAddress(creator, p.name, p.symbol, p.metadataURI, p.rewardHolders, bytes32(i));
            if (predicted < USDC_ADDR) return bytes32(i);
        }
        revert("no salt");
    }

    function _launch(TsukiCurve.LaunchParams memory p) internal returns (address token) {
        p.salt = _mine(p);
        vm.prank(creator);
        token = curve.launch(p);
    }

    function _launch() internal returns (address token) {
        token = _launch(_params(0));
        // Past the snipe window, so ordinary tests trade at the ordinary fee.
        vm.warp(vm.getBlockTimestamp() + 10);
    }

    function _buy(address who, address token, uint256 usdcIn) internal returns (uint256 out, uint256 used) {
        vm.prank(who);
        (out, used) = curve.buy(token, usdcIn, 0, who);
    }

    function _sell(address who, address token, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(token).approve(address(curve), amount);
        out = curve.sell(token, amount, 0, who);
        vm.stopPrank();
    }

    /// @dev Curve market cap in whole dollars.
    function _curveMcap(address token) internal view returns (uint256) {
        TsukiCurve.Curve memory c = curve.curveOf(token);
        uint256 mcap6 = FullMath.mulDiv(
            curve.virtualUsdc() + c.usdcRaised,
            curve.TOTAL_SUPPLY(),
            curve.virtualTokens() + curve.TOTAL_SUPPLY() - c.tokensSold
        );
        return mcap6 / 1e6;
    }

    function _poolMcap(address token) internal view returns (uint256) {
        (uint160 sqrtPriceX96,) = _slot0(token);
        uint256 Q96 = 2 ** 96;
        uint256 rawPriceQ96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
        return FullMath.mulDiv(rawPriceQ96, 1e21, Q96);
    }

    /// @dev USDC the curve must hold: every curve's raise plus every fee owed.
    function _assertSolvent(address token) internal view {
        TsukiCurve.Curve memory c = curve.curveOf(token);
        uint256 held = c.graduated ? 0 : c.usdcRaised;
        assertEq(
            usdc.balanceOf(address(curve)),
            held + curve.creatorFeesOwed(token) + curve.protocolFeesOwed(),
            "curve USDC == raised + fees owed"
        );
    }

    // ------------------------------------------------------------------
    // Shape
    // ------------------------------------------------------------------

    function test_opensAroundTwoAndAHalfThousandAndGraduatesAroundFiftyTwoThousand() public {
        address token = _launch();
        uint256 open = _curveMcap(token);
        console2.log("opening market cap (USD):", open);
        assertGt(open, 2_450);
        assertLt(open, 2_550);

        _buy(alice, token, 20_000e6);
        TsukiCurve.Curve memory c = curve.curveOf(token);
        assertTrue(c.graduated, "graduated");

        uint256 poolMcap = _poolMcap(token);
        console2.log("graduation market cap (USD):", poolMcap);
        assertGt(poolMcap, 51_500);
        assertLt(poolMcap, 52_500);
    }

    function test_launchHoldsWholeSupplyAndTokenIsToken0() public {
        address token = _launch();
        assertEq(IERC20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(IERC20(token).balanceOf(address(curve)), 1_000_000_000 ether);
        assertLt(uint160(token), uint160(USDC_ADDR));
        assertEq(LaunchToken(token).creator(), creator);
    }

    function test_priceRisesOnBuysAndFallsOnSells() public {
        address token = _launch();
        uint256 m0 = _curveMcap(token);
        (uint256 got,) = _buy(alice, token, 1_000e6);
        uint256 m1 = _curveMcap(token);
        assertGt(m1, m0);
        _sell(alice, token, got);
        assertLe(_curveMcap(token), m0 + 1, "back to the open, rounding aside");
    }

    function test_roundTripCostsOnlyFees() public {
        address token = _launch();
        uint256 before = usdc.balanceOf(alice);
        (uint256 got, uint256 used) = _buy(alice, token, 1_000e6);
        uint256 back = _sell(alice, token, got);
        uint256 lost = before - usdc.balanceOf(alice);
        assertEq(used, 1_000e6);
        // 1% in, 1% out, and nothing else.
        assertLe(lost, 20e6);
        assertGt(back, 979e6);
        _assertSolvent(token);
    }

    function test_quotesMatchExecution() public {
        address token = _launch();
        (uint256 qOut, uint256 qUsed,) = curve.quoteBuy(token, 777e6, alice);
        (uint256 out, uint256 used) = _buy(alice, token, 777e6);
        assertEq(out, qOut);
        assertEq(used, qUsed);

        (uint256 qUsdc,) = curve.quoteSell(token, out / 3);
        assertEq(_sell(alice, token, out / 3), qUsdc);
    }

    function test_manyTradersStaySolvent() public {
        address token = _launch();
        (uint256 a,) = _buy(alice, token, 2_345e6);
        (uint256 b,) = _buy(bob, token, 1_234e6);
        _sell(alice, token, a / 2);
        (uint256 c,) = _buy(alice, token, 3_000e6);
        _sell(bob, token, b);
        _sell(alice, token, a / 2 + c);
        _assertSolvent(token);

        // Everyone out: the curve owes nobody anything but fees.
        TsukiCurve.Curve memory s = curve.curveOf(token);
        assertEq(s.tokensSold, 0);
        assertLe(s.usdcRaised, 10, "at most rounding dust");
    }

    // ------------------------------------------------------------------
    // Graduation
    // ------------------------------------------------------------------

    function test_finalBuyPaysOnlyForWhatIsLeft() public {
        address token = _launch();
        uint256 before = usdc.balanceOf(alice);
        (uint256 got, uint256 used) = _buy(alice, token, 50_000e6);

        assertEq(got, curve.curveSupply(), "bought the whole curve");
        assertEq(before - usdc.balanceOf(alice), used, "charged exactly what was used");
        // The graduation raise, net of a 1% fee.
        assertApproxEqRel(used, (GRADUATION_USDC * 10_000) / 9_900, 0.001e18);
    }

    function test_graduationSeedsLockedPoolAtTheCurvePrice() public {
        address token = _launch();
        _buy(alice, token, 9_000e6);
        uint256 lastCurveMcap;
        {
            // Price just before the final token sells.
            TsukiCurve.Curve memory pre = curve.curveOf(token);
            assertFalse(pre.graduated);
        }
        _buy(bob, token, 5_000e6);
        TsukiCurve.Curve memory c = curve.curveOf(token);
        assertTrue(c.graduated);
        lastCurveMcap = FullMath.mulDiv(
            curve.virtualUsdc() + c.usdcRaised, curve.TOTAL_SUPPLY(), curve.virtualTokens() + curve.lpSupply()
        ) / 1e6;

        uint256 poolMcap = _poolMcap(token);
        assertApproxEqRel(poolMcap, lastCurveMcap, 0.002e18, "no price jump at graduation");

        assertEq(Currency.unwrap(_poolKey(token).currency0), token, "token is currency0");
        assertGt(c.liquidity, 0);
        assertEq(IERC20(token).balanceOf(address(curve)), 0, "curve holds no tokens");
        assertGt(usdc.balanceOf(address(manager)), 9_349e6, "raise is in the pool");
        assertGt(IERC20(token).balanceOf(address(manager)), 179_000_000 ether, "pool slice is in the pool");
        assertEq(LaunchToken(token).pool(), address(manager), "rewards exclude the pool's balance");
        assertTrue(CurveToken(token).graduated());
        _assertSolvent(token);
    }

    function test_tradingMovesToThePoolAfterGraduation() public {
        address token = _launch();
        _buy(alice, token, 20_000e6);

        vm.expectRevert(TsukiCurve.AlreadyGraduated.selector);
        _buy(bob, token, 1e6);

        // Bob buys and sells through the pool.
        uint256 got = _poolBuy(bob, token, 500e6);
        assertGt(got, 0);
        uint256 back = _poolSell(bob, token, got);
        assertGt(back, 480e6);
    }

    function test_poolFeesAreCollectedAndPositionStaysLocked() public {
        address token = _launch();
        _buy(alice, token, 20_000e6);
        TsukiCurve.Curve memory c = curve.curveOf(token);

        uint256 got = _poolBuy(bob, token, 5_000e6);
        _poolSell(bob, token, got);

        uint128 liqBefore = _poolLiquidity(token);
        uint256 creatorOwedBefore = curve.creatorFeesOwed(token);
        curve.collectFees(token);
        assertEq(_poolLiquidity(token), liqBefore, "principal untouched");
        assertGt(curve.creatorFeesOwed(token), creatorOwedBefore + 40e6, "~half of ~$100 in pool fees");
        _assertSolvent(token);
    }

    function test_nobodyCanOpenTheLaunchPoolBeforeTheCurveDoes() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.salt = _mine(p);
        address token = curve.predictTokenAddress(creator, p.name, p.symbol, p.metadataURI, false, p.salt);

        // On v3 an attacker could create the pool before the token existed and
        // open it at any price, leaving graduation to drag it back. The hook
        // removes the attack outright: it refuses to initialize a pool the pads
        // have not registered, and only the pads can register one.
        vm.expectRevert();
        manager.initialize(_poolKey(token), TickMath.getSqrtRatioAtTick(-330_000));

        vm.prank(creator);
        curve.launch(p);
        vm.warp(vm.getBlockTimestamp() + 10);

        // Nor can a holder seed the manager with curve tokens beforehand.
        (uint256 got,) = _buy(alice, token, 100e6);
        vm.prank(alice);
        vm.expectRevert(CurveToken.TransfersLocked.selector);
        IERC20(token).transfer(address(manager), got);

        _buy(bob, token, 20_000e6);
        TsukiCurve.Curve memory c = curve.curveOf(token);
        assertTrue(c.graduated);
        assertEq(PoolId.unwrap(c.pool), PoolId.unwrap(_poolId(token)), "the pool the curve opened");
        assertApproxEqRel(_poolMcap(token), 52_000, 0.01e18, "opens exactly where the curve ended");
        _assertSolvent(token);
    }

    function test_theTaxFollowsTheLaunchIntoThePool() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.salt = _mine(p);
        p.creatorTaxBps = 500; // 5%
        vm.prank(creator);
        address token = curve.launch(p);
        vm.warp(vm.getBlockTimestamp() + 10);

        _buy(bob, token, 20_000e6);
        assertTrue(curve.curveOf(token).graduated);

        // A pool buy is taxed at the same rate the curve charged -- in USDC, off
        // the amount spent -- and the tax lands with the hook for the pad.
        uint256 before = hook.owed(_poolId(token), _poolKey(token).currency1);
        uint256 got = _poolBuy(alice, token, 1_000e6);
        assertGt(got, 0);
        uint256 taken = hook.owed(_poolId(token), _poolKey(token).currency1) - before;
        assertEq(taken, 50e6, "5% of the 1,000 USDC spent");

        // And so is a sell, which no v3 design could have charged.
        uint256 usdcBefore = hook.owed(_poolId(token), _poolKey(token).currency1);
        _poolSell(alice, token, got / 2);
        assertGt(hook.owed(_poolId(token), _poolKey(token).currency1), usdcBefore, "sells taxed too");

        // The tax comes home through the curve, which is what lets a launch
        // that promised its fees to holders keep that promise.
        uint256 creatorBefore = usdc.balanceOf(creator);
        curve.collectFees(token);
        curve.claimCreatorFees(token);
        assertEq(hook.owed(_poolId(token), _poolKey(token).currency1), 0, "hook holds nothing after");
        assertGt(usdc.balanceOf(creator), creatorBefore, "creator is paid the tax");
    }

    // ------------------------------------------------------------------
    // Transfers
    // ------------------------------------------------------------------

    function test_transfersLockedUntilGraduation() public {
        address token = _launch();
        (uint256 got,) = _buy(alice, token, 1_000e6);

        vm.prank(alice);
        vm.expectRevert(CurveToken.TransfersLocked.selector);
        IERC20(token).transfer(bob, 1);

        _buy(bob, token, 20_000e6);
        vm.prank(alice);
        IERC20(token).transfer(bob, got);
        assertGe(IERC20(token).balanceOf(bob), got);
    }

    // ------------------------------------------------------------------
    // Snipe tax and dev buy
    // ------------------------------------------------------------------

    function test_snipeTaxDecaysToZero() public {
        address token = _launch(_params(0));
        assertEq(curve.snipeTaxBps(token, alice), 9_900);
        vm.warp(vm.getBlockTimestamp() + 1);
        assertEq(curve.snipeTaxBps(token, alice), 2_475);
        vm.warp(vm.getBlockTimestamp() + 1);
        assertEq(curve.snipeTaxBps(token, alice), 618);
        vm.warp(vm.getBlockTimestamp() + 3);
        assertEq(curve.snipeTaxBps(token, alice), 0);
    }

    function test_sniperInLaunchBlockGetsAlmostNothing() public {
        address token = _launch(_params(0));
        (uint256 sniped,) = _buy(alice, token, 1_000e6);
        vm.warp(vm.getBlockTimestamp() + 10);
        (uint256 fair,) = _buy(bob, token, 1_000e6);
        assertLt(sniped, fair / 50, "a launch-block buy gets ~1% of a fair one");
        assertGt(curve.protocolFeesOwed(), 980e6, "tax went to the treasury");
        _assertSolvent(token);
    }

    function test_devBuyAndExemptWalletsSkipTheTax() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.devBuyUsdc = 500e6;
        p.snipeExempt = new address[](1);
        p.snipeExempt[0] = team;
        address token = _launch(p);

        assertGt(IERC20(token).balanceOf(creator), 100_000_000 ether, "dev buy untaxed");
        assertEq(curve.snipeTaxBps(token, team), 0);
        assertEq(curve.snipeTaxBps(token, alice), 9_900);
    }

    function test_devBuyCanGraduateInTheLaunchTransaction() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.devBuyUsdc = 20_000e6;
        address token = _launch(p);
        assertTrue(curve.curveOf(token).graduated);
    }

    // ------------------------------------------------------------------
    // Fees
    // ------------------------------------------------------------------

    function test_baseFeeAndCreatorTaxSplitOnTheSameTerms() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.creatorTaxBps = 200; // +2%
        p.feeRecipient = team;
        address token = _launch(p);
        vm.warp(vm.getBlockTimestamp() + 10);

        _buy(alice, token, 1_000e6);
        // 3% total = $30, split 50/50 in this suite's config: the tax is not a
        // way around the treasury's share, it rides the same split as the base.
        assertEq(curve.protocolFeesOwed(), 15e6);
        assertEq(curve.creatorFeesOwed(token), 15e6);

        curve.claimCreatorFees(token);
        assertEq(usdc.balanceOf(team), 15e6);
        curve.sweepProtocolFees();
        assertEq(usdc.balanceOf(treasury), 15e6);
        _assertSolvent(token);
    }

    function test_rejectsCreatorTaxAboveCap() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.creatorTaxBps = curve.MAX_CREATOR_TAX_BPS() + 1;
        vm.expectRevert(TsukiCurve.BadConfig.selector);
        vm.prank(creator);
        curve.launch(p);
    }

    function test_holderRewardsModePaysHolders() public {
        TsukiCurve.LaunchParams memory p = _params(0);
        p.rewardHolders = true;
        address token = _launch(p);
        vm.warp(vm.getBlockTimestamp() + 10);

        _buy(alice, token, 2_000e6);
        _buy(bob, token, 2_000e6);
        uint256 owed = curve.creatorFeesOwed(token);
        curve.claimCreatorFees(token);

        uint256 a = LaunchToken(token).pendingRewards(alice);
        uint256 b = LaunchToken(token).pendingRewards(bob);
        assertApproxEqAbs(a + b, owed, 2, "every dollar reaches a holder");
        assertEq(LaunchToken(token).pendingRewards(address(curve)), 0);
        assertEq(usdc.balanceOf(creator), 1_000_000e6, "creator received nothing directly");
    }

    function test_sellMoreThanSoldReverts() public {
        address token = _launch();
        vm.expectRevert(TsukiCurve.ExceedsSold.selector);
        vm.prank(alice);
        curve.sell(token, 1, 0, alice);
    }

    function test_slippageGuards() public {
        address token = _launch();
        (uint256 q,,) = curve.quoteBuy(token, 100e6, alice);
        vm.prank(alice);
        vm.expectRevert(TsukiCurve.Slippage.selector);
        curve.buy(token, 100e6, q + 1, alice);
    }

    function testFuzz_buySellNeverDrainsTheCurve(uint96 a, uint96 b, uint8 sellPct) public {
        address token = _launch();
        uint256 amtA = bound(uint256(a), 1e6, 9_000e6);
        uint256 amtB = bound(uint256(b), 1e6, 9_000e6);
        (uint256 gotA,) = _buy(alice, token, amtA);
        if (curve.curveOf(token).graduated) return;
        (uint256 gotB,) = _buy(bob, token, amtB);
        if (curve.curveOf(token).graduated) return;
        _sell(alice, token, (gotA * bound(sellPct, 1, 100)) / 100);
        _sell(bob, token, gotB);
        _assertSolvent(token);
    }
}
