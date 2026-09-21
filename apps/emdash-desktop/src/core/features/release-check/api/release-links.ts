/**
 * Where the "new version" notice sends people. The app never downloads or installs anything
 * itself (SEC-36, T28): these open in the browser or are copied for the user to run.
 */

export const RELEASE_REPO = 'Advance-Labs/ninebrains';

export const DOWNLOAD_PAGE_URL = 'https://ninebrains.runs-on.dev/#download';

export const POSIX_INSTALL_COMMAND =
  "curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh";

export const WINDOWS_INSTALL_COMMAND = 'irm https://ninebrains.runs-on.dev/install.ps1 | iex';

export type InstallCommand = {
  /** Where to paste it, in the user's words. */
  readonly shell: 'Terminal' | 'PowerShell';
  readonly command: string;
};

export function installCommandFor(os: 'mac' | 'windows' | 'linux'): InstallCommand {
  return os === 'windows'
    ? { shell: 'PowerShell', command: WINDOWS_INSTALL_COMMAND }
    : { shell: 'Terminal', command: POSIX_INSTALL_COMMAND };
}

/** The only release-page links the status may carry; the renderer opens this URL. */
export const RELEASE_PAGE_URL_PATTERN =
  /^https:\/\/github\.com\/Advance-Labs\/ninebrains\/releases\/tag\/v[0-9A-Za-z.+-]+$/;

/** The GitHub release page for a version that already passed `normalizeVersion`. */
export function releasePageUrl(version: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/tag/v${encodeURIComponent(version)}`;
}
