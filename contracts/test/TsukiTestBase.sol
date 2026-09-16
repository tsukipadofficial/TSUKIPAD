// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {TsukiCurve} from "../src/TsukiCurve.sol";
import {TsukiHook} from "../src/TsukiHook.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";
import {TokenDeployer} from "../src/TokenDeployer.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {HookMiner} from "../lib/v4-periphery/test/shared/HookMiner.sol";

/// @notice The v4 stack every suite needs: a pool manager, the tax hook mined to
///         the right address, both pads, and a router to trade through.
///
/// @dev Deploys a real PoolManager rather than mocking one. The pads' behaviour
///      is mostly the pool's behaviour, and a suite that stubs the pool proves
///      very little. `test/TsukiHookFork.t.sol` runs the same hook against the
///      manager Uniswap actually deployed on Arc.
///
///      The hook has to know both pads and both pads have to know the hook, so
///      the pads' addresses are predicted from this contract's nonce before the
///      hook is deployed with CREATE2 -- which consumes no nonce, leaving the
///      predictions intact.
abstract contract TsukiTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint24 constant FEE = 10_000; // 1%
    int24 constant TICK_SPACING = 200;

    uint160 constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

    PoolManager manager;
    TsukiHook hook;
    ArcLaunchpad launchpad;
    TsukiCurve curve;
    TsukiRouter router;
    TokenDeployer tokenDeployer;
    MockUSDC usdc;

    struct StackConfig {
        address treasury;
        address attestor;
        uint16 protocolFeeBps;
        uint256 launchFee;
        uint16 referralFeeBps;
        uint16 curveTradeFeeBps;
        uint256 curveGraduationUsdc;
        uint16 curveLpBps;
    }

    function _defaultConfig(address treasury_, address attestor_) internal pure returns (StackConfig memory c) {
        c.treasury = treasury_;
        c.attestor = attestor_;
        c.protocolFeeBps = 5_000;
        c.launchFee = 0;
        c.referralFeeBps = 0;
        c.curveTradeFeeBps = 100;
        c.curveGraduationUsdc = 9_350e6;
        c.curveLpBps = 1_798;
    }

    /// @dev Puts USDC at Arc's predeploy address and stands the whole stack up.
    function _deployStack(StackConfig memory c) internal {
        if (USDC_ADDR.code.length == 0) deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        manager = new PoolManager(address(this));
        tokenDeployer = new TokenDeployer();

        // Deploying the hook consumes a nonce even though CREATE2 does not use
        // one to derive its address, so the pads land one slot further along.
        uint256 nonce = vm.getNonce(address(this)) + 1;
        address predictedLaunchpad = vm.computeCreateAddress(address(this), nonce);
        address predictedCurve = vm.computeCreateAddress(address(this), nonce + 1);

        (, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(TsukiHook).creationCode,
            abi.encode(IPoolManager(address(manager)), predictedLaunchpad, predictedCurve)
        );
        hook = new TsukiHook{salt: salt}(IPoolManager(address(manager)), predictedLaunchpad, predictedCurve);

        launchpad = new ArcLaunchpad(
            USDC_ADDR,
            IPoolManager(address(manager)),
            hook,
            tokenDeployer,
            FEE,
            TICK_SPACING,
            c.treasury,
            c.protocolFeeBps,
            c.attestor,
            c.launchFee,
            c.referralFeeBps
        );
        require(address(launchpad) == predictedLaunchpad, "launchpad prediction");

        curve = new TsukiCurve(
            USDC_ADDR,
            IPoolManager(address(manager)),
            hook,
            tokenDeployer,
            FEE,
            TICK_SPACING,
            c.treasury,
            c.protocolFeeBps,
            c.curveTradeFeeBps,
            c.launchFee,
            c.curveGraduationUsdc,
            c.curveLpBps
        );
        require(address(curve) == predictedCurve, "curve prediction");

        router = new TsukiRouter(IPoolManager(address(manager)));
    }

    // ------------------------------------------------------------- helpers

    function _poolKey(address token) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(token),
            currency1: Currency.wrap(USDC_ADDR),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function _poolId(address token) internal view returns (PoolId) {
        return _poolKey(token).toId();
    }

    /// @dev Liquidity currently in a launch's pool.
    function _poolLiquidity(address token) internal view returns (uint128) {
        return IPoolManager(address(manager)).getLiquidity(_poolId(token));
    }

    /// @dev Spot price of a launch's pool, as sqrtPriceX96 and tick.
    function _slot0(address token) internal view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick,,) = IPoolManager(address(manager)).getSlot0(_poolId(token));
    }

    /// @dev What the pool holds. In v4 every pool's balances sit in the manager,
    ///      so this is the manager's reserve for that currency, not a per-pool
    ///      balance -- use it only where a single pool is in play.
    function _poolReserves(address token) internal view returns (uint256 tokenSide, uint256 usdcSide) {
        tokenSide = IERC20(token).balanceOf(address(manager));
        usdcSide = IERC20(USDC_ADDR).balanceOf(address(manager));
    }

    function _poolBuy(address who, address token, uint256 usdcIn) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(USDC_ADDR).approve(address(router), usdcIn);
        out = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: false,
                amountIn: usdcIn,
                amountOutMinimum: 0,
                recipient: who,
                deadline: block.timestamp + 600
            })
        );
        vm.stopPrank();
    }

    function _poolSell(address who, address token, uint256 tokensIn) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(token).approve(address(router), tokensIn);
        out = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: _poolKey(token),
                zeroForOne: true,
                amountIn: tokensIn,
                amountOutMinimum: 0,
                recipient: who,
                deadline: block.timestamp + 600
            })
        );
        vm.stopPrank();
    }
}
