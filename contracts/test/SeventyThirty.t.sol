// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/console2.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";

/// @notice The promise the create page makes about money, checked as arithmetic.
///
/// @dev Two claims are being tested, and they are different claims:
///
///      1. A creator tax of N% takes N% of the USDC side of every swap -- buys
///         and sells alike.
///      2. Everything collected is split 70/30 between the fee recipient and
///         the treasury, and the creator tax is *included* in that split. The
///         platform earns its 30% of the tax the creator set, not merely of the
///         base pool fee.
///
///      On testnet the treasury and the creator are the same wallet, so neither
///      claim can be told apart by looking at balances there. Here they are
///      separate addresses and the split is visible.
contract SeventyThirtyTest is TsukiTestBase {
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;

    /// The live configuration: the platform takes 30% of what a launch collects.
    uint16 constant PROTOCOL_FEE_BPS = 3_000;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = PROTOCOL_FEE_BPS;
        _deployStack(cfg);
        usdc.mint(alice, 1_000_000e6);
        vm.warp(1_000_000);
    }

    function _launch(uint16 taxBps) internal returns (address token) {
        bytes32 salt;
        for (uint256 i = 0; i < 20_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Split", "SPLIT", SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Split",
                symbol: "SPLIT",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                devBuyUsdc: 0,
                rewardHolders: false,
                feeRecipient: address(0), // the creator keeps the fees
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: taxBps
            })
        );
    }

    /// @dev A 5% tax takes 5% of the USDC going in, to the wei.
    function test_aFivePercentTaxTakesFivePercent() public {
        address token = _launch(500);
        uint256 spend = 10_000e6;

        _poolBuy(alice, token, spend);

        uint256 tax = hook.owed(_poolId(token), _poolKey(token).currency1);
        console2.log("buy            :", spend);
        console2.log("5%% tax taken   :", tax);
        assertEq(tax, (spend * 500) / 10_000, "5% of the buy, exactly");
        assertEq(hook.owed(_poolId(token), _poolKey(token).currency0), 0, "and none of it in the token");
    }

    /// @dev The whole pot -- base pool fee *and* the creator's 5% tax -- splits
    ///      70/30. This is the claim the create page makes when it says a 5% tax
    ///      leaves 3.5% with the creator.
    function test_theCreatorTaxIsSplitSeventyThirtyToo() public {
        address token = _launch(500);

        // Trade both ways, so the pot contains a USDC-side fee, a token-side
        // fee, and creator tax from each direction.
        uint256 bought = _poolBuy(alice, token, 10_000e6);
        _poolSell(alice, token, bought / 2);

        uint256 creatorBefore = usdc.balanceOf(creator);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        // Measured across the collection, not as an absolute: a launch leaves
        // the creator the mint's rounding dust, which is not a fee payout.
        uint256 creatorTokBefore = IERC20(token).balanceOf(creator);
        uint256 treasuryTokBefore = IERC20(token).balanceOf(treasury);

        launchpad.collectFees(token);

        uint256 toCreator = usdc.balanceOf(creator) - creatorBefore;
        uint256 toTreasury = usdc.balanceOf(treasury) - treasuryBefore;
        uint256 pot = toCreator + toTreasury;

        console2.log("creator paid   :", toCreator);
        console2.log("treasury paid  :", toTreasury);
        console2.log("pot            :", pot);
        console2.log("creator bps    :", (toCreator * 10_000) / pot);

        assertGt(pot, 0, "there was something to split");
        // 70/30 of the whole pot, to within a wei of rounding.
        assertApproxEqAbs(toCreator, (pot * 7_000) / 10_000, 2, "creator takes 70%");
        assertApproxEqAbs(toTreasury, (pot * 3_000) / 10_000, 2, "treasury takes 30%");

        // Neither side is ever handed the token by a collection.
        assertEq(IERC20(token).balanceOf(creator) - creatorTokBefore, 0, "creator paid no tokens");
        assertEq(IERC20(token).balanceOf(treasury) - treasuryTokBefore, 0, "treasury paid no tokens");

        // The pot has to be bigger than the base fee alone could make it --
        // proof the creator's tax went through the same 70/30 split rather than
        // being paid out whole to the creator beside it.
        uint256 taxOnly = (10_000e6 * 500) / 10_000;
        assertGt(pot, taxOnly, "the pot includes the tax and the base fee");
        assertGt(toTreasury, (taxOnly * 3_000) / 10_000 / 2, "the treasury got a real cut of the tax");
    }

    /// @dev The same split holds whatever rate the creator picks, including the
    ///      0% case where only the base pool fee is in the pot.
    function test_theSplitHoldsAtEveryTaxRate() public {
        uint16[4] memory rates = [uint16(0), 300, 500, 1_000];
        for (uint256 i = 0; i < rates.length; i++) {
            // A fresh stack per rate, so each launch can reuse the same name.
            StackConfig memory cfg = _defaultConfig(treasury, address(this));
            cfg.protocolFeeBps = PROTOCOL_FEE_BPS;
            _deployStack(cfg);
            usdc.mint(alice, 1_000_000e6);

            address token = _launch(rates[i]);
            uint256 bought = _poolBuy(alice, token, 10_000e6);
            _poolSell(alice, token, bought / 2);

            uint256 c0 = usdc.balanceOf(creator);
            uint256 t0 = usdc.balanceOf(treasury);
            launchpad.collectFees(token);
            uint256 toCreator = usdc.balanceOf(creator) - c0;
            uint256 toTreasury = usdc.balanceOf(treasury) - t0;
            uint256 pot = toCreator + toTreasury;

            console2.log("tax bps        :", rates[i]);
            console2.log("  creator bps  :", (toCreator * 10_000) / pot);

            assertApproxEqAbs(toCreator, (pot * 7_000) / 10_000, 2, "creator takes 70% at every rate");
            assertApproxEqAbs(toTreasury, (pot * 3_000) / 10_000, 2, "treasury takes 30% at every rate");
        }
    }
}
