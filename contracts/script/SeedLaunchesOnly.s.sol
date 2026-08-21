// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";

/// @notice Creates launches without buying any of them.
///
/// @dev Split out from `SeedDemo` because `forge script` executes the script
///      body locally against forked state before broadcasting, and Arc's USDC is
///      native-backed — its `transfer`/`transferFrom` cannot be simulated on a
///      fork even though it works perfectly on the live chain. Launching moves
///      no USDC, so it simulates cleanly; buys are done afterwards with direct
///      `cast send` calls, which skip local simulation entirely.
contract SeedLaunchesOnly is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    int24 constant TICK_LOWER = -403_400; // ~$3k start
    int24 constant TICK_UPPER = -334_400; // ~1000x ceiling

    struct Demo {
        string name;
        string symbol;
        string uri;
        bool rewardHolders;
        address feeRecipient;
        uint16 allocationBps;
        bool buybackAndBurn;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        ArcLaunchpad launchpad = ArcLaunchpad(vm.envAddress("LAUNCHPAD"));

        Demo[4] memory demos = [
            Demo(
                "Arc Doge",
                "ADOGE",
                _meta("The original Arc dog. Woof.", "@arcdoge", "arcdogechat", vm.envString("DEMO_IMAGE")),
                false,
                address(0),
                1_000, // 10% locked for 30 minutes
                false
            ),
            Demo(
                "Gas Is Dollars",
                "GASD",
                _meta("Paying gas in USDC hits different.", "@tsukipad_", "", ""),
                true, // holders earn
                address(0),
                0,
                false
            ),
            Demo(
                "Open Source Coin",
                "OSS",
                _metaFunds("Every trade funds core Ethereum development.", "ethereum/go-ethereum"),
                false,
                0x000000000000000000000000000000000000bEEF,
                0,
                false
            ),
            Demo(
                "Deflation Dog",
                "DEFDOG",
                _meta("Every trade burns supply. Number go down, price go up.", "@defdog", "", ""),
                false,
                address(0),
                0,
                true // buy back and burn
            )
        ];

        vm.startBroadcast(pk);
        for (uint256 i = 0; i < demos.length; i++) {
            _launchOne(launchpad, me, demos[i]);
        }
        vm.stopBroadcast();
    }

    function _launchOne(ArcLaunchpad launchpad, address me, Demo memory d) internal {
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
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                creatorAllocationBps: d.allocationBps,
                rewardHolders: d.rewardHolders,
                feeRecipient: d.feeRecipient,
                buybackAndBurn: d.buybackAndBurn,
                recipientCommitment: bytes32(0),
                referrer: address(0)
            })
        );

        console2.log(string.concat("  launched ", d.symbol), token);
    }

    function _meta(
        string memory description,
        string memory twitter,
        string memory telegram,
        string memory image
    ) internal pure returns (string memory) {
        string memory json = string.concat('{"description":"', description, '"');
        if (bytes(twitter).length > 0) json = string.concat(json, ',"twitter":"', twitter, '"');
        if (bytes(telegram).length > 0) json = string.concat(json, ',"telegram":"', telegram, '"');
        if (bytes(image).length > 0) json = string.concat(json, ',"image":"', image, '"');
        json = string.concat(json, "}");
        return string.concat("data:application/json;base64,", vm.toBase64(bytes(json)));
    }

    function _metaFunds(string memory description, string memory fundsLabel)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "data:application/json;base64,",
            vm.toBase64(bytes(string.concat('{"description":"', description, '","fundsLabel":"', fundsLabel, '"}')))
        );
    }
}
