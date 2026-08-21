const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Expo SDK 57 turns on package-exports resolution by default. Privy depends on
// `jose`, whose exports map offers "browser" and "import" but no "react-native"
// condition, so Metro takes "import" and pulls the Node build — which imports
// util, zlib, buffer and crypto, none of which exist here.
//
// With exports off, Metro falls back to resolverMainFields
// (react-native → browser → main) and jose's "browser" field points at the
// build that actually runs on device.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
