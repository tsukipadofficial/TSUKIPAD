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

/// @notice Follows every cent of every fee, with creator, treasury, beneficiary
///         and trader all held by *distinct* addresses.
///
/// The live-chain checks could not separate these — there the creator, the
/// treasury and the deployer are one wallet, so "the creator was paid" and "the
/// protocol was paid" are indistinguishable. These tests pin the exact split.
contract FeeAccountingTest is TsukiTestBase {

    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;


    // Four genuinely different parties.
    address treasury = makeAddr("PLATFORM_TREASURY");
    address creator = makeAddr("TOKEN_CREATOR");
    address beneficiary = makeAddr("CHARITY");
    address trader = makeAddr("TRADER");

    /// @dev Kept on the contract so a test can stand up a second launchpad on
    ///      the same factory -- needed now that the fee split is immutable and
    ///      a different split means a different deployment.

    function setUp() public {
        // 50/50 split between creator and platform.
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);
        usdc.mint(trader, 1_000_000e6);
    }

    function _launch(bool rewardHolders, address feeRecipient, bool burn)
        internal
        returns (LaunchToken token)
    {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (
                launchpad.predictTokenAddress(creator, "Acct", "ACCT", SUPPLY, "", rewardHolders, bytes32(i))
                    < USDC_ADDR
            ) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address t,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Acct",
                symbol: "ACCT",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: rewardHolders,
                feeRecipient: feeRecipient,
                buybackAndBurn: burn,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
        token = LaunchToken(t);
    }

    function _buy(address token, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(trader);
        usdc.approve(address(router), usdcIn);
        out = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: false,
                amountIn: usdcIn,
                amountOutMinimum: 0,
                recipient: trader,
                deadline: block.timestamp + 1
            })
        );
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Mode 1 — creator keeps the fees
    // ------------------------------------------------------------------

    function test_mode1_creatorFeeAndPlatformFeeSplitExactlyFiftyFifty() public {
        LaunchToken token = _launch(false, address(0), false);

        // Kept well under the curve's ~$95k capacity: a larger offer would only
        // partially fill, and the fee would be 1% of what actually swapped.
        uint256 spend = 40_000e6;
        _buy(address(token), spend);
        launchpad.collectFees(address(token));

        uint256 creatorGot = usdc.balanceOf(creator);
        uint256 treasuryGot = usdc.balanceOf(treasury);
        uint256 totalFees = creatorGot + treasuryGot;

        console2.log("--- MODE 1: creator keeps fees ---");
        console2.log("  trader spent      (6dp):", spend);
        console2.log("  creator received  (6dp):", creatorGot);
        console2.log("  treasury received (6dp):", treasuryGot);
        console2.log("  total fees        (6dp):", totalFees);

        // Uniswap takes 1% of the input.
        assertApproxEqRel(totalFees, spend / 100, 0.001e18, "total fee is 1% of volume");
        assertApproxEqAbs(creatorGot, treasuryGot, 1, "creator and platform split it 50/50");
        assertEq(usdc.balanceOf(beneficiary), 0, "nobody else was paid");
        assertEq(usdc.balanceOf(address(launchpad)), 0, "launchpad kept nothing");
    }

    /// @dev The split follows protocolFeeBps, checked on a launchpad deployed
    ///      at a different rate. It has to be a second deployment now: the value
    ///      is immutable, which is the point -- a creator's terms cannot be
    ///      edited after they launch, only offered differently by a new pad.
    function test_protocolFeeBpsActuallyChangesTheSplit() public {
        // 20% to platform, 80% to creator.
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 2_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);
        LaunchToken token = _launch(false, address(0), false);

        _buy(address(token), 40_000e6);
        launchpad.collectFees(address(token));

        uint256 creatorGot = usdc.balanceOf(creator);
        uint256 treasuryGot = usdc.balanceOf(treasury);
        console2.log("--- 80/20 split ---");
        console2.log("  creator  (6dp):", creatorGot);
        console2.log("  treasury (6dp):", treasuryGot);

        assertApproxEqRel(creatorGot, treasuryGot * 4, 0.01e18, "creator gets 4x the platform");
    }

    // ------------------------------------------------------------------
    // Mode 2 — holders earn
    // ------------------------------------------------------------------

    function test_mode2_holdersGetTheCreatorHalfAndPlatformStillPaid() public {
        LaunchToken token = _launch(true, address(0), false);

        _buy(address(token), 40_000e6);
        launchpad.collectFees(address(token));

        uint256 toHolders = token.totalRewardsReceived();
        uint256 treasuryGot = usdc.balanceOf(treasury);

        console2.log("--- MODE 2: holders earn ---");
        console2.log("  distributed to holders (6dp):", toHolders);
        console2.log("  treasury received      (6dp):", treasuryGot);
        console2.log("  creator received       (6dp):", usdc.balanceOf(creator));

        assertEq(usdc.balanceOf(creator), 0, "creator got no USDC");
        assertGt(treasuryGot, 0, "platform still paid");
        assertApproxEqAbs(toHolders, treasuryGot, 1, "holders got exactly the creator half");

        // And the trader, being the only holder, can withdraw all of it.
        vm.prank(trader);
        uint256 claimed = token.claimRewards();
        assertApproxEqRel(claimed, toHolders, 0.001e18, "the sole holder can claim it all");
        console2.log("  trader claimed         (6dp):", claimed);
    }

    // ------------------------------------------------------------------
    // Mode 3 — buy back and burn
    // ------------------------------------------------------------------

    function test_mode3_creatorHalfIsBurnedPlatformStillPaid() public {
        LaunchToken token = _launch(false, address(0), true);

        _buy(address(token), 40_000e6);
        uint256 supplyBefore = token.totalSupply();
        launchpad.collectFees(address(token));

        ArcLaunchpad.Launch memory l = launchpad.launchOf(address(token));
        uint256 treasuryGot = usdc.balanceOf(treasury);

        console2.log("--- MODE 3: buy back and burn ---");
        console2.log("  USDC spent on buyback (6dp):", l.usdcSpentOnBuybacks);
        console2.log("  treasury received     (6dp):", treasuryGot);
        console2.log("  supply destroyed          :", l.tokensBurned);

        assertEq(usdc.balanceOf(creator), 0, "creator got no USDC");
        assertGt(treasuryGot, 0, "platform still paid");
        assertApproxEqAbs(l.usdcSpentOnBuybacks, treasuryGot, 1, "the creator half was spent buying back");
        assertEq(token.totalSupply(), supplyBefore - l.tokensBurned, "supply fell by exactly the burn");
        assertEq(token.balanceOf(address(launchpad)), 0, "launchpad kept no tokens");
    }

    // ------------------------------------------------------------------
    // Mode 4 — redirect to a third party
    // ------------------------------------------------------------------

    function test_mode4_beneficiaryGetsCreatorHalfPlatformStillPaid() public {
        LaunchToken token = _launch(false, beneficiary, false);

        _buy(address(token), 40_000e6);
        launchpad.collectFees(address(token));

        uint256 causeGot = usdc.balanceOf(beneficiary);
        uint256 treasuryGot = usdc.balanceOf(treasury);

        console2.log("--- MODE 4: fees fund a project ---");
        console2.log("  beneficiary received (6dp):", causeGot);
        console2.log("  treasury received    (6dp):", treasuryGot);
        console2.log("  creator received     (6dp):", usdc.balanceOf(creator));

        assertEq(usdc.balanceOf(creator), 0, "creator got nothing");
        assertGt(causeGot, 0, "beneficiary funded");
        assertApproxEqAbs(causeGot, treasuryGot, 1, "beneficiary got exactly the creator half");
    }

    // ------------------------------------------------------------------
    // Conservation
    // ------------------------------------------------------------------

    /// @dev Nobody can seize the creators' half -- there is no owner, and the
    ///      cap is enforced at deployment. A launchpad that would take more than
    ///      half cannot be deployed at all, so this is verifiable by anyone
    ///      before they launch, from the constructor arguments alone.
    function test_nobodyCanTakeMoreThanHalfOfFees() public {
        assertEq(launchpad.MAX_PROTOCOL_FEE_BPS(), 5_000, "capped at 50%");

        vm.expectRevert(ArcLaunchpad.FeeTooHigh.selector);
        new ArcLaunchpad(USDC_ADDR, manager, hook, tokenDeployer, FEE, TICK_SPACING, treasury, 5_001, address(this), 0, 0);

        vm.expectRevert(ArcLaunchpad.FeeTooHigh.selector);
        new ArcLaunchpad(USDC_ADDR, manager, hook, tokenDeployer, FEE, TICK_SPACING, treasury, 10_000, address(this), 0, 0);

        // The maximum is allowed, and still leaves creators half.
        LaunchToken token = _launch(false, address(0), false);
        _buy(address(token), 40_000e6);
        launchpad.collectFees(address(token));
        assertApproxEqAbs(usdc.balanceOf(creator), usdc.balanceOf(treasury), 1, "still 50/50 at the cap");
    }

    /// @dev Nothing may be created or destroyed by fee collection: every USDC
    ///      the trader spent must sit in the pool, with the parties, or nowhere.
    function test_everyDollarIsAccountedFor() public {
        LaunchToken token = _launch(false, address(0), false);

        uint256 traderBefore = usdc.balanceOf(trader);
        uint256 spend = 50_000e6;
        _buy(address(token), spend);
        launchpad.collectFees(address(token));

        address pool = token.pool();
        uint256 inPool = usdc.balanceOf(pool);
        uint256 toCreator = usdc.balanceOf(creator);
        uint256 toTreasury = usdc.balanceOf(treasury);
        uint256 stuck = usdc.balanceOf(address(launchpad)) + usdc.balanceOf(address(router));
        uint256 traderSpent = traderBefore - usdc.balanceOf(trader);

        console2.log("--- conservation ---");
        console2.log("  trader spent (6dp):", traderSpent);
        console2.log("  in pool      (6dp):", inPool);
        console2.log("  to creator   (6dp):", toCreator);
        console2.log("  to treasury  (6dp):", toTreasury);
        console2.log("  stuck        (6dp):", stuck);

        assertEq(traderSpent, spend, "trader was charged exactly what they offered");
        assertEq(inPool + toCreator + toTreasury, traderSpent, "every cent landed somewhere expected");
        assertEq(stuck, 0, "nothing stranded in the launchpad or router");
    }

    /// @dev Fee collection must be idempotent — a second sweep with no trades in
    ///      between must not conjure a second payout.
    function test_collectingTwiceDoesNotDoublePay() public {
        LaunchToken token = _launch(false, address(0), false);
        _buy(address(token), 20_000e6);

        launchpad.collectFees(address(token));
        uint256 creatorAfterFirst = usdc.balanceOf(creator);
        uint256 treasuryAfterFirst = usdc.balanceOf(treasury);

        launchpad.collectFees(address(token));

        assertEq(usdc.balanceOf(creator), creatorAfterFirst, "creator not paid twice");
        assertEq(usdc.balanceOf(treasury), treasuryAfterFirst, "treasury not paid twice");
    }
}
