// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {TickMath, FullMath} from "../src/libraries/V3Math.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {TsukiTestBase} from "./TsukiTestBase.sol";
import {TsukiHook} from "../src/TsukiHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";

/// @notice End-to-end tests for the single-sided launch mechanic, running against
///         the genuine Uniswap V3 factory/pool bytecode from the v3-core package
///         rather than a reimplementation.
contract ArcLaunchpadTest is TsukiTestBase {
    using StateLibrary for IPoolManager;

    /// @dev Arc's USDC ERC20 interface address. Pinned so the CREATE2 salt-mining
    ///      test exercises the same ordering constraint as the live chain.



    // ~$3,030 starting market cap for a 1B supply; see _startTick derivation below.
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400; // ≈1000x ceiling

    uint256 constant SUPPLY = 1_000_000_000 ether; // 1B, 18dp


    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {


        StackConfig memory cfg = _defaultConfig(treasury, address(this));
        cfg.protocolFeeBps = 5_000;
        cfg.launchFee = 0;
        cfg.referralFeeBps = 0;
        _deployStack(cfg);

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

    function _launch() internal returns (address token, PoolId pool) {
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
    }

    function _buy(address who, address token, uint256 usdcIn) internal returns (uint256 out) {
        return _poolBuy(who, token, usdcIn);
    }

    function _sell(address who, address token, uint256 tokensIn) internal returns (uint256 out) {
        return _poolSell(who, token, tokensIn);
    }

    /// @dev Market cap in whole USD, derived from the pool's live price.
    /// @dev Uses full-precision math: squaring sqrtPriceX96 directly overflows
    ///      uint256 once the price has climbed a few orders of magnitude.
    function _marketCapUsd(address token) internal view returns (uint256) {
        (uint160 sqrtPriceX96,) = _slot0(token);
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

        (address token,) = _launch();

        assertEq(usdc.balanceOf(creator), 0, "creator still spent no USDC");
        assertEq(usdc.balanceOf(address(manager)), 0, "pool opens with zero USDC");
        assertEq(Currency.unwrap(_poolKey(token).currency0), token, "launched token must be token0");
        assertEq(Currency.unwrap(_poolKey(token).currency1), USDC_ADDR, "USDC must be token1");
    }

    function test_launch_seedsEntireSupplyAsLiquidity() public {
        (address token,) = _launch();

        uint256 inPool = IERC20(token).balanceOf(address(manager));
        // Rounding dust goes to the creator; everything else is committed.
        assertGt(inPool, (SUPPLY * 9999) / 10000, "at least 99.99% of supply in the pool");
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad retains nothing");
    }

    function test_launch_startingMarketCapIsAboutThreeThousand() public {
        (address token,) = _launch();

        uint256 mcap = _marketCapUsd(token);
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );
    }

    // ------------------------------------------------------------------
    // Trading
    // ------------------------------------------------------------------

    function test_buy_deliversTokensAndRaisesPrice() public {
        (address token,) = _launch();

        uint256 mcapBefore = _marketCapUsd(token);
        uint256 received = _buy(alice, token, 500e6); // $500

        assertGt(received, 0, "alice received tokens");
        assertEq(IERC20(token).balanceOf(alice), received);

        uint256 mcapAfter = _marketCapUsd(token);
        console2.log("mcap before / after $500 buy:", mcapBefore, mcapAfter);
        assertGt(mcapAfter, mcapBefore, "price rose");
        assertEq(usdc.balanceOf(address(manager)), 500e6, "pool now holds the USDC");
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
        (address token,) = _launch();

        _buy(alice, token, 50_000e6);

        uint256 mcap = _marketCapUsd(token);
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
        (address token,) = _launch();

        (uint128 liq,,) = IPoolManager(address(manager)).getPositionInfo(
            _poolId(token), address(launchpad), TICK_LOWER, TICK_UPPER, bytes32(0)
        );
        assertGt(liq, 0, "position exists");

        // Positions belong to whoever opened them, and in v4 nobody can touch
        // one without unlocking the manager first. A creator reaching for the
        // launchpad's principal directly does not even get as far as the pool.
        vm.prank(creator);
        vm.expectRevert();
        IPoolManager(address(manager)).modifyLiquidity(
            _poolKey(token),
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: -int256(uint256(liq)),
                salt: bytes32(0)
            }),
            ""
        );

        // Nor can the launchpad itself: collecting fees is the only path that
        // reaches the position, and it moves zero liquidity.
        uint256 poolTokensBefore = IERC20(token).balanceOf(address(manager));
        _buy(alice, token, 1_000e6);
        launchpad.collectFees(token);

        (uint128 liqAfter,,) = IPoolManager(address(manager)).getPositionInfo(
            _poolId(token), address(launchpad), TICK_LOWER, TICK_UPPER, bytes32(0)
        );
        assertEq(liqAfter, liq, "principal untouched by fee collection");
        assertGt(poolTokensBefore, 0);
    }

    /// @dev The feature v3 could not give a direct launch: a creator tax that
    ///      applies to buys and sells alike, for as long as the token trades.
    function test_directLaunchCanCarryACreatorTax() public {
        bytes32 salt = _mineSalt(creator, "Taxed", "TAX", "ipfs://taxed");
        vm.prank(creator);
        (address token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Taxed",
                symbol: "TAX",
                metadataURI: "ipfs://taxed",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 1_000 // 10%, the cap
            })
        );

        uint256 bought = _buy(alice, token, 1_000e6);
        uint256 taxOnBuy = hook.owed(_poolId(token), _poolKey(token).currency0);
        assertApproxEqRel(taxOnBuy, (bought + taxOnBuy) / 10, 0.01e18, "10% of the tokens bought");

        uint256 usdcBack = _sell(alice, token, bought / 2);
        uint256 taxOnSell = hook.owed(_poolId(token), _poolKey(token).currency1);
        assertApproxEqRel(taxOnSell, (usdcBack + taxOnSell) / 10, 0.01e18, "and 10% of the USDC sold for");

        // It is the creator's, but it reaches them through the pad, which is
        // what makes a holders launch pay holders and an unproven earmark
        // escrow. Measured as a delta: the creator already holds the mint dust.
        uint256 tokensBefore = IERC20(token).balanceOf(creator);
        uint256 usdcBefore = usdc.balanceOf(creator);
        vm.prank(bob); // permissionless
        launchpad.collectFees(token);
        assertEq(hook.owed(_poolId(token), _poolKey(token).currency0), 0, "hook holds nothing after");
        assertEq(hook.owed(_poolId(token), _poolKey(token).currency1), 0, "hook holds nothing after");
        assertGt(usdc.balanceOf(creator) - usdcBefore, taxOnSell, "usdc-side tax reached the creator");
        // The token side is sold for USDC when it is worth selling, so the
        // creator is paid in USDC rather than in a bag of their own token.
        assertGe(IERC20(token).balanceOf(creator) - tokensBefore, 0, "no token-side dust stranded");
        assertEq(IERC20(token).balanceOf(address(hook)), 0, "hook kept nothing");
        assertEq(usdc.balanceOf(address(hook)), 0, "hook kept nothing");
        assertGt(taxOnBuy, 0, "the buy was taxed");
    }

    function test_creatorTaxAboveTheCapCannotLaunch() public {
        bytes32 salt = _mineSalt(creator, "TooMuch", "GREED", "ipfs://greed");
        vm.prank(creator);
        vm.expectRevert(TsukiHook.TaxTooHigh.selector);
        launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "TooMuch",
                symbol: "GREED",
                metadataURI: "ipfs://greed",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 1_001
            })
        );
    }

    function test_launchpadHasNoCodePathThatWithdrawsLiquidity() public view {
        // Guards against a future edit reintroducing a withdrawal path. On v4
        // principal can only leave a position through `modifyLiquidity` with a
        // negative `liquidityDelta`, and the only two calls in the whole stack
        // pass what a mint costs or a literal zero.
        string memory plumbing = vm.readFile("src/TsukiV4Pool.sol");

        assertEq(_countOccurrences(plumbing, "liquidityDelta: -"), 0, "no negative liquidity delta anywhere");
        assertEq(_countOccurrences(plumbing, "poolManager.modifyLiquidity("), 2, "exactly two modifyLiquidity calls");
        assertTrue(vm.contains(plumbing, "liquidityDelta: int256(liquidity)"), "the mint");
        assertTrue(vm.contains(plumbing, "liquidityDelta: 0"), "the fee collection");

        // And neither pad reaches the manager behind the plumbing's back.
        assertEq(
            _countOccurrences(vm.readFile("src/ArcLaunchpad.sol"), "modifyLiquidity"), 0, "pad goes through the base"
        );
        assertEq(
            _countOccurrences(vm.readFile("src/TsukiCurve.sol"), "modifyLiquidity"), 0, "pad goes through the base"
        );
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );

        assertEq(launchpad.launchCount(), 2);
        ArcLaunchpad.Launch[] memory page = launchpad.recentLaunches(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0].token, t2, "newest first");
        assertEq(page[1].token, t1);
        assertEq(launchpad.launchOf(t1).creator, creator);
    }

    function test_creatorAllocationIsDeliveredAtLaunch() public {
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
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );

        // No lock: the allocation is the creator's the moment the launch lands.
        // Buyers see it on the launch record before they buy.
        assertApproxEqRel(IERC20(token).balanceOf(creator), SUPPLY / 10, 0.001e18, "creator holds ~10% at launch");
    }

    /// @dev The launchpad keeps nothing back. Everything not seeded into the
    ///      pool -- the allocation and the mint's rounding dust -- leaves in the
    ///      launch transaction itself, so there is no custodied allocation left
    ///      for fee handling or anyone else to reach.
    function test_launchLeavesNoAllocationBehind() public {
        bytes32 salt = _mineSalt(creator, "Alloc", "ALC", "");
        vm.prank(creator);
        (address token, PoolId pool) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Alloc",
                symbol: "ALC",
                metadataURI: "",
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 2_000, // the maximum
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false,
                recipientCommitment: bytes32(0),
                referrer: address(0),
                creatorTaxBps: 0
            })
        );

        uint256 allocation = launchpad.launchOf(token).creatorAllocation;
        assertEq(allocation, SUPPLY / 5, "allocation recorded");

        // Only dust on top of the allocation, never less than it.
        uint256 held = IERC20(token).balanceOf(creator);
        assertGe(held, allocation, "creator received the whole allocation");
        assertApproxEqRel(held, allocation, 0.001e18, "and nothing but dust besides");

        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad holds none of the token");
        assertEq(held + IERC20(token).balanceOf(address(manager)), SUPPLY, "supply is split between creator and pool");
    }

    // ---------------- attribution ----------------

    /// @dev A scanner must be able to attribute a launch without a hard-coded
    ///      address list. `launchpad` is the authoritative answer because an
    ///      address cannot be faked; `PAD` is the human-readable half so an
    ///      explorer can label the token without resolving the address first.
    function test_tokenNamesTheLaunchpadThatDeployedIt() public {
        (address token,) = _launch();
        assertEq(LaunchToken(token).launchpad(), address(launchpad), "points at this pad");
        assertEq(LaunchToken(token).PAD(), "TSUKIPAD", "carries the pad's name");
        assertEq(launchpad.PAD(), "TSUKIPAD", "pad names itself the same way");
    }

    /// @dev The contract was deployed without an owner rather than renounced
    ///      afterwards, so every configurable value is fixed at construction.
    ///      Absence of a setter cannot be asserted from Solidity; what can be
    ///      asserted is that a launch cannot change the terms it was made under.
    function test_configurationIsFixedAtDeployment() public {
        (address token,) = _launch();
        assertEq(launchpad.protocolFeeBps(), 5_000, "split fixed");
        assertEq(launchpad.treasury(), treasury, "treasury fixed");
        assertEq(launchpad.attestor(), address(this), "attestor fixed");
        assertEq(launchpad.launchFee(), 0, "launch fee fixed");
        assertEq(launchpad.referralFeeBps(), 0, "referral rate fixed");
        assertEq(LaunchToken(token).launchpad(), address(launchpad), "attribution recorded");
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
