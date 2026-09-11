import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  COPYRIGHT,
  PRODUCT_NAME,
} from './src/core/primitives/app-identity/api/app-identity.ts';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  copyright: COPYRIGHT,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  // Ninebrains: GitHub Releases only. Emdash's R2 generic feed is removed.
  publish: [
    {
      provider: 'github',
      owner: 'Advance-Labs',
      repo: 'ninebrains',
      releaseType: 'draft',
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  asarUnpack: [
    'out/main/adapters/**',
    'out/main/brain-mcp/**',
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Ninebrains needs microphone access for voice dictation and voice mode features.',
      NSLocalNetworkUsageDescription:
        'Ninebrains needs local network access to connect to SSH hosts on your network.',
    },
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/emdash/emdash.icns',
    notarize: false,
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
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/emdash/emdash.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    // Ninebrains: Emdash's Azure Trusted Signing profile is removed. Builds ship unsigned until
    // plan task 7.1 wires up our own signing.
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
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
