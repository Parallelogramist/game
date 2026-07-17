import { describe, expect, it } from 'vitest';
import {
  INSTALL_HINT_MIN_RUNS,
  detectInstallPlatform,
  shouldShowInstallHint,
} from './InstallHint';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.101 Mobile/15E148 Safari/604.1';
// iPadOS 13+ and macOS send this exact string — only maxTouchPoints differs.
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

describe('detectInstallPlatform', () => {
  it('routes iPhone Safari to the Share-sheet instructions', () => {
    expect(detectInstallPlatform(IPHONE_SAFARI, 5)).toBe('ios');
  });

  it('stays silent in an iOS browser that is not Safari', () => {
    expect(detectInstallPlatform(IPHONE_CHROME, 5)).toBe('unsupported');
  });

  it('reads a touch-capable Macintosh UA as iPadOS', () => {
    expect(detectInstallPlatform(MAC_UA, 5)).toBe('ios');
  });

  it('leaves a real Mac on the beforeinstallprompt path', () => {
    expect(detectInstallPlatform(MAC_UA, 0)).toBe('prompt');
  });

  it('routes Android Chrome to beforeinstallprompt', () => {
    expect(detectInstallPlatform(ANDROID_CHROME, 5)).toBe('prompt');
  });
});

function hintInput(overrides: Partial<Parameters<typeof shouldShowInstallHint>[0]> = {}) {
  return {
    runsCompleted: INSTALL_HINT_MIN_RUNS,
    isStandalone: false,
    alreadyShownAt: null,
    ...overrides,
  };
}

describe('shouldShowInstallHint', () => {
  it('fires for a returning player still in a browser tab', () => {
    expect(shouldShowInstallHint(hintInput())).toBe(true);
  });

  it('stays quiet below the run threshold', () => {
    expect(shouldShowInstallHint(hintInput({ runsCompleted: INSTALL_HINT_MIN_RUNS - 1 }))).toBe(false);
  });

  it('stays quiet for a non-finite run count', () => {
    expect(shouldShowInstallHint(hintInput({ runsCompleted: Number.NaN }))).toBe(false);
  });

  it('never fires inside an already-installed app', () => {
    expect(shouldShowInstallHint(hintInput({ isStandalone: true, runsCompleted: 500 }))).toBe(false);
  });

  it('shows once and never again', () => {
    expect(shouldShowInstallHint(hintInput({ alreadyShownAt: 1_800_000_000_000 }))).toBe(false);
  });
});
