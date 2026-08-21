// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Referrals are paid out of the protocol's share of swap fees. A
///         creator earns exactly the same whether or not they were referred.
contract ReferralTest is Test {
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
    address referrer = makeAddr("referrer");

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
        launchpad.setReferralFeeBps(1_000); // 10% of swap fees

        usdc.mint(alice, 2_000_000e6);
    }

    function _launch(string memory name, string memory sym, address ref) internal returns (LaunchToken token) {
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
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: ref
            })
        );
        token = LaunchToken(t);
    }

    function _churn(address token, uint256 usdcIn) internal {
        vm.startPrank(alice);
        usdc.approve(address(router), usdcIn);
        uint256 out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC_ADDR, tokenOut: token, fee: FEE, recipient: alice,
                deadline: block.timestamp + 1, amountIn: usdcIn, amountOutMinimum: 0
            })
        );
        IERC20(token).approve(address(router), out);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: token, tokenOut: USDC_ADDR, fee: FEE, recipient: alice,
                deadline: block.timestamp + 1, amountIn: out, amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    // ------------------------------------------------------------------

    /// @dev The property the whole design rests on: a creator is no worse off for
    ///      having been referred. Two identical launches, one referred, one not.
    function test_theCreatorEarnsTheSameEitherWay() public {
        LaunchToken plain = _launch("Plain", "PLN", address(0));
        LaunchToken referred = _launch("Referred", "REF", referrer);

        _churn(address(plain), 40_000e6);
        _churn(address(referred), 40_000e6);

        launchpad.collectFees(address(plain));
        uint256 creatorFromPlain = usdc.balanceOf(creator);
        uint256 treasuryFromPlain = usdc.balanceOf(treasury);

        launchpad.collectFees(address(referred));
        uint256 creatorFromReferred = usdc.balanceOf(creator) - creatorFromPlain;
        uint256 treasuryFromReferred = usdc.balanceOf(treasury) - treasuryFromPlain;
        uint256 referrerGot = usdc.balanceOf(referrer);

        console2.log("creator, unreferred: ", creatorFromPlain);
        console2.log("creator, referred:   ", creatorFromReferred);
        console2.log("treasury, unreferred:", treasuryFromPlain);
        console2.log("treasury, referred:  ", treasuryFromReferred);
        console2.log("referrer:            ", referrerGot);

        assertApproxEqRel(creatorFromReferred, creatorFromPlain, 0.02e18, "creator unaffected by the referral");
        assertGt(referrerGot, 0, "referrer was paid");
        assertLt(treasuryFromReferred, treasuryFromPlain, "the referral came out of the treasury's share");
    }

    /// @dev 10% of fees to the referrer means the treasury takes 40% instead of
    ///      50% -- so the referral should be about a fifth of what treasury keeps.
    function test_theSplitIsFiftyForty10() public {
        LaunchToken token = _launch("Split", "SPL", referrer);
        _churn(address(token), 60_000e6);
        launchpad.collectFees(address(token));

        uint256 dev = usdc.balanceOf(creator);
        uint256 treas = usdc.balanceOf(treasury);
        uint256 ref = usdc.balanceOf(referrer);
        uint256 total = dev + treas + ref;

        console2.log("dev share bps:     ", (dev * 10_000) / total);
        console2.log("treasury share bps:", (treas * 10_000) / total);
        console2.log("referrer share bps:", (ref * 10_000) / total);

        assertApproxEqRel(dev, total / 2, 0.02e18, "dev keeps half");
        assertApproxEqRel(ref, total / 10, 0.05e18, "referrer takes a tenth");
        assertApproxEqRel(treas, (total * 4) / 10, 0.05e18, "treasury takes the rest");
    }

    function test_noReferrerMeansTreasuryKeepsTheFullHalf() public {
        LaunchToken token = _launch("Solo", "SOLO", address(0));
        _churn(address(token), 40_000e6);
        launchpad.collectFees(address(token));

        uint256 dev = usdc.balanceOf(creator);
        uint256 treas = usdc.balanceOf(treasury);
        assertApproxEqRel(treas, dev, 0.02e18, "an even split with nobody in between");
        assertEq(usdc.balanceOf(referrer), 0, "nobody was paid a referral");
    }

    function test_creatorCannotReferThemselves() public {
        // Mine the salt first: expectRevert applies to the next call, and the
        // helper makes plenty of view calls before it ever reaches launch().
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Self", "SELF", SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        ArcLaunchpad.LaunchParams memory params = ArcLaunchpad.LaunchParams({
            name: "Self", symbol: "SELF", metadataURI: "", totalSupply: SUPPLY, salt: salt,
            tickLower: TICK_LOWER, tickUpper: TICK_UPPER, creatorAllocationBps: 0,
            rewardHolders: false, feeRecipient: address(0), buybackAndBurn: false,
            recipientCommitment: bytes32(0), referrer: creator
        });

        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.SelfReferral.selector);
        launchpad.launch(params);
    }

    function test_referrerIsFixedAtLaunchAndSurvivesARateChange() public {
        LaunchToken token = _launch("Fixed", "FIX", referrer);
        (address who, uint16 bps) = launchpad.referralOf(address(token));
        assertEq(who, referrer, "referrer recorded");
        assertEq(bps, 1_000, "rate snapshotted");

        // Cutting the rate must not retroactively cut an existing promise.
        launchpad.setReferralFeeBps(0);
        (, uint16 stillBps) = launchpad.referralOf(address(token));
        assertEq(stillBps, 1_000, "the launch keeps the rate it was created with");

        _churn(address(token), 40_000e6);
        launchpad.collectFees(address(token));
        assertGt(usdc.balanceOf(referrer), 0, "still paid at the original rate");
    }

    function test_rateCannotExceedTheProtocolShare() public {
        vm.expectRevert(ArcLaunchpad.ReferralFeeTooHigh.selector);
        launchpad.setReferralFeeBps(6_000); // above protocolFeeBps of 5,000

        vm.expectRevert(ArcLaunchpad.ReferralFeeTooHigh.selector);
        launchpad.setReferralFeeBps(2_001); // above MAX_REFERRAL_FEE_BPS
    }

    function test_nonOwnerCannotSetTheRate() public {
        vm.prank(alice);
        vm.expectRevert();
        launchpad.setReferralFeeBps(500);
    }

    /// @dev Real USDC can blacklist an address, and then every transfer to it
    ///      reverts. If that could revert fee collection, one blacklisted
    ///      referrer would freeze a creator's fees forever over someone else's
    ///      problem. The share must fall through to the treasury instead.
    function test_aBlacklistedReferrerCannotBrickFeeCollection() public {
        LaunchToken token = _launch("Blocked", "BLK", referrer);
        _churn(address(token), 40_000e6);

        // The token itself refuses to pay this address, as a blacklist would.
        vm.mockCallRevert(
            USDC_ADDR,
            abi.encodeWithSelector(IERC20.transfer.selector, referrer),
            "Blacklistable: account is blacklisted"
        );

        launchpad.collectFees(address(token)); // must not revert
        vm.clearMockedCalls();

        assertGt(usdc.balanceOf(creator), 0, "creator still got paid");
        assertGt(usdc.balanceOf(treasury), 0, "the share fell through to treasury");
        assertEq(usdc.balanceOf(referrer), 0, "blacklisted referrer received nothing");

        // And collection keeps working afterwards.
        _churn(address(token), 20_000e6);
        launchpad.collectFees(address(token));
        assertGt(usdc.balanceOf(referrer), 0, "paid again once the block is lifted");
    }
}
