import { SecureStorage } from '../storage/SecureStorage';

const STORAGE_KEY_INSTALL_HINT_SHOWN_AT = 'survivor-install-hint-at';

/** Below this many completed runs a visitor is still evaluating, not returning. */
export const INSTALL_HINT_MIN_RUNS = 3;

/**
 * How a browser can be installed to a home screen at all.
 * - `prompt` — fires `beforeinstallprompt` (Chromium/Android/desktop).
 * - `ios`    — iOS/iPadOS Safari: never fires the event, Share sheet only.
 * - `unsupported` — no honest path; stay silent.
 */
export type InstallPlatform = 'prompt' | 'ios' | 'unsupported';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let capturedPrompt: BeforeInstallPromptEvent | null = null;
let availabilityListeners: Array<() => void> = [];

export function detectInstallPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  // iPadOS 13+ reports the desktop macOS UA, byte-identical to a real Mac's;
  // touch points are the only thing that separates them.
  const isIosDevice = /\b(iPhone|iPad|iPod)\b/.test(userAgent)
    || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
  if (!isIosDevice) return 'prompt';
  // Chrome/Firefox/Edge/Opera on iOS are WebKit wrappers that route Add to Home
  // Screen differently or not at all — wrong instructions beat no instructions.
  if (/\b(CriOS|FxiOS|EdgiOS|OPiOS)\b/.test(userAgent)) return 'unsupported';
  return 'ios';
}

export function isRunningStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari never matches display-mode; it exposes its own flag instead.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export interface InstallHintInput {
  runsCompleted: number;
  isStandalone: boolean;
  alreadyShownAt: number | null;
}

export function shouldShowInstallHint(input: InstallHintInput): boolean {
  const { runsCompleted, isStandalone, alreadyShownAt } = input;
  if (isStandalone) return false;
  if (!Number.isFinite(runsCompleted) || runsCompleted < INSTALL_HINT_MIN_RUNS) return false;
  return alreadyShownAt === null;
}

export function loadInstallHintShownAt(): number | null {
  const raw = SecureStorage.getItem(STORAGE_KEY_INSTALL_HINT_SHOWN_AT);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function saveInstallHintShownAt(timestamp: number): void {
  SecureStorage.setItem(STORAGE_KEY_INSTALL_HINT_SHOWN_AT, String(Math.floor(timestamp)));
}

export function captureInstallPromptEvent(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Uncancelled, Chrome shows its own mini-infobar; the hint should be the
    // only install affordance, fired on our terms.
    event.preventDefault();
    capturedPrompt = event as BeforeInstallPromptEvent;
    for (const listener of [...availabilityListeners]) listener();
  });
  window.addEventListener('appinstalled', () => {
    capturedPrompt = null;
  });
}

/**
 * Chrome fires `beforeinstallprompt` on its own schedule — routinely after the
 * menu is already up — so callers subscribe rather than check once and miss it.
 * Fires immediately if the event already landed.
 */
export function subscribeInstallPromptAvailable(listener: () => void): () => void {
  if (capturedPrompt) {
    listener();
    return () => {};
  }
  availabilityListeners.push(listener);
  return () => {
    availabilityListeners = availabilityListeners.filter((entry) => entry !== listener);
  };
}

export async function triggerInstallPrompt(): Promise<boolean> {
  const event = capturedPrompt;
  if (!event) return false;
  // Single-use: Chrome rejects a second prompt() on the same event.
  capturedPrompt = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted';
  } catch (error) {
    console.warn('[pwa] install prompt failed', error);
    return false;
  }
}
