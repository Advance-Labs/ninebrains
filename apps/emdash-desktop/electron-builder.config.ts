import type { Configuration } from 'electron-builder';
import { resolveMacSigning, resolveWinSigning } from './scripts/release/lib/signing.ts';
import {
  APP_ID,
  COPYRIGHT,
  PRODUCT_NAME,
} from './src/core/primitives/app-identity/api/app-identity.ts';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  copyright: COPYRIGHT,
  directories: { output: 'release' },
  // Ninebrains: e.g. Ninebrains-0.1.0-mac-arm64.dmg. ${os} is mac | linux | win.
  artifactName: `${PRODUCT_NAME}-\${version}-\${os}-\${arch}.\${ext}`,
  // Ninebrains: no publish provider, so electron-builder writes no app-update.yml into the app and
  // no latest*.yml feed next to it (THREAT-MODEL SEC-36). The release workflow uploads to a GitHub
  // draft itself. Restore a `github` provider for Advance-Labs/ninebrains only together with signing
  // and UPDATES_ENABLED (docs/RELEASING.md, "Turning auto-update on").
  publish: null,
  generateUpdatesFilesForAllChannels: false,
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  asarUnpack: [
    'out/main/adapters/**',
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    // Ad-hoc signed and not notarized unless CSC_LINK / APPLE_* are set (scripts/release/lib/signing.ts).
    ...resolveMacSigning(process.env),
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Ninebrains needs microphone access for voice dictation and voice mode features.',
      NSLocalNetworkUsageDescription:
        'Ninebrains needs local network access to connect to SSH hosts on your network.',
    },
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    icon: 'src/assets/images/emdash/emdash.icns',
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash.icns',
    background: 'build/dmg-background.tiff',
    window: { width: 530, height: 319 },
    contents: [
      { x: 132, y: 150, type: 'file' },
      { x: 398, y: 150, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    category: 'Development',
    icon: 'src/assets/images/emdash/emdash.png',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/emdash/emdash.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Unsigned unless the Azure Artifact Signing env is set (scripts/release/lib/signing.ts).
    ...resolveWinSigning(process.env),
  },
  nsis: {
    // Differential packages only serve the updater, which is off (SEC-36).
    differentialPackage: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
  // Encrypt Chromium's on-disk cookie store (in-app browser logins) with OS-level
  // keys, like Chrome does. One-way: never disable once shipped or existing
  // cookie stores become unreadable.
  electronFuses: {
    enableCookieEncryption: true,
  },
};

export default config;
