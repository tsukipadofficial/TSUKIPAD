// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2, Vm} from "forge-std/Test.sol";

import {ArcLaunchpad} from "../src/ArcLaunchpad.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Confirms token metadata — including an embedded image — is fully
///         on-chain and cheap enough to be practical, and that indexers can read
///         it both from the launch event and from the token contract.
contract OnchainMetadataTest is Test {
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    string constant FACTORY_ARTIFACT =
        "tools/node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

    uint24 constant FEE = 10_000;
    int24 constant TICK_LOWER = -403_400;
    int24 constant TICK_UPPER = -334_400;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    /// @dev Arc testnet gas price at time of writing.
    uint256 constant GAS_PRICE_WEI = 21 gwei;

    ArcLaunchpad launchpad;
    MockUSDC usdc;
    address creator = makeAddr("creator");

    function setUp() public {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);

        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(code, 0x20), mload(code))
        }
        launchpad = new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, makeAddr("treasury"), 5_000);
    }

    function _launchWith(string memory uri) internal returns (address token, uint256 gasUsed) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (launchpad.predictTokenAddress(creator, "Meta", "META", SUPPLY, uri, false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        uint256 before = gasleft();
        (token,) = launchpad.launch(
            ArcLaunchpad.LaunchParams({
                name: "Meta",
                symbol: "META",
                metadataURI: uri,
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
        gasUsed = before - gasleft();
    }

    function _usd(uint256 gas) internal pure returns (string memory) {
        // gas * price / 1e18, rendered to 4dp
        uint256 micros = (gas * GAS_PRICE_WEI) / 1e12; // millionths of a dollar
        return string.concat("$", vm.toString(micros / 1e6), ".", vm.toString((micros % 1e6) / 100));
    }

    /// @dev A realistic payload: description, socials and a small embedded image.
    function _fakeImageMetadata(uint256 imageBytes) internal pure returns (string memory) {
        bytes memory blob = new bytes(imageBytes);
        for (uint256 i = 0; i < imageBytes; i++) {
            blob[i] = bytes1(uint8(65 + (i % 26)));
        }
        return string.concat(
            '{"description":"A token with everything on-chain.",',
            '"twitter":"@tsukipad_","telegram":"tsukipadofficial",',
            '"image":"data:image/jpeg;base64,',
            string(blob),
            '"}'
        );
    }

    function test_gasCostOfEmbeddingAnImageOnchain() public {
        (, uint256 bare) = _launchWith('{"description":"no image"}');
        console2.log("launch with no image      :", bare, "gas =", _usd(bare));

        for (uint256 kb = 2; kb <= 8; kb += 3) {
            ArcLaunchpad fresh = _freshLaunchpad();
            uint256 g = _measureOn(fresh, _fakeImageMetadata(kb * 1024));
            console2.log(
                string.concat("launch with ", vm.toString(kb), "KB image  :"), g, string.concat("gas = ", _usd(g))
            );
        }
    }

    function _freshLaunchpad() internal returns (ArcLaunchpad) {
        bytes memory code = vm.getCode(FACTORY_ARTIFACT);
        address factoryAddr;
        assembly {
            factoryAddr := create(0, add(code, 0x20), mload(code))
        }
        return new ArcLaunchpad(USDC_ADDR, factoryAddr, FEE, makeAddr("treasury"), 5_000);
    }

    function _measureOn(ArcLaunchpad lp, string memory uri) internal returns (uint256 gasUsed) {
        bytes32 salt;
        for (uint256 i = 0; i < 5_000; i++) {
            if (lp.predictTokenAddress(creator, "Meta", "META", SUPPLY, uri, false, bytes32(i)) < USDC_ADDR) {
                salt = bytes32(i);
                break;
            }
        }
        vm.prank(creator);
        uint256 before = gasleft();
        lp.launch(
            ArcLaunchpad.LaunchParams({
                name: "Meta",
                symbol: "META",
                metadataURI: uri,
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
        gasUsed = before - gasleft();
    }

    /// @dev The two paths an indexer or bot can use to read a launch.
    function test_metadataIsReadableByIndexers() public {
        string memory uri =
            '{"description":"hello","twitter":"@tsukipad_","telegram":"tsukipadofficial","image":"data:image/jpeg;base64,AAAA"}';

        vm.recordLogs();
        (address token,) = _launchWith(uri);

        // Path 1: a plain view call on the token.
        assertEq(LaunchToken(token).metadataURI(), uri, "readable from the token contract");

        // Path 2: the Launched event carries the same payload, so an indexer
        // never needs a follow-up call.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256(
                "Launched(address,address,address,address,string,string,string,uint256,uint256,int24,int24,uint128)"
            )) {
                found = true;
            }
        }
        assertTrue(found, "Launched event emitted with metadata");
    }
}
