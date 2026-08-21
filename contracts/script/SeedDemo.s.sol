// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {ArcSwapRouter} from "../src/ArcSwapRouter.sol";

/// @notice Fills a local chain with a spread of launches at different points in
///         their curve, so the UI can be developed against realistic state.
contract SeedDemo is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint24 constant FEE = 10_000;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    /// @dev A real 128x128 JPEG, embedded to exercise the fully on-chain image path.
    string constant DEMO_IMAGE = "data:image/jpeg;base64,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";

    struct Demo {
        string name;
        string symbol;
        string uri;
        int24 tickLower;
        int24 tickUpper;
        uint256 buyUsdc;
        bool rewardHolders;
        address feeRecipient;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        ArcLaunchpad launchpad = ArcLaunchpad(vm.envAddress("LAUNCHPAD"));
        ArcSwapRouter router = ArcSwapRouter(vm.envAddress("ROUTER"));

        // Two of these share swap fees with holders, so the UI has both modes to render.
        // Mixed modes so every UI state is represented: creator-fee, holder-reward,
        // and one that redirects its fees to fund an open-source project.
        Demo[6] memory demos = [
            Demo("Arc Doge", "ADOGE", _metaFull("The original Arc dog. Woof.", "@arcdoge", "arcdogechat", DEMO_IMAGE), -403400, -334400, 4_000e6, false, address(0)),
            Demo("Stable Cat", "SCAT", _meta("Nine lives, one dollar.", "@stablecat"), -403400, -334400, 800e6, true, address(0)),
            Demo("Gas Is Dollars", "GASD", _meta("Paying gas in USDC hits different.", ""), -403400, -334400, 22_000e6, true, address(0)),
            Demo("Open Source Coin", "OSS", _metaFunds("Every trade funds core Ethereum development.", "ethereum/go-ethereum"), -403400, -334400, 5_000e6, false, 0x000000000000000000000000000000000000bEEF),
            Demo("Validator Vibes", "VIBE", _meta("BlackRock ran a node and all I got was this token.", "@vibeonarc"), -421000, -352000, 60e6, false, address(0)),
            Demo("Sub Second", "SUBSEC", _meta("Finality faster than your attention span.", ""), -403400, -334400, 0, false, address(0))
        ];

        vm.startBroadcast(pk);

        for (uint256 i = 0; i < demos.length; i++) {
            _seedOne(launchpad, router, me, demos[i], i == 4 ? 500 : 0);
        }

        vm.stopBroadcast();
    }

    /// @dev Matches the frontend's on-chain metadata format: base64 JSON data URI.
    /// @dev Split out of the loop to keep the stack shallow under via-ir.
    function _seedOne(
        ArcLaunchpad launchpad,
        ArcSwapRouter router,
        address me,
        Demo memory d,
        uint16 allocationBps
    ) internal {
        bytes32 salt;
        for (uint256 k = 0; k < 20_000; k++) {
            if (
                launchpad.predictTokenAddress(me, d.name, d.symbol, SUPPLY, d.uri, d.rewardHolders, bytes32(k)) < USDC
            ) {
                salt = bytes32(k);
                break;
            }
        }

        (address token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: d.name,
                symbol: d.symbol,
                metadataURI: d.uri,
                totalSupply: SUPPLY,
                salt: salt,
                tickLower: d.tickLower,
                tickUpper: d.tickUpper,
                creatorAllocationBps: allocationBps,
                rewardHolders: d.rewardHolders,
                feeRecipient: d.feeRecipient,
                buybackAndBurn: false,
                recipientCommitment: bytes32(0)
            })
        );

        if (d.buyUsdc > 0) {
            IERC20(USDC).approve(address(router), d.buyUsdc);
            router.exactInputSingle(
                ArcSwapRouter.ExactInputSingleParams({
                    tokenIn: USDC,
                    tokenOut: token,
                    fee: FEE,
                    recipient: me,
                    deadline: block.timestamp + 600,
                    amountIn: d.buyUsdc,
                    amountOutMinimum: 0
                })
            );
        }

        console2.log(string.concat("  seeded ", d.symbol), token);
    }

    /// @dev Full metadata: description, both socials, and an embedded image.
    function _metaFull(
        string memory description,
        string memory twitter,
        string memory telegram,
        string memory image
    ) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"description":"', description,
            '","twitter":"', twitter,
            '","telegram":"', telegram,
            '","image":"', image, '"}'
        );
        return string.concat("data:application/json;base64,", vm.toBase64(bytes(json)));
    }

    /// @dev Metadata carrying a claimed beneficiary label for redirected launches.
    function _metaFunds(string memory description, string memory fundsLabel)
        internal
        pure
        returns (string memory)
    {
        string memory json =
            string.concat('{"description":"', description, '","fundsLabel":"', fundsLabel, '"}');
        return string.concat("data:application/json;base64,", vm.toBase64(bytes(json)));
    }

    function _meta(string memory description, string memory twitter) internal pure returns (string memory) {
        string memory json = bytes(twitter).length > 0
            ? string.concat('{"description":"', description, '","twitter":"', twitter, '"}')
            : string.concat('{"description":"', description, '"}');
        return string.concat("data:application/json;base64,", vm.toBase64(bytes(json)));
    }
}
