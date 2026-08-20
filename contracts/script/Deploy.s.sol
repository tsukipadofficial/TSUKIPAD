// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";

/// @notice Deploys the launchpad stack to Arc.
///
/// @dev Arc testnet has no Uniswap deployment, so this script also deploys the
///      official V3 factory bytecode (GPL-2.0 since the BUSL grant expired in
///      April 2023). On Arc mainnet, where canonical Uniswap ships day one, set
///      `V3_FACTORY` in the environment and the script will reuse it instead of
///      deploying a second, non-canonical factory.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    /// @dev ERC20 interface to Arc's native USDC. Expected to be identical on
    ///      mainnet, but verify before deploying: the entire token-ordering
    ///      constraint is derived from this address.
    address constant USDC = 0x3600000000000000000000000000000000000000;

    uint256 constant ARC_TESTNET_CHAIN_ID = 5042002;

    string constant FACTORY_ARTIFACT =
        "tools/node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

    uint24 constant POOL_FEE = 10_000; // 1%
    uint16 constant PROTOCOL_FEE_BPS = 5_000; // half of swap fees to treasury

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);

        console2.log("chainId :", block.chainid);
        console2.log("deployer:", deployer);
        console2.log("treasury:", treasury);

        // Guard rails for anything that is not the throwaway testnet.
        //
        // On testnet a deployer-owned treasury is convenient. On mainnet it
        // means protocol revenue accrues to whichever key happened to run the
        // deploy — and that key also owns the launchpad. Requiring an explicit,
        // different treasury forces the separation to be a deliberate decision
        // rather than a default nobody revisited.
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            require(treasury != deployer, "set TREASURY to a wallet you control separately");
            require(treasury != address(0), "TREASURY unset");
            require(
                vm.envOr("V3_FACTORY", address(0)) != address(0),
                "set V3_FACTORY to Uniswap's canonical factory on mainnet"
            );
            console2.log("MAINNET DEPLOY - transfer ownership after this completes");
        }

        vm.startBroadcast(pk);

        // --- Uniswap V3 factory ------------------------------------------
        address factory = vm.envOr("V3_FACTORY", address(0));
        if (factory == address(0)) {
            bytes memory code = vm.getCode(FACTORY_ARTIFACT);
            assembly {
                factory := create(0, add(code, 0x20), mload(code))
            }
            require(factory != address(0), "factory deploy failed");
            console2.log("deployed UniswapV3Factory:", factory);
        } else {
            console2.log("reusing UniswapV3Factory:", factory);
        }

        require(IUniswapV3Factory(factory).feeAmountTickSpacing(POOL_FEE) != 0, "fee tier unavailable");

        // --- launchpad stack ---------------------------------------------
        ArcLaunchpad launchpad = new ArcLaunchpad(USDC, factory, POOL_FEE, treasury, PROTOCOL_FEE_BPS);
        ArcSwapRouter router = new ArcSwapRouter(factory);

        vm.stopBroadcast();

        console2.log("ArcLaunchpad:", address(launchpad));
        console2.log("ArcSwapRouter:", address(router));

        _writeDeployment(factory, address(launchpad), address(router), treasury);
    }

    /// @dev Emit a JSON the frontend reads directly, so addresses are never hand-copied.
    function _writeDeployment(address factory, address launchpad, address router, address treasury) internal {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "usdc": "', vm.toString(USDC), '",\n',
            '  "v3Factory": "', vm.toString(factory), '",\n',
            '  "launchpad": "', vm.toString(launchpad), '",\n',
            '  "swapRouter": "', vm.toString(router), '",\n',
            '  "treasury": "', vm.toString(treasury), '",\n',
            '  "poolFee": ', vm.toString(uint256(POOL_FEE)), "\n",
            "}\n"
        );

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console2.log("wrote", path);
    }
}
