// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
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
import {CurveToken} from "../src/CurveToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {HookMiner} from "../lib/v4-periphery/test/shared/HookMiner.sol";

/// @notice Graduation, against the Uniswap v4 PoolManager actually deployed on
///         Arc mainnet rather than one this repo compiled.
///
/// @dev The unit suite deploys its own PoolManager from Uniswap's source. That
///      proves the logic but not the deployment: Arc's PoolManager is 24,010
///      bytes where a local build of the same source is 17,111, so it was built
///      from different settings or a different release. This drives a launch all
///      the way through graduation against the real thing.
///
///      USDC is replaced with a plain ERC20 at the same address. Arc's USDC is a
///      view over the native balance maintained by the node, so its transfers do
///      not execute inside a forked EVM at all -- `balanceOf` reports a funded
///      account and `transfer` then reverts with no reason. Nothing here depends
///      on which ERC20 sits at that address, only that it is the higher of the
///      pair, which is exactly what the launch tokens are mined against.
///
///   anvil --port 8547 --fork-url https://rpc.mainnet.arc.io
///   forge test --match-path test/GraduationFork.t.sol --fork-url http://127.0.0.1:8547
contract GraduationForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    uint24 constant FEE = 10_000;
    int24 constant TICK_SPACING = 200;

    TsukiHook hook;
    TsukiCurve curve;
    ArcLaunchpad launchpad;
    TsukiRouter router;
    TokenDeployer tokenDeployer;
    MockUSDC usdc;

    address creator = makeAddr("creator");
    address whale = makeAddr("whale");
    address treasury = makeAddr("treasury");

    function setUp() public {
        if (address(PM).code.length == 0) return; // not forked; every test no-ops

        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);
        tokenDeployer = new TokenDeployer();

        uint256 nonce = vm.getNonce(address(this)) + 1;
        address predictedLaunchpad = vm.computeCreateAddress(address(this), nonce);
        address predictedCurve = vm.computeCreateAddress(address(this), nonce + 1);
        (, bytes32 salt) = HookMiner.find(
            address(this),
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG),
            type(TsukiHook).creationCode,
            abi.encode(PM, predictedLaunchpad, predictedCurve)
        );
        hook = new TsukiHook{salt: salt}(PM, predictedLaunchpad, predictedCurve);

        launchpad = new ArcLaunchpad(
            USDC_ADDR, PM, hook, tokenDeployer, FEE, TICK_SPACING, treasury, 3_000, address(this), 0, 0
        );
        curve = new TsukiCurve(USDC_ADDR, PM, hook, tokenDeployer, FEE, TICK_SPACING, treasury, 3_000, 100, 0, 9_350e6, 1_798);
        require(address(launchpad) == predictedLaunchpad && address(curve) == predictedCurve, "prediction");
        router = new TsukiRouter(PM);

        usdc.mint(creator, 1_000e6);
        usdc.mint(whale, 100_000e6);
        vm.prank(creator);
        usdc.approve(address(curve), type(uint256).max);
        vm.prank(whale);
        usdc.approve(address(curve), type(uint256).max);
        vm.warp(1_000_000);
    }

    function test_curveGraduatesIntoArcsOwnPoolManager() public {
        if (address(PM).code.length == 0) return;

        // --- launch, with the tax at the cap so the pool inherits it ---------
        TsukiCurve.LaunchParams memory p;
        p.name = "Fork Moon";
        p.symbol = "FMOON";
        p.metadataURI = "ipfs://fork";
        p.creatorTaxBps = 1_000;
        for (uint256 i = 0; i < 20_000; i++) {
            if (curve.predictTokenAddress(creator, p.name, p.symbol, p.metadataURI, false, bytes32(i)) < USDC_ADDR) {
                p.salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        address token = curve.launch(p);
        vm.warp(vm.getBlockTimestamp() + 10);

        // --- buy it out --------------------------------------------------
        vm.prank(whale);
        curve.buy(token, 20_000e6, 0, whale);

        TsukiCurve.Curve memory c = curve.curveOf(token);
        assertTrue(c.graduated, "graduated");
        assertTrue(CurveToken(token).graduated(), "transfers open");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token),
            currency1: Currency.wrap(USDC_ADDR),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        assertEq(PoolId.unwrap(c.pool), PoolId.unwrap(key.toId()), "pool id");

        // --- the pool Uniswap's own manager now holds ---------------------
        (uint160 sqrtPriceX96,,,) = PM.getSlot0(key.toId());
        assertGt(sqrtPriceX96, 0, "pool initialised in the real manager");
        // Squaring first and shifting once keeps the fraction: at these prices
        // sqrtPriceX96^2 >> 192 on its own truncates to zero. 1e21 carries the
        // 12-decimal gap between the token and USDC plus the 1e9 supply.
        uint256 mcap = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96) * 1e21) >> 192;
        console2.log("graduation market cap (USD):", mcap);
        assertGt(mcap, 51_000, "opens around $52K");
        assertLt(mcap, 53_000, "opens around $52K");

        assertGt(PM.getLiquidity(key.toId()), 0, "liquidity is in the pool");
        assertGt(usdc.balanceOf(address(PM)), 9_349e6, "the raise is in the manager");
        assertEq(IERC20(token).balanceOf(address(curve)), 0, "curve kept nothing");

        // --- and it trades, with the tax still applying -------------------
        uint256 taxBefore = hook.owed(key.toId(), key.currency1);
        vm.startPrank(whale);
        usdc.approve(address(router), type(uint256).max);
        uint256 bought = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: key,
                zeroForOne: false,
                amountIn: 500e6,
                amountOutMinimum: 0,
                recipient: whale,
                deadline: block.timestamp + 600
            })
        );
        assertGt(bought, 0, "buy works in the graduated pool");
        uint256 taxTaken = hook.owed(key.toId(), key.currency1) - taxBefore;
        assertEq(taxTaken, 50e6, "10% of the 500 USDC spent, in USDC");

        IERC20(token).approve(address(router), bought);
        uint256 usdcBack = router.exactInputSingle(
            TsukiRouter.ExactInputSingleParams({
                key: key,
                zeroForOne: true,
                amountIn: bought,
                amountOutMinimum: 0,
                recipient: whale,
                deadline: block.timestamp + 600
            })
        );
        vm.stopPrank();
        assertGt(usdcBack, 0, "sell works in the graduated pool");
        assertGt(hook.owed(key.toId(), key.currency1), taxTaken, "and the sell is taxed too");

        // --- fees reach the creator, principal does not move --------------
        uint128 liqBefore = PM.getLiquidity(key.toId());
        curve.collectFees(token);
        assertEq(PM.getLiquidity(key.toId()), liqBefore, "locked liquidity untouched");
        assertGt(curve.creatorFeesOwed(token), 0, "pool fees owed to the creator");
    }
}
