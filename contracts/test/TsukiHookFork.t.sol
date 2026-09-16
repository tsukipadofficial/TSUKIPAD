// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

import {TsukiHook} from "../src/TsukiHook.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {HookMiner} from "../lib/v4-periphery/test/shared/HookMiner.sol";

/// @notice Proves the creator tax works inside a real Uniswap v4 pool, against
///         the PoolManager Uniswap actually deployed on Arc.
///
/// @dev Runs against a local fork (`anvil --fork-url https://rpc.mainnet.arc.io`)
///      because v4 exists on Arc mainnet and not on Arc testnet:
///
///        forge test --match-path test/TsukiHookFork.t.sol --fork-url http://127.0.0.1:8547
///
///      Skips itself when no fork is present, so `forge test` stays green offline.
contract TsukiHookForkTest is Test {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    uint24 constant FEE = 10_000; // 1%, same tier the pads use today
    int24 constant TICK_SPACING = 200;
    uint16 constant TAX_BPS = 1_000; // 10%, the cap

    TsukiHook hook;
    MockUSDC usdc; // stands in for Arc's predeploy, see setUp
    MockUSDC token;
    PoolKey key;
    PoolSwapTest swapper;
    PoolModifyLiquidityTest liquidity;

    address creator = address(0xC0FFEE);
    address trader = address(0xBEEF);

    function setUp() public {
        if (address(PM).code.length == 0) return; // not forked; every test no-ops

        // Two plain ERC20s rather than Arc's native-USDC predeploy: this test is
        // about the hook's accounting, and the predeploy's 18/6-decimal dual
        // representation would only add noise. The pad's real pools pair against
        // that predeploy, which is a standard ERC20 at this interface.
        MockUSDC a = new MockUSDC();
        MockUSDC b = new MockUSDC();
        (token, usdc) = address(a) < address(b) ? (a, b) : (b, a);

        (address hookAddr, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG),
            type(TsukiHook).creationCode,
            abi.encode(PM, address(this), address(this))
        );
        hook = new TsukiHook{salt: salt}(PM, address(this), address(this));
        assertEq(address(hook), hookAddr, "mined address");

        key = PoolKey({
            currency0: Currency.wrap(address(token)),
            currency1: Currency.wrap(address(usdc)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        hook.register(key, creator, TAX_BPS);
        PM.initialize(key, TickMath.getSqrtPriceAtTick(0));

        swapper = new PoolSwapTest(PM);
        liquidity = new PoolModifyLiquidityTest(PM);

        token.mint(address(this), 1_000_000e18);
        usdc.mint(address(this), 1_000_000e18);
        token.approve(address(liquidity), type(uint256).max);
        usdc.approve(address(liquidity), type(uint256).max);
        liquidity.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -TICK_SPACING * 100,
                tickUpper: TICK_SPACING * 100,
                liquidityDelta: 100_000e18,
                salt: bytes32(0)
            }),
            ""
        );

        token.mint(trader, 100_000e18);
        usdc.mint(trader, 100_000e18);
        vm.startPrank(trader);
        token.approve(address(swapper), type(uint256).max);
        usdc.approve(address(swapper), type(uint256).max);
        vm.stopPrank();
    }

    function _swap(bool zeroForOne, int256 amountSpecified) internal returns (BalanceDelta) {
        vm.prank(trader);
        return swapper.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function test_buyIsTaxedInTheToken() public {
        if (address(PM).code.length == 0) return;

        uint256 before = token.balanceOf(trader);
        _swap(false, -1_000e18); // USDC in, token out
        uint256 received = token.balanceOf(trader) - before;

        uint256 taken = hook.owed(key.toId(), key.currency0);
        assertGt(taken, 0, "tax taken on the token side");
        // The trader keeps the rest: tax is 10% of what the pool paid out.
        assertApproxEqRel(taken, (received + taken) / 10, 1e15, "10% of the output");
        assertEq(hook.owed(key.toId(), key.currency1), 0, "nothing taken in USDC");
        assertEq(token.balanceOf(address(hook)), taken, "hook actually holds it");
    }

    function test_sellIsTaxedInUsdc() public {
        if (address(PM).code.length == 0) return;

        uint256 before = usdc.balanceOf(trader);
        _swap(true, -1_000e18); // token in, USDC out
        uint256 received = usdc.balanceOf(trader) - before;

        uint256 taken = hook.owed(key.toId(), key.currency1);
        assertGt(taken, 0, "tax taken on the USDC side");
        assertApproxEqRel(taken, (received + taken) / 10, 1e15, "10% of the output");
        assertEq(usdc.balanceOf(address(hook)), taken, "hook actually holds it");
    }

    function test_bothSidesTaxedUnlikeAnyV3Workaround() public {
        if (address(PM).code.length == 0) return;

        _swap(false, -1_000e18);
        _swap(true, -1_000e18);
        assertGt(hook.owed(key.toId(), key.currency0), 0, "buy taxed");
        assertGt(hook.owed(key.toId(), key.currency1), 0, "sell taxed");
    }

    function test_claimPaysTheCreator() public {
        if (address(PM).code.length == 0) return;

        _swap(false, -1_000e18);
        _swap(true, -1_000e18);
        uint256 t = hook.owed(key.toId(), key.currency0);
        uint256 u = hook.owed(key.toId(), key.currency1);

        hook.claim(key); // permissionless, always pays the recorded creator
        assertEq(token.balanceOf(creator), t, "token tax paid out");
        assertEq(usdc.balanceOf(creator), u, "usdc tax paid out");
        assertEq(hook.owed(key.toId(), key.currency0), 0, "balance cleared");
        assertEq(hook.owed(key.toId(), key.currency1), 0, "balance cleared");
    }

    function test_exactOutputIsTaxedToo() public {
        if (address(PM).code.length == 0) return;

        _swap(false, 500e18); // ask for exactly 500 token out
        assertGt(hook.owed(key.toId(), key.currency1), 0, "tax on the input side");
    }

    function test_untaxedPoolChargesNothing() public {
        if (address(PM).code.length == 0) return;

        MockUSDC a = new MockUSDC();
        MockUSDC b = new MockUSDC();
        (MockUSDC t0, MockUSDC t1) = address(a) < address(b) ? (a, b) : (b, a);
        PoolKey memory free = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        hook.register(free, creator, 0);
        PM.initialize(free, TickMath.getSqrtPriceAtTick(0));

        t0.mint(address(this), 1_000_000e18);
        t1.mint(address(this), 1_000_000e18);
        t0.approve(address(liquidity), type(uint256).max);
        t1.approve(address(liquidity), type(uint256).max);
        liquidity.modifyLiquidity(
            free,
            ModifyLiquidityParams({
                tickLower: -TICK_SPACING * 100,
                tickUpper: TICK_SPACING * 100,
                liquidityDelta: 100_000e18,
                salt: bytes32(0)
            }),
            ""
        );

        t1.mint(trader, 10_000e18);
        vm.startPrank(trader);
        t1.approve(address(swapper), type(uint256).max);
        swapper.swap(
            free,
            SwapParams({zeroForOne: false, amountSpecified: -1_000e18, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();

        assertEq(hook.owed(free.toId(), free.currency0), 0, "no tax when none was set");
    }

    function test_strangersCannotRegisterOrOverwrite() public {
        if (address(PM).code.length == 0) return;

        vm.expectRevert(TsukiHook.AlreadyRegistered.selector);
        hook.register(key, address(0xBAD), 0);

        MockUSDC a = new MockUSDC();
        MockUSDC b = new MockUSDC();
        PoolKey memory other = PoolKey({
            currency0: Currency.wrap(address(a) < address(b) ? address(a) : address(b)),
            currency1: Currency.wrap(address(a) < address(b) ? address(b) : address(a)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        vm.prank(address(0xBAD));
        vm.expectRevert(TsukiHook.NotALauncher.selector);
        hook.register(other, address(0xBAD), TAX_BPS);

        // And an unregistered pool cannot even be initialized with this hook.
        vm.expectRevert();
        PM.initialize(other, TickMath.getSqrtPriceAtTick(0));
    }

    function test_taxAboveTheCapIsRefused() public {
        if (address(PM).code.length == 0) return;

        MockUSDC a = new MockUSDC();
        MockUSDC b = new MockUSDC();
        PoolKey memory other = PoolKey({
            currency0: Currency.wrap(address(a) < address(b) ? address(a) : address(b)),
            currency1: Currency.wrap(address(a) < address(b) ? address(b) : address(a)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        vm.expectRevert(TsukiHook.TaxTooHigh.selector);
        hook.register(other, creator, 1_001);
    }
}
