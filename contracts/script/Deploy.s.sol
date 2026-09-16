// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {TsukiCurve} from "../src/TsukiCurve.sol";
import {TsukiHook} from "../src/TsukiHook.sol";
import {TsukiRouter} from "../src/TsukiRouter.sol";
import {TokenDeployer} from "../src/TokenDeployer.sol";
import {HookMiner} from "../lib/v4-periphery/test/shared/HookMiner.sol";
import {StateView} from "v4-periphery/lens/StateView.sol";
import {V4Quoter} from "v4-periphery/lens/V4Quoter.sol";

/// @notice Deploys the launchpad stack to Arc.
///
/// @dev The pads run on Uniswap v4, because the creator tax has to keep applying
///      after a launch graduates and only v4 can charge one inside the pool.
///      Uniswap deployed v4 on Arc mainnet; Arc testnet has no v4 at all, so
///      there the script deploys its own PoolManager to stage against.
///
///      The hook's address encodes its permissions, so it is deployed through
///      the CREATE2 proxy with a mined salt. Because the hook must know the two
///      pads and the two pads must know the hook, the pads' addresses are
///      predicted from the deployer's nonce before the hook goes out; CREATE2
///      does not consume a nonce, so the predictions hold.
///
/// Usage:
///   V4_POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951 \
///     forge script script/Deploy.s.sol:Deploy --rpc-url arc_mainnet --broadcast
contract Deploy is Script {
    /// @dev ERC20 interface to Arc's native USDC. Verified identical on mainnet
    ///      and testnet -- the entire token-ordering constraint rests on it.
    address constant USDC = 0x3600000000000000000000000000000000000000;

    uint256 constant ARC_TESTNET_CHAIN_ID = 5042002;

    /// @dev Foundry's CREATE2 deployer, which `new X{salt: ...}` routes through
    ///      when a script broadcasts from an EOA.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint24 constant POOL_FEE = 10_000; // 1%
    int24 constant TICK_SPACING = 200; // what the 1% tier uses on v3, kept for parity
    uint16 constant PROTOCOL_FEE_BPS = 3_000; // 30% of trade fees to treasury, 70% to creators
    uint16 constant REFERRAL_FEE_BPS = 1_000; // 10%, carved out of the protocol half
    uint256 constant LAUNCH_FEE = 0; // launching is free

    // Bonding curve. 1% on every curve trade, split with creators like pool
    // fees -- 70% creator, 30% treasury.
    //
    // The pair below is what puts a curve launch at the same ~$2.5K opening
    // market cap as a direct one and still graduates it at ~$52K. Both fall out
    // of the share held back for the pool: opening = G*f/(1-f)^2 and graduation
    // = G/f, so the ratio between them fixes f and the raise follows. Moving one
    // moves the other -- they are not independent knobs.
    uint16 constant CURVE_TRADE_FEE_BPS = 100;
    uint256 constant CURVE_GRADUATION_USDC = 9_350e6;
    uint16 constant CURVE_LP_BPS = 1_798;

    uint160 constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);
        // The launchpad has no owner, so these are fixed at deployment and can
        // never be changed afterwards. Getting them wrong means redeploying.
        address attestor = vm.envOr("ATTESTOR", deployer);

        console2.log("chainId :", block.chainid);
        console2.log("deployer:", deployer);
        console2.log("treasury:", treasury);

        // Guard rails for anything that is not the throwaway testnet.
        //
        // On testnet a deployer-owned treasury is convenient. On mainnet it
        // means protocol revenue accrues to whichever key happened to run the
        // deploy. Requiring an explicit, different treasury forces the
        // separation to be a deliberate decision rather than a default nobody
        // revisited -- and requiring Uniswap's own PoolManager keeps a mainnet
        // launch off a copy of v4 that this repo happened to deploy.
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            require(treasury != deployer, "set TREASURY to a wallet you control separately");
            require(treasury != address(0), "TREASURY unset");
            require(vm.envOr("V4_POOL_MANAGER", address(0)) != address(0), "set V4_POOL_MANAGER to Uniswap's own");
            console2.log("MAINNET DEPLOY");
        }

        vm.startBroadcast(pk);

        // --- pool manager -------------------------------------------------
        IPoolManager manager = IPoolManager(vm.envOr("V4_POOL_MANAGER", address(0)));
        address stateView = vm.envOr("V4_STATE_VIEW", address(0));
        address quoter = vm.envOr("V4_QUOTER", address(0));
        if (address(manager) == address(0)) {
            // Testnet only: Arc testnet has no Uniswap at all, so the whole
            // reading surface the site needs comes up with it.
            manager = IPoolManager(address(new PoolManager(deployer)));
            stateView = address(new StateView(manager));
            quoter = address(new V4Quoter(manager));
            console2.log("deployed PoolManager:", address(manager));
            console2.log("deployed StateView  :", stateView);
            console2.log("deployed V4Quoter   :", quoter);
        } else {
            console2.log("using PoolManager   :", address(manager));
        }

        // --- token deployer ----------------------------------------------
        // Deployed first and trusts nobody: it stamps its caller as the token's
        // pad, so only a pad can produce a token that answers to that pad.
        TokenDeployer tokenDeployer = new TokenDeployer();
        console2.log("TokenDeployer:", address(tokenDeployer));

        // --- hook, mined to carry its permissions in its address ----------
        // The hook goes out through the CREATE2 proxy, which still costs the
        // deployer a nonce -- it is a transaction like any other -- so the pads
        // land one slot further along than the raw nonce suggests.
        uint64 nonce = vm.getNonce(deployer) + 1;
        address predictedLaunchpad = vm.computeCreateAddress(deployer, nonce);
        address predictedCurve = vm.computeCreateAddress(deployer, nonce + 1);

        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            HOOK_FLAGS,
            type(TsukiHook).creationCode,
            abi.encode(manager, predictedLaunchpad, predictedCurve)
        );
        TsukiHook hook = new TsukiHook{salt: salt}(manager, predictedLaunchpad, predictedCurve);
        require(address(hook) == hookAddress, "hook address");

        // --- the pads -----------------------------------------------------
        ArcLaunchpad launchpad = new ArcLaunchpad(
            USDC,
            manager,
            hook,
            tokenDeployer,
            POOL_FEE,
            TICK_SPACING,
            treasury,
            PROTOCOL_FEE_BPS,
            attestor,
            LAUNCH_FEE,
            REFERRAL_FEE_BPS
        );
        require(address(launchpad) == predictedLaunchpad, "launchpad address drifted from the hook's");

        TsukiCurve curve = new TsukiCurve(
            USDC,
            manager,
            hook,
            tokenDeployer,
            POOL_FEE,
            TICK_SPACING,
            treasury,
            PROTOCOL_FEE_BPS,
            CURVE_TRADE_FEE_BPS,
            LAUNCH_FEE,
            CURVE_GRADUATION_USDC,
            CURVE_LP_BPS
        );
        require(address(curve) == predictedCurve, "curve address drifted from the hook's");

        TsukiRouter router = new TsukiRouter(manager);

        vm.stopBroadcast();

        console2.log("TsukiHook   :", address(hook));
        console2.log("ArcLaunchpad:", address(launchpad));
        console2.log("  treasury (permanent):", treasury);
        console2.log("  attestor (permanent):", attestor);
        console2.log("TsukiCurve  :", address(curve));
        console2.log("TsukiRouter :", address(router));

        _writeDeployment(
            Addresses({
                manager: address(manager),
                stateView: stateView,
                quoter: quoter,
                hook: address(hook),
                tokenDeployer: address(tokenDeployer),
                launchpad: address(launchpad),
                router: address(router),
                curve: address(curve),
                treasury: treasury
            })
        );
    }

    struct Addresses {
        address manager;
        address stateView;
        address quoter;
        address hook;
        address tokenDeployer;
        address launchpad;
        address router;
        address curve;
        address treasury;
    }

    /// @dev Emit a JSON the frontend reads directly, so addresses are never hand-copied.
    function _writeDeployment(Addresses memory a) internal {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "usdc": "', vm.toString(USDC), '",\n',
            '  "poolManager": "', vm.toString(a.manager), '",\n',
            '  "stateView": "', vm.toString(a.stateView), '",\n',
            '  "quoter": "', vm.toString(a.quoter), '",\n',
            '  "hook": "', vm.toString(a.hook), '",\n',
            '  "tokenDeployer": "', vm.toString(a.tokenDeployer), '",\n',
            '  "launchpad": "', vm.toString(a.launchpad), '",\n',
            '  "swapRouter": "', vm.toString(a.router), '",\n',
            '  "curve": "', vm.toString(a.curve), '",\n',
            '  "treasury": "', vm.toString(a.treasury), '",\n',
            '  "poolFee": ', vm.toString(uint256(POOL_FEE)), ",\n",
            '  "tickSpacing": ', vm.toString(int256(TICK_SPACING)), "\n",
            "}\n"
        );

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console2.log("wrote", path);
    }
}
