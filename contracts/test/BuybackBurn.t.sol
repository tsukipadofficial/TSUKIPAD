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
import {TsukiV4Pool} from "../src/TsukiV4Pool.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";

/// @notice Tests the deflationary fee mode: the creator's USDC share buys the
///         token back off its own pool and destroys it.
contract BuybackBurnTest is TsukiTestBase {

    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;


    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);
        usdc.mint(alice, 1_000_000e6);
    }

    function _launch(bool buyback) internal returns (LaunchToken token) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Burn", "BURN", SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Burn",
                symbol: "BURN",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: buyback,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address who, address token, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(who);
        usdc.approve(address(router), usdcIn);
        out = router.exactInputSingle(
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

    // ------------------------------------------------------------------

    function test_feesBuyTheTokenBackAndDestroyIt() public {
        LaunchToken token = _launch(true);

        _buy(alice, address(token), 50_000e6);

        uint256 supplyBefore = token.totalSupply();
        uint256 creatorUsdcBefore = usdc.balanceOf(creator);

        launchpad.collectFees(address(token));

        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(token));
        console2.log("USDC spent buying back :", l.usdcSpentOnBuybacks);
        console2.log("tokens burned          :", l.tokensBurned);
        console2.log("supply before          :", supplyBefore);
        console2.log("supply after           :", token.totalSupply());

        assertGt(l.usdcSpentOnBuybacks, 0, "USDC was spent");
        assertGt(l.tokensBurned, 0, "tokens were destroyed");
        assertEq(token.totalSupply(), supplyBefore - l.tokensBurned, "totalSupply fell by exactly the burn");
        assertEq(usdc.balanceOf(creator), creatorUsdcBefore, "creator received no USDC");
    }

    /// @dev The launchpad must not end up holding either asset afterwards.
    function test_launchpadKeepsNothingAfterABuyback() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 30_000e6);
        launchpad.collectFees(address(token));

        assertEq(token.balanceOf(address(launchpad)), 0, "no tokens left over");
        assertEq(usdc.balanceOf(address(launchpad)), 0, "no USDC left over");
    }

    /// @dev The protocol still takes its cut; only the creator's half is burned.
    function test_treasuryStillGetsItsShare() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 20_000e6);
        launchpad.collectFees(address(token));

        assertGt(usdc.balanceOf(treasury), 0, "treasury paid as normal");
    }

    /// @dev Buying back pushes the price up, since it is a real market buy.
    function test_buybackRaisesThePrice() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 40_000e6);

        (, int24 tickBefore) = _slot0(address(token));

        launchpad.collectFees(address(token));

        (, int24 tickAfter) = _slot0(address(token));
        console2.log("tick before buyback:", int256(tickBefore));
        console2.log("tick after buyback :", int256(tickAfter));
        assertGt(tickAfter, tickBefore, "buy-back moved the price up");
    }

    function test_repeatedBuybacksAccumulate() public {
        LaunchToken token = _launch(true);

        _buy(alice, address(token), 10_000e6);
        launchpad.collectFees(address(token));
        uint256 burned1 = launchpad.launchOf(address(token)).tokensBurned;

        _buy(alice, address(token), 10_000e6);
        launchpad.collectFees(address(token));
        uint256 burned2 = launchpad.launchOf(address(token)).tokensBurned;

        assertGt(burned2, burned1, "second buy-back added to the total");
        assertEq(token.totalSupply(), SUPPLY - burned2, "supply reflects every burn");
    }

    function test_modeIsOffByDefault() public {
        LaunchToken token = _launch(false);
        assertFalse(launchpad.launchOf(address(token)).buybackAndBurn);

        _buy(alice, address(token), 10_000e6);
        launchpad.collectFees(address(token));

        assertEq(token.totalSupply(), SUPPLY, "nothing burned");
        assertGt(usdc.balanceOf(creator), 0, "creator paid instead");
    }

    /// @dev The unlock callback must reject anyone other than the pool manager,
    ///      mid-buyback or otherwise.
    function test_unlockCallbackRejectsStrangers() public {
        LaunchToken token = _launch(true);

        vm.prank(alice);
        vm.expectRevert(TsukiV4Pool.NotPoolManager.selector);
        launchpad.unlockCallback(abi.encode(uint8(2), _poolKey(address(token)), true, uint256(1)));
    }

    /// @dev Regression: once the curve is fully bought out the pool price sits at
    ///      the top of the range, and a buy-back swap asking for a limit above it
    ///      reverts with Uniswap's `SPL`. That used to wedge `collectFees`
    ///      permanently — the treasury could never be paid again either. A
    ///      sold-out pool must now fall back to paying the fee recipient.
    function test_soldOutPoolDoesNotWedgeFeeCollection() public {
        LaunchToken token = _launch(true);

        // Buy far more than the curve can absorb, exhausting it completely.
        usdc.mint(alice, 5_000_000e6);
        _buy(alice, address(token), 5_000_000e6);

        (, int24 tick) = _slot0(address(token));
        assertGe(tick, TICK_UPPER, "curve is exhausted");

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // This must not revert.
        launchpad.collectFees(address(token));

        assertGt(usdc.balanceOf(treasury), treasuryBefore, "treasury still paid on a sold-out pool");
        assertGt(usdc.balanceOf(creator), 0, "creator share fell back to USDC rather than being lost");
        assertEq(usdc.balanceOf(address(launchpad)), 0, "nothing stranded");
    }

    /// @dev Burning is open to holders too, and it reduces supply for real.
    function test_holdersCanBurnTheirOwnTokens() public {
        LaunchToken token = _launch(false);
        uint256 got = _buy(alice, address(token), 5_000e6);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(alice);
        token.burn(got / 2);

        assertEq(token.totalSupply(), supplyBefore - got / 2, "supply fell");
        assertEq(token.balanceOf(alice), got - got / 2, "balance fell");
    }

    /// @dev A burn must not corrupt reward accounting on a rewards-enabled token.
    function test_burningKeepsRewardAccountingConsistent() public {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Both", "BOTH", SUPPLY, "", true, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Both",
                symbol: "BOTH",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: true,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
        LaunchToken token = LaunchToken(t);

        uint256 got = _buy(alice, address(token), 5_000e6);
        uint256 eligibleBefore = token.rewardEligibleSupply();

        vm.prank(alice);
        token.burn(got / 2);

        assertEq(
            token.rewardEligibleSupply(), eligibleBefore - got / 2, "earning supply shrank with the burn"
        );

        // Rewards still distribute cleanly afterwards.
        launchpad.collectFees(address(token));
        assertGt(token.pendingRewards(alice), 0, "alice still earns on what she kept");
    }

    /// @dev Buy-and-burn burns the token-side fees outright rather than selling
    ///      them for USDC and immediately buying the same token back. The round
    ///      trip paid the pool fee and slippage twice to arrive in the same
    ///      place, destroying measurably less supply than it collected.
    function test_tokenSideFeesAreBurnedDirectlyNotRoundTripped() public {
        LaunchToken token = _launch(true);

        uint256 bought = _buy(alice, address(token), 40_000e6);

        // Selling is what produces token-denominated fees in the first place.
        vm.startPrank(alice);
        IERC20(address(token)).approve(address(router), bought);
        router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(address(token)),
                zeroForOne: true,
                amountIn: bought,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp + 1
            })
        );
        vm.stopPrank();

        uint256 supplyBefore = token.totalSupply();
        uint256 burnedBefore = launchpad.launchOf(address(token)).tokensBurned;

        launchpad.collectFees(address(token));

        uint256 burnedNow = launchpad.launchOf(address(token)).tokensBurned;
        console2.log("supply burned this collection:", supplyBefore - token.totalSupply());
        console2.log("tokensBurned delta:           ", burnedNow - burnedBefore);

        assertGt(burnedNow, burnedBefore, "supply was destroyed");
        assertEq(supplyBefore - token.totalSupply(), burnedNow - burnedBefore, "accounting matches reality");

        // The treasury is owed money, not supply reduction, so its share is still
        // converted -- and it must never come out in kind.
        assertGt(usdc.balanceOf(treasury), 0, "treasury paid in USDC");
        assertEq(token.balanceOf(treasury), 0, "treasury holds none of the token");

        // The creator earns nothing in this mode: their share became burnt supply.
        assertEq(usdc.balanceOf(creator), 0, "creator takes no USDC in buyback mode");
    }
}
