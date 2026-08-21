// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Tests for the creator-selectable reward mode: swap fees either go to
///         the creator, or become USDC claimable pro-rata by holders.
contract HolderRewardsTest is Test {
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
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

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

        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        usdc.mint(carol, 1_000_000e6);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _launch(bool rewardHolders) internal returns (LaunchToken token) {
        string memory name = rewardHolders ? "Shared" : "Solo";
        string memory symbol = rewardHolders ? "SHARE" : "SOLO";

        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, name, symbol, SUPPLY, "", rewardHolders, bytes32(i)) < USDC_ADDR)
            {
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
                rewardHolders: rewardHolders,
                feeRecipient: address(0),
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

    // ------------------------------------------------------------------
    // Mode selection
    // ------------------------------------------------------------------

    function test_creatorModeIsDefaultAndPaysCreatorDirectly() public {
        LaunchToken token = _launch(false);
        assertFalse(token.rewardsEnabled(), "rewards off");

        _buy(alice, address(token), 10_000e6);
        launchpad.collectFees(address(token));

        assertGt(usdc.balanceOf(creator), 0, "creator was paid directly");
        assertEq(usdc.balanceOf(address(token)), 0, "token holds nothing");
        assertEq(token.pendingRewards(alice), 0, "holders earn nothing in creator mode");
    }

    function test_holderModeRoutesUsdcFeesToHolders() public {
        LaunchToken token = _launch(true);
        assertTrue(token.rewardsEnabled(), "rewards on");

        _buy(alice, address(token), 10_000e6);

        uint256 creatorBefore = usdc.balanceOf(creator);
        launchpad.collectFees(address(token));

        assertEq(usdc.balanceOf(creator), creatorBefore, "creator got no USDC");
        assertGt(token.totalRewardsReceived(), 0, "token received the USDC");
        assertGt(token.pendingRewards(alice), 0, "alice can claim");
    }

    // ------------------------------------------------------------------
    // Distribution correctness
    // ------------------------------------------------------------------

    function test_rewardsSplitProportionallyToHoldings() public {
        LaunchToken token = _launch(true);

        // Alice ends up with roughly three times Bob's holding.
        uint256 aliceTokens = _buy(alice, address(token), 3_000e6);
        uint256 bobTokens = _buy(bob, address(token), 1_000e6);

        launchpad.collectFees(address(token));

        uint256 aliceOwed = token.pendingRewards(alice);
        uint256 bobOwed = token.pendingRewards(bob);
        assertGt(aliceOwed, 0);
        assertGt(bobOwed, 0);

        // Reward ratio should track the token ratio, not the USDC spent.
        uint256 tokenRatio = (aliceTokens * 1e18) / bobTokens;
        uint256 rewardRatio = (aliceOwed * 1e18) / bobOwed;
        assertApproxEqRel(rewardRatio, tokenRatio, 0.01e18, "rewards track holdings");
    }

    function test_claimTransfersRealUsdc() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 5_000e6);
        launchpad.collectFees(address(token));

        uint256 owed = token.pendingRewards(alice);
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 claimed = token.claimRewards();

        assertEq(claimed, owed, "claimed what was owed");
        assertEq(usdc.balanceOf(alice), before + owed, "USDC actually arrived");
        assertEq(token.pendingRewards(alice), 0, "nothing left to claim");
    }

    function test_cannotClaimTwice() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 5_000e6);
        launchpad.collectFees(address(token));

        vm.prank(alice);
        token.claimRewards();

        vm.prank(alice);
        vm.expectRevert(LaunchToken.NothingToClaim.selector);
        token.claimRewards();
    }

    /// @dev The pool holds most of the supply and its liquidity is locked forever.
    ///      If it earned rewards they would be permanently stranded.
    function test_poolIsExcludedSoRewardsAreNotStranded() public {
        LaunchToken token = _launch(true);
        address pool = token.pool();

        assertTrue(token.excludedFromRewards(pool), "pool excluded");
        assertTrue(token.excludedFromRewards(address(launchpad)), "launchpad excluded");

        _buy(alice, address(token), 5_000e6);
        launchpad.collectFees(address(token));

        assertEq(token.pendingRewards(pool), 0, "pool earns nothing");
        // Everything distributed is claimable by real holders.
        assertApproxEqRel(
            token.pendingRewards(alice), token.totalRewardsReceived(), 0.001e18, "alice can claim it all"
        );
    }

    /// @dev Selling should stop future earnings without clawing back past ones.
    function test_sellingStopsFutureEarningsButKeepsAccrued() public {
        LaunchToken token = _launch(true);
        uint256 aliceTokens = _buy(alice, address(token), 2_000e6);
        _buy(bob, address(token), 2_000e6);

        launchpad.collectFees(address(token));
        uint256 accruedBeforeExit = token.pendingRewards(alice);
        assertGt(accruedBeforeExit, 0);

        // Alice dumps everything.
        vm.startPrank(alice);
        IERC20(address(token)).approve(address(router), aliceTokens);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: address(token),
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: aliceTokens,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 0, "alice is out");
        assertEq(token.pendingRewards(alice), accruedBeforeExit, "past rewards preserved");

        // A second distribution should skip her entirely.
        _buy(carol, address(token), 3_000e6);
        launchpad.collectFees(address(token));

        assertEq(token.pendingRewards(alice), accruedBeforeExit, "no new rewards after exit");
        assertGt(token.pendingRewards(carol), 0, "carol earns instead");

        // And she can still take what she earned while holding.
        vm.prank(alice);
        assertEq(token.claimRewards(), accruedBeforeExit);
    }

    /// @dev Rounding dust left over from the liquidity mint is sent to the creator,
    ///      so there is always at least one eligible holder from block one. That
    ///      means a distribution arriving before any buyer is captured by the
    ///      creator's dust rather than being held back — worth knowing, though it
    ///      is unreachable through the normal path, since fees only exist once
    ///      somebody has traded. The `undistributed` buffer remains as a guard
    ///      against dividing by a zero eligible supply.
    function test_rewardsArrivingBeforeAnyBuyerGoToTheOnlyEligibleHolder() public {
        LaunchToken token = _launch(true);

        uint256 dust = token.balanceOf(creator);
        assertGt(dust, 0, "creator holds mint dust");
        assertEq(token.rewardEligibleSupply(), dust, "and is the only eligible holder");
        console2.log("creator dust (wei):", dust);
        console2.log("as a share of supply (1e18 = 100%):", (dust * 1e18) / SUPPLY);

        usdc.mint(address(this), 100e6);
        usdc.transfer(address(token), 100e6);
        token.notifyRewards();

        assertApproxEqAbs(token.pendingRewards(creator), 100e6, 1, "dust captured it");
        assertEq(token.undistributed(), 0, "nothing stranded");
    }

    /// @dev Once real buyers exist, the creator's dust is negligible and rewards
    ///      go essentially entirely to them.
    function test_creatorDustIsNegligibleOnceBuyersArrive() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 5_000e6);
        launchpad.collectFees(address(token));

        uint256 aliceOwed = token.pendingRewards(alice);
        uint256 creatorOwed = token.pendingRewards(creator);

        assertGt(aliceOwed, 0);
        // Dust is ~1e-14 of supply, so the creator's slice is unmeasurable.
        assertLt(creatorOwed * 1e6, aliceOwed, "creator dust share is negligible");
    }

    /// @dev Reward accounting must never behave like a tax.
    function test_transfersAreStillUntaxedWithRewardsOn() public {
        LaunchToken token = _launch(true);
        _buy(alice, address(token), 1_000e6);

        uint256 amount = token.balanceOf(alice) / 2;
        vm.prank(alice);
        token.transfer(bob, amount);

        assertEq(token.balanceOf(bob), amount, "recipient got the full amount");
    }

    function test_creatorModeTokenRejectsRewardCalls() public {
        LaunchToken token = _launch(false);

        vm.expectRevert(LaunchToken.RewardsDisabled.selector);
        token.notifyRewards();

        vm.prank(alice);
        vm.expectRevert(LaunchToken.RewardsDisabled.selector);
        token.claimRewards();
    }

    function test_onlyLaunchpadCanSetPool() public {
        LaunchToken token = _launch(true);

        vm.prank(alice);
        vm.expectRevert(LaunchToken.OnlyLaunchpad.selector);
        token.setPool(address(0xdead));
    }

    /// @dev Token-side fees deliberately stay with the creator even in holder
    ///      mode, so the contract never has to sell the token into its own pool.
    function test_tokenSideFeesStillGoToCreatorInHolderMode() public {
        LaunchToken token = _launch(true);
        uint256 bought = _buy(alice, address(token), 5_000e6);

        // Selling generates fees denominated in the token.
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

        assertGt(token.balanceOf(creator), 0, "creator still receives token-side fees");
        assertEq(usdc.balanceOf(creator), 0, "but no USDC");
    }
}
