// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {TsukiCurve} from "../src/TsukiCurve.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Where the hook's creator tax actually ends up.
///
/// @dev An audit of the v4 work found the tax could reach a dead end: the pad
///      registered itself as the hook's recipient for an earmarked launch and
///      then had no code path that could move what arrived, and a launch that
///      promised its fees to holders paid its creator personally once it
///      graduated. Both are routing questions, so they are tested as routing:
///      the tax leaves the hook and lands wherever that launch's fees were
///      always going to land.
contract TaxRoutingTest is TsukiTestBase {
    uint256 constant SUPPLY = 1_000_000_000 ether;
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address holder = makeAddr("holder");

    function setUp() public {
        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 3_000;
        _deployStack(cfg);
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(holder, 1_000_000e6);
        usdc.mint(creator, 1_000e6);
        vm.warp(1_000_000);
    }

    function _launch(bool rewardHolders, bytes32 commitment, uint16 taxBps) internal returns (address token) {
        bytes32 salt;
        for (uint256 i = 0; i < 20_000; i++) {
            if (
                launchpad.predictTokenAddress(creator, "Tax", "TAX", SUPPLY, "ipfs://tax", rewardHolders, bytes32(i))
                    < USDC_ADDR
            ) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Tax",
                symbol: "TAX",
                metadataURI: "ipfs://tax",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: rewardHolders,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: commitment,
                referrer: address(0),
                creatorTaxBps: taxBps
            })
        );
    }

    function _trade(address token) internal {
        uint256 bought = _poolBuy(alice, token, 50_000e6);
        _poolSell(alice, token, bought / 2);
    }

    /// @dev The bug: an earmarked launch registered the pad itself as the hook's
    ///      creator, and nothing in the pad could pay that out again. Every
    ///      trade added to a pile nobody could ever reach.
    function test_earmarkedLaunchTaxIsEscrowedNotStranded() public {
        address token = _launch(false, keccak256("@somebody"), 500);
        _trade(token);
        assertGt(hook.owed(_poolId(token), _poolKey(token).currency0), 0, "tax accrued");

        launchpad.collectFees(token);

        assertEq(hook.owed(_poolId(token), _poolKey(token).currency0), 0, "hook emptied");
        assertEq(hook.owed(_poolId(token), _poolKey(token).currency1), 0, "hook emptied");
        // Held for whoever proves the earmark, not lost in the pad.
        assertGt(launchpad.escrowUsdc(token) + launchpad.escrowToken(token), 0, "escrowed for the claimant");
    }

    /// @dev The bug: a launch that promised its fees to holders paid the tax to
    ///      the creator personally, and only after graduation -- the identical
    ///      rate went to holders on the curve and to the creator in the pool.
    function test_holdersLaunchTaxGoesToHolders() public {
        address token = _launch(true, bytes32(0), 1_000);
        _trade(token);

        uint256 creatorBefore = usdc.balanceOf(creator);
        uint256 rewardsBefore = LaunchToken(token).totalRewardsReceived();
        launchpad.collectFees(token);

        assertGt(LaunchToken(token).totalRewardsReceived(), rewardsBefore, "holders were funded");
        assertEq(usdc.balanceOf(creator), creatorBefore, "creator was not paid instead");
    }

    /// @dev The hook custodies tax between claims. Left reward-eligible, those
    ///      balances earn holder rewards that no code can ever claim.
    function test_hookEarnsNoHolderRewards() public {
        address token = _launch(true, bytes32(0), 1_000);
        _trade(token);
        assertTrue(LaunchToken(token).excludedFromRewards(address(hook)), "hook excluded");
        assertEq(LaunchToken(token).pendingRewards(address(hook)), 0, "and earns nothing");
    }

    /// @dev The bug: the creator picks both ticks, and an extreme enough range
    ///      made `getLiquidityForAmount0` floor to a fraction of the supply --
    ///      or to zero. The pad swept the unplaced remainder to the creator and
    ///      still recorded `creatorAllocation: 0`, so a launch could hand its
    ///      creator half the supply while reporting none of it, with the 20% cap
    ///      never consulted.
    function test_anExtremeRangeCannotSmuggleSupplyPastTheCap() public {
        bytes32 salt;
        for (uint256 i = 0; i < 20_000; i++) {
            if (
                launchpad.predictTokenAddress(creator, "Rug", "RUG", SUPPLY, "ipfs://rug", false, bytes32(i)) < USDC_ADDR
            ) {
                salt = bytes32(i);
                break;
            }
        }
        ArcLaunchpad.LaunchParams memory p = ArcLaunchpad.LaunchParams({
            name: "Rug",
            symbol: "RUG",
            metadataURI: "ipfs://rug",
            totalSupply: SUPPLY,
            salt: salt,
            tickLower: -887_200,
            tickUpper: -444_400, // floors the liquidity to zero
            creatorAllocationBps: 0,
            rewardHolders: false,
            feeRecipient: address(0),
            buybackAndBurn: false,
            recipientCommitment: bytes32(0),
            referrer: address(0),
            creatorTaxBps: 0
        });

        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.NoLiquidityPlaced.selector);
        launchpad.launch(p);

        // And a range that places only part of the supply is refused too, rather
        // than quietly paying the creator the difference.
        p.tickUpper = -430_000;
        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.TooMuchSupplyUnplaced.selector);
        launchpad.launch(p);

        assertEq(IERC20(USDC_ADDR).balanceOf(address(launchpad)), 0, "nothing launched");
    }

    /// @dev Integrators are given one address to watch. That only works if the
    ///      factory actually announces what it deployed -- both pads route
    ///      through it, but it used to emit nothing at all.
    function test_everyLaunchIsAnnouncedByTheOneFactory() public {
        vm.recordLogs();
        address token = _launch(false, bytes32(0), 0);

        bytes32 sig = keccak256("TokenDeployed(address,address,address,bool,string,string)");
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(tokenDeployer) && logs[i].topics[0] == sig) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), token, "names the token");
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(launchpad), "names the pad");
                assertEq(address(uint160(uint256(logs[i].topics[3]))), creator, "names the creator");
                found = true;
            }
        }
        assertTrue(found, "the factory announced the launch");
    }

    /// @dev A fee recipient that cannot receive USDC used to take the treasury's
    ///      share and the referrer's down with it, permanently.
    function test_aRecipientThatCannotReceiveDoesNotWedgeCollection() public {
        address token = _launch(false, bytes32(0), 500);
        _trade(token);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.mockCallRevert(USDC_ADDR, abi.encodeWithSelector(IERC20.transfer.selector, creator, uint256(0)), "");
        // Any USDC transfer to the creator reverts, whatever the amount.
        vm.mockCallRevert(
            USDC_ADDR, abi.encodeWithSelector(IERC20.transfer.selector, creator), "frozen"
        );

        launchpad.collectFees(token);

        vm.clearMockedCalls();
        assertGt(usdc.balanceOf(treasury), treasuryBefore, "treasury still paid");
        assertGt(launchpad.escrowUsdc(token), 0, "creator's share held for later, not lost");
    }
}
