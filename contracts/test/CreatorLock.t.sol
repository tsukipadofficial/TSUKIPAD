// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The creator's allocation is the only supply not locked in the pool,
///         so it is the only supply that could be dumped on early buyers. These
///         tests pin down the 30-minute hold that prevents that.
contract CreatorLockTest is Test {
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

    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    function setUp() public {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(code, 0x20), mload(code))
        }
        launchpad = new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, makeAddr("treasury"), 5_000);
        router = new ArcSwapRouter(factoryAddr);
        usdc.mint(alice, 100_000e6);
    }

    function _launch(uint16 allocationBps) internal returns (address token) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Lock", "LOCK", SUPPLY, "", false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Lock",
                symbol: "LOCK",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: allocationBps,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
            })
        );
    }

    function test_allocationIsNotDeliveredAtLaunch() public {
        address token = _launch(1_000); // 10%

        uint256 held = IERC20(token).balanceOf(creator);
        console2.log("creator balance right after launch:", held);

        // Only mint dust; the 100M allocation is still held by the launchpad.
        assertLt(held, SUPPLY / 1_000_000, "creator holds only dust at launch");
        assertApproxEqRel(
            IERC20(token).balanceOf(address(launchpad)), SUPPLY / 10, 0.001e18, "launchpad holds the allocation"
        );

        ArcLaunchpad.Launch memory l = launchpad.launchOf(token);
        assertEq(l.unlockAt, uint64(block.timestamp) + launchpad.CREATOR_LOCK_DURATION());
        assertFalse(l.allocationClaimed);
    }

    function test_cannotClaimBeforeTheLockExpires() public {
        address token = _launch(1_000);

        vm.expectRevert(ArcLaunchpad.StillLocked.selector);
        launchpad.claimCreatorAllocation(token);

        // One second short is still short.
        vm.warp(block.timestamp + 30 minutes - 1);
        vm.expectRevert(ArcLaunchpad.StillLocked.selector);
        launchpad.claimCreatorAllocation(token);
    }

    function test_claimableAfterThirtyMinutes() public {
        address token = _launch(1_000);

        vm.warp(block.timestamp + 30 minutes);
        launchpad.claimCreatorAllocation(token);

        assertApproxEqRel(IERC20(token).balanceOf(creator), SUPPLY / 10, 0.001e18, "creator received it");
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad holds nothing after");
        assertTrue(launchpad.launchOf(token).allocationClaimed);
    }

    function test_cannotClaimTwice() public {
        address token = _launch(1_000);
        vm.warp(block.timestamp + 30 minutes);
        launchpad.claimCreatorAllocation(token);

        vm.expectRevert(ArcLaunchpad.AllocationAlreadyClaimed.selector);
        launchpad.claimCreatorAllocation(token);
    }

    /// @dev Anyone may trigger the release, but it can only ever pay the creator.
    function test_claimIsPermissionlessButPaysOnlyTheCreator() public {
        address token = _launch(1_000);
        vm.warp(block.timestamp + 30 minutes);

        vm.prank(alice);
        launchpad.claimCreatorAllocation(token);

        assertEq(IERC20(token).balanceOf(alice), 0, "caller gets nothing");
        assertApproxEqRel(IERC20(token).balanceOf(creator), SUPPLY / 10, 0.001e18, "creator gets it");
    }

    /// @dev The whole point: during the lock the creator has nothing to dump.
    function test_creatorCannotDumpDuringTheLock() public {
        address token = _launch(2_000); // max 20%

        // Real buyers arrive.
        vm.startPrank(alice);
        usdc.approve(address(router), 5_000e6);
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC_ADDR,
                tokenOut: token,
                fee: FEE,
                recipient: alice,
                deadline: block.timestamp + 1,
                amountIn: 5_000e6,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();

        // The creator tries to sell their allocation into those buyers.
        uint256 creatorHas = IERC20(token).balanceOf(creator);
        console2.log("creator can sell at most (wei):", creatorHas);
        assertLt(creatorHas, SUPPLY / 1_000_000, "nothing meaningful to sell");

        // Attempting to sell the full allocation fails: they do not hold it.
        vm.startPrank(creator);
        IERC20(token).approve(address(router), SUPPLY / 5);
        vm.expectRevert();
        router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: creator,
                deadline: block.timestamp + 1,
                amountIn: SUPPLY / 5,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    function test_zeroAllocationNeedsNoClaim() public {
        address token = _launch(0);

        ArcLaunchpad.Launch memory l = launchpad.launchOf(token);
        assertTrue(l.allocationClaimed, "marked settled immediately");
        assertEq(l.creatorAllocation, 0);

        vm.warp(block.timestamp + 30 minutes);
        vm.expectRevert(ArcLaunchpad.AllocationAlreadyClaimed.selector);
        launchpad.claimCreatorAllocation(token);
    }

    /// @dev Locked supply sits with the launchpad, which is excluded from holder
    ///      rewards — so a creator cannot farm rewards on tokens they cannot yet
    ///      sell, and no rewards are stranded on the locked balance.
    function test_lockedAllocationEarnsNoHolderRewards() public {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Lock", "LOCK", SUPPLY, "", true, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        (address token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Lock",
                symbol: "LOCK",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 1_000,
                rewardHolders: true,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0)
            })
        );

        assertTrue(LaunchToken(token).excludedFromRewards(address(launchpad)), "launchpad excluded");
        assertEq(LaunchToken(token).pendingRewards(address(launchpad)), 0);
    }
}
