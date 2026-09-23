import type { Configuration } from 'electron-builder';
import { resolveMacSigning, resolveWinSigning } from './scripts/release/lib/signing.ts';
import {
  APP_ID,
  APP_NAME_LOWER,
  COPYRIGHT,
  PRODUCT_NAME,
} from './src/core/primitives/app-identity/api/app-identity.canary.ts';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  executableName: PRODUCT_NAME,
  copyright: COPYRIGHT,
  directories: { output: 'release' },
  // Ninebrains: e.g. Ninebrains-Canary-0.1.1-canary.3-mac-arm64.dmg (no spaces in file names).
  artifactName: `${PRODUCT_NAME.replace(/ /g, '-')}-\${version}-\${os}-\${arch}.\${ext}`,
  // Ninebrains: no publish provider, so no app-update.yml and no canary*.yml feed (SEC-36). When
  // auto-update returns, the provider must be github / Advance-Labs / ninebrains with
  // `channel: 'canary'`, matching the prerelease id in scripts/release/lib/version.ts.
  publish: null,
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
    icon: 'src/assets/images/emdash/emdash-canary.icns',
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash-canary.icns',
    background: 'build/dmg-background.tiff',
    window: { width: 530, height: 319 },
    contents: [
      { x: 132, y: 150, type: 'file' },
      { x: 398, y: 150, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    category: 'Development',
    executableName: APP_NAME_LOWER,
    icon: 'src/assets/images/emdash/emdash-canary.png',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },
  deb: {
    packageName: APP_NAME_LOWER,
  },
  win: {
    icon: 'src/assets/images/emdash/emdash-canary.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...resolveWinSigning(process.env),
  },
  nsis: {
    differentialPackage: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    runAfterFinish: true,
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
