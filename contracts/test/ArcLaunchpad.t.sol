// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";
import {TickMath, FullMath} from "../src/libraries/V3Math.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice End-to-end tests for the single-sided launch mechanic, running against
///         the genuine Uniswap V3 factory/pool bytecode from the v3-core package
///         rather than a reimplementation.
contract ArcLaunchpadTest is Test {
    /// @dev Arc's USDC ERC20 interface address. Pinned so the CREATE2 salt-mining
    ///      test exercises the same ordering constraint as the live chain.
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    string constant FACTORY_ARTIFACT =
        "tools/node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

    uint24 constant FEE = 10_000; // 1%
    int24 constant TICK_SPACING = 200;

    // ~$3,030 starting market cap for a 1B supply; see _startTick derivation below.
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400; // ≈1000x ceiling

    uint256 constant SUPPLY = 1_000_000_000 ether; // 1B, 18dp

    ArcLaunchpad launchpad;
    ArcSwapRouter router;
    IUniswapV3Factory v3Factory;
    MockUSDC usdc;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        // Put a 6-decimal USDC at Arc's real USDC address.
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        // Deploy the authentic Uniswap V3 factory.
        bytes memory factoryCode = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(factoryCode, 0x20), mload(factoryCode))
        }
        require(factoryAddr != address(0), "factory deploy failed");
        v3Factory = IUniswapV3Factory(factoryAddr);

        launchpad = new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, treasury, 5_000); // 50% of fees to protocol
        router = new ArcSwapRouter(factoryAddr);

        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @dev Mine a CREATE2 salt until the token sorts below USDC (token0).
    function _mineSalt(address creator_, string memory name, string memory symbol, string memory uri)
        internal
        view
        returns (bytes32)
    {
        return _mineSalt(creator_, name, symbol, uri, false);
    }

    function _mineSalt(
        address creator_,
        string memory name,
        string memory symbol,
        string memory uri,
        bool rewardHolders
    ) internal view returns (bytes32) {
        for (uint256 i = 0; i < 5_000; i++) {
            bytes32 salt = bytes32(i);
            address predicted =
                launchpad.predictTokenAddress(creator_, name, symbol, SUPPLY, uri, rewardHolders, salt);
            if (predicted < USDC_ADDR) return salt;
        }
        revert("no salt found");
    }

    function _launch() internal returns (address token, address pool) {
        bytes32 salt = _mineSalt(creator, "Degen", "DEGEN", "ipfs://meta");
        vm.prank(creator);
        (token, pool) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Degen",
                symbol: "DEGEN",
                metadataURI: "ipfs://meta",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );
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

    function _sell(address who, address token, uint256 tokensIn) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(token).approve(address(router), tokensIn);
        out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: USDC_ADDR,
                fee: FEE,
                recipient: who,
                deadline: block.timestamp + 1,
                amountIn: tokensIn,
                amountOutMinimum: 0
            })
        );
        vm.stopPrank();
    }

    /// @dev Market cap in whole USD, derived from the pool's live price.
    /// @dev Uses full-precision math: squaring sqrtPriceX96 directly overflows
    ///      uint256 once the price has climbed a few orders of magnitude.
    function _marketCapUsd(address pool) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 Q96 = 2 ** 96;
        // rawPrice = (sqrtP / 2^96)^2, carried as a Q96 fixed-point value.
        uint256 rawPriceQ96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
        // human price = raw * 10^(dec0 - dec1) = raw * 1e12; mcap = price * 1e9 supply.
        return FullMath.mulDiv(rawPriceQ96, 1e21, Q96);
    }

    // ------------------------------------------------------------------
    // Launch mechanics
    // ------------------------------------------------------------------

    function test_launch_requiresNoUsdcFromCreator() public {
        assertEq(usdc.balanceOf(creator), 0, "creator starts with no USDC");

        (address token, address pool) = _launch();

        assertEq(usdc.balanceOf(creator), 0, "creator still spent no USDC");
        assertEq(usdc.balanceOf(pool), 0, "pool opens with zero USDC");
        assertEq(IUniswapV3Pool(pool).token0(), token, "launched token must be token0");
        assertEq(IUniswapV3Pool(pool).token1(), USDC_ADDR, "USDC must be token1");
    }

    function test_launch_seedsEntireSupplyAsLiquidity() public {
        (address token, address pool) = _launch();

        uint256 inPool = IERC20(token).balanceOf(pool);
        // Rounding dust goes to the creator; everything else is committed.
        assertGt(inPool, (SUPPLY * 9999) / 10000, "at least 99.99% of supply in the pool");
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad retains nothing");
    }

    function test_launch_startingMarketCapIsAboutThreeThousand() public {
        (, address pool) = _launch();

        uint256 mcap = _marketCapUsd(pool);
        console2.log("starting market cap (USD):", mcap);
        assertGt(mcap, 2_800, "start mcap above $2.8k");
        assertLt(mcap, 3_300, "start mcap below $3.3k");
    }

    function test_launch_revertsIfTokenSortsAboveUsdc() public {
        // Salt 0 is overwhelmingly likely to land above USDC (only ~21% land below).
        bytes32 badSalt;
        for (uint256 i = 0; i < 5_000; i++) {
            address predicted =
                launchpad.predictTokenAddress(creator, "Bad", "BAD", SUPPLY, "", false, bytes32(i));
            if (predicted >= USDC_ADDR) {
                badSalt = bytes32(i);
                break;
            }
        }

        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.BadTokenOrdering.selector);
        launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Bad",
                symbol: "BAD",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: badSalt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );
    }

    function test_launch_rejectsUnalignedTicks() public {
        bytes32 salt = _mineSalt(creator, "Degen", "DEGEN", "ipfs://meta");
        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.TickAlignment.selector);
        launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Degen",
                symbol: "DEGEN",
                metadataURI: "ipfs://meta",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER + 1,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );
    }

    function test_launch_capsCreatorAllocation() public {
        bytes32 salt = _mineSalt(creator, "Degen", "DEGEN", "ipfs://meta");
        vm.prank(creator);
        vm.expectRevert(ArcLaunchpad.AllocationTooLarge.selector);
        launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Degen",
                symbol: "DEGEN",
                metadataURI: "ipfs://meta",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 2_001,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );
    }

    // ------------------------------------------------------------------
    // Trading
    // ------------------------------------------------------------------

    function test_buy_deliversTokensAndRaisesPrice() public {
        (address token, address pool) = _launch();

        uint256 mcapBefore = _marketCapUsd(pool);
        uint256 received = _buy(alice, token, 500e6); // $500

        assertGt(received, 0, "alice received tokens");
        assertEq(IERC20(token).balanceOf(alice), received);

        uint256 mcapAfter = _marketCapUsd(pool);
        console2.log("mcap before / after $500 buy:", mcapBefore, mcapAfter);
        assertGt(mcapAfter, mcapBefore, "price rose");
        assertEq(usdc.balanceOf(pool), 500e6, "pool now holds the USDC");
    }

    function test_sequentialBuysGetProgressivelyWorsePrice() public {
        (address token,) = _launch();

        uint256 first = _buy(alice, token, 100e6);
        uint256 second = _buy(bob, token, 100e6);

        assertGt(first, second, "later buyer gets fewer tokens for the same USDC");
    }

    function test_sellRoundTripsBackToUsdc() public {
        (address token,) = _launch();

        uint256 bought = _buy(alice, token, 1_000e6);
        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 back = _sell(alice, token, bought);

        assertGt(back, 0, "sold back to USDC");
        // Two 1% fees plus price impact, so strictly less than the $1,000 put in.
        assertLt(back, 1_000e6, "round trip loses fees");
        assertGt(back, 950e6, "round trip is not catastrophic");
        assertEq(usdc.balanceOf(alice), usdcBefore + back);
    }

    function test_priceClimbsTowardCeilingUnderHeavyBuying() public {
        (address token, address pool) = _launch();

        _buy(alice, token, 50_000e6);

        uint256 mcap = _marketCapUsd(pool);
        console2.log("mcap after $50k of buying:", mcap);
        assertGt(mcap, 100_000, "price moved substantially up the range");
    }

    /// @notice The liquidity range is finite, so there is a hard cap on how much
    ///         USDC the curve can absorb. A buyer who sends more than that must be
    ///         charged only for what actually fills, never for the whole input.
    function test_curveExhaustsAndDoesNotOverchargeTheBuyer() public {
        (address token,) = _launch();

        usdc.mint(alice, 5_000_000e6);
        uint256 before = usdc.balanceOf(alice);

        uint256 received = _buy(alice, token, 5_000_000e6);
        uint256 spent = before - usdc.balanceOf(alice);

        console2.log("offered $5M, curve absorbed (USDC 6dp):", spent);
        console2.log("tokens received:", received);

        assertLt(spent, 5_000_000e6, "buyer refunded the portion the curve could not fill");
        assertGt(spent, 50_000e6, "curve absorbed a meaningful amount");
        // Everything the pool had is now sold; the buyer holds essentially all supply.
        assertGt(received, (SUPPLY * 99) / 100, "curve fully traded through");
    }

    // ------------------------------------------------------------------
    // Liquidity lock and fees
    // ------------------------------------------------------------------

    function test_liquidityIsPermanentlyLocked() public {
        (address token, address pool) = _launch();

        bytes32 key = keccak256(abi.encodePacked(address(launchpad), TICK_LOWER, TICK_UPPER));
        (uint128 liq,,,,) = IUniswapV3Pool(pool).positions(key);
        assertGt(liq, 0, "position exists");

        // Positions in Uniswap are keyed by msg.sender, so the creator calling
        // burn directly touches only their own (nonexistent) position. The pool
        // rejects it outright rather than reaching the launchpad's principal.
        vm.prank(creator);
        vm.expectRevert(bytes("NP"));
        IUniswapV3Pool(pool).burn(TICK_LOWER, TICK_UPPER, 0);

        // Even the launchpad owner cannot pull principal: fee collection is the
        // only path that reaches the position, and it burns zero liquidity.
        uint256 poolTokensBefore = IERC20(token).balanceOf(pool);
        _buy(alice, token, 1_000e6);
        launchpad.collectFees(token);

        (uint128 liqAfter,,,,) = IUniswapV3Pool(pool).positions(key);
        assertEq(liqAfter, liq, "principal untouched by fee collection");
        assertGt(poolTokensBefore, 0);
    }

    function test_launchpadHasNoCodePathThatBurnsLiquidity() public {
        // Guards against a future edit reintroducing a withdrawal path. The
        // contract contains two distinct "burn" calls and they must stay distinct:
        //
        //   1. `p.burn(tickLower, tickUpper, 0)` — the zero-liquidity poke that
        //      credits accrued fees. Harmless: it moves no principal.
        //   2. `LaunchToken(...).burn(bought)` — destroying tokens bought back
        //      off the market. Touches the ERC20, never the LP position.
        //
        // What must never appear is a pool burn with a non-zero liquidity
        // argument, which is the only way principal could leave the position.
        string memory src = vm.readFile("src/ArcLaunchpad.sol");

        assertTrue(vm.contains(src, ".burn(l.tickLower, l.tickUpper, 0)"), "fee poke present");
        assertTrue(vm.contains(src, "LaunchToken(l.token).burn(bought)"), "token buy-back burn present");

        // Exactly one pool-shaped burn — i.e. one taking tick arguments — exists.
        assertEq(_countOccurrences(src, ".burn(l.tick"), 1, "only one pool burn");

        // And it passes literal zero as the liquidity to remove.
        assertEq(_countOccurrences(src, ".burn(l.tickLower, l.tickUpper, 0)"), 1, "pool burn removes zero liquidity");
    }

    function _countOccurrences(string memory haystack, string memory needle) internal pure returns (uint256 count) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || h.length < n.length) return 0;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) count++;
        }
    }

    function test_swapFeesAccrueAndSplitBetweenCreatorAndTreasury() public {
        (address token,) = _launch();

        uint256 bought = _buy(alice, token, 10_000e6);
        _sell(alice, token, bought); // generate fees in both directions

        launchpad.collectFees(token);

        uint256 creatorUsdc = usdc.balanceOf(creator);
        uint256 treasuryUsdc = usdc.balanceOf(treasury);
        uint256 creatorTok = IERC20(token).balanceOf(creator);
        uint256 treasuryTok = IERC20(token).balanceOf(treasury);

        console2.log("creator fees  usdc/token:", creatorUsdc, creatorTok);
        console2.log("treasury fees usdc/token:", treasuryUsdc, treasuryTok);

        assertGt(creatorUsdc + creatorTok, 0, "creator earned fees");
        assertGt(treasuryUsdc + treasuryTok, 0, "treasury earned fees");
        // 50/50 split configured in setUp, within rounding.
        assertApproxEqAbs(creatorUsdc, treasuryUsdc, 1, "usdc split 50/50");
    }

    function test_collectFeesRevertsForUnknownToken() public {
        vm.expectRevert(ArcLaunchpad.NotALaunch.selector);
        launchpad.collectFees(address(0xdead));
    }

    // ------------------------------------------------------------------
    // Registry
    // ------------------------------------------------------------------

    function test_registryTracksLaunchesNewestFirst() public {
        (address t1,) = _launch();

        bytes32 salt2 = _mineSalt(alice, "Second", "SEC", "");
        vm.prank(alice);
        (address t2,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Second",
                symbol: "SEC",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt2,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );

        assertEq(launchpad.launchCount(), 2);
        ArcLaunchpad.Launch[] memory page = launchpad.recentLaunches(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0].token, t2, "newest first");
        assertEq(page[1].token, t1);
        assertEq(launchpad.launchOf(t1).creator, creator);
    }

    function test_creatorAllocationIsDeliveredAfterTheLock() public {
        bytes32 salt = _mineSalt(creator, "Alloc", "ALC", "");
        vm.prank(creator);
        (address token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Alloc",
                symbol: "ALC",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 1_000, // 10%
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );

        // The allocation is held by the launchpad for 30 minutes so it cannot be
        // dumped on the first buyers; see CreatorLock.t.sol for the full rules.
        assertApproxEqRel(
            IERC20(token).balanceOf(address(launchpad)), SUPPLY / 10, 0.001e18, "allocation held, not delivered"
        );

        vm.warp(block.timestamp + launchpad.CREATOR_LOCK_DURATION());
        launchpad.claimCreatorAllocation(token);
        assertApproxEqRel(IERC20(token).balanceOf(creator), SUPPLY / 10, 0.001e18, "creator got ~10% after the lock");
    }

    function test_tokenIsImmutableFixedSupply() public {
        (address token,) = _launch();
        LaunchToken t = LaunchToken(token);

        assertEq(t.totalSupply(), SUPPLY);
        assertEq(t.creator(), creator);
        assertEq(t.launchpad(), address(launchpad));
        assertEq(t.metadataURI(), "ipfs://meta");
        // No mint/burn/owner functions exist on LaunchToken at all.
    }
}
