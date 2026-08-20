// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";
import {FullMath} from "../src/libraries/V3Math.sol";

/// @notice Launches a demo token and buys some of it, as a live smoke test.
/// @dev Run against a fork or testnet once Deploy.s.sol has been broadcast:
///        LAUNCHPAD=0x.. ROUTER=0x.. PRIVATE_KEY=0x.. \
///        forge script script/LaunchDemo.s.sol:LaunchDemo --rpc-url ... --broadcast
contract LaunchDemo is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint24 constant FEE = 10_000;

    int24 constant TICK_LOWER = -403_400; // ~$3.0k start on a 1B supply
    int24 constant TICK_UPPER = -334_400; // ~1000x ceiling
    uint256 constant SUPPLY = 1_000_000_000 ether;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        ArcLaunchpad launchpad = ArcLaunchpad(vm.envAddress("LAUNCHPAD"));
        ArcSwapRouter router = ArcSwapRouter(vm.envAddress("ROUTER"));

        string memory name = "Arc Doge";
        string memory symbol = "ADOGE";
        string memory uri = "ipfs://demo";

        // Mine a salt so the token sorts below USDC (becomes token0).
        bytes32 salt;
        for (uint256 i = 0; i < 10_000; i++) {
            if (launchpad.predictTokenAddress(me, name, symbol, SUPPLY, uri, false, bytes32(i)) < USDC) {
                salt = bytes32(i);
                break;
            }
        }
        console2.log("mined salt:", uint256(salt));

        vm.startBroadcast(pk);

        (address token, address pool) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: name,
                symbol: symbol,
                metadataURI: uri,
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: 0,
                rewardHolders: false,
                feeRecipient: address(0),
                buybackAndBurn: false
            })
        );

        console2.log("token:", token);
        console2.log("pool: ", pool);
        console2.log("start mcap (USD):", _mcap(pool));

        // Buy $250 worth.
        uint256 spend = 250e6;
        IERC20(USDC).approve(address(router), spend);
        uint256 out = router.exactInputSingle(
            ArcSwapRouter.ExactInputSingleParams({
                tokenIn: USDC,
                tokenOut: token,
                fee: FEE,
                recipient: me,
                deadline: block.timestamp + 300,
                amountIn: spend,
                amountOutMinimum: 0
            })
        );

        vm.stopBroadcast();

        console2.log("bought tokens (18dp):", out);
        console2.log("mcap after $250 buy:", _mcap(pool));
        console2.log("pool USDC (6dp):", IERC20(USDC).balanceOf(pool));
    }

    function _mcap(address pool) internal view returns (uint256) {
        (uint160 s,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 Q96 = 2 ** 96;
        return FullMath.mulDiv(FullMath.mulDiv(s, s, Q96), 1e21, Q96);
    }
}
