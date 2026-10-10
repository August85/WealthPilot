// Metro config for the pnpm monorepo. Expo's default config (SDK 52+) detects the workspace root and
// watches packages/* automatically; with `node-linker=hoisted` (.npmrc) all deps resolve from the root
// node_modules, so no extra resolver setup is required.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
