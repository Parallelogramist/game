/**
 * ColorblindModeOptions — display order, pill labels, and index mapping for the
 * colorblind-mode segmented control in SettingsScene.
 *
 * Pure data + lookups (no Phaser) so the cycle order and round-trip behavior
 * stay unit-testable. The shader itself lives in ColorblindPipeline and reads
 * the persisted mode live each frame; this module only shapes the UI row.
 */

import type { ColorblindMode } from './SettingsManager';

export interface ColorblindModeOption {
  value: ColorblindMode;
  /** Short label for a ~60px segmented pill ("Protan", not "Protanopia"). */
  label: string;
}

/** Display order: off first, then deficiencies along the red→green→blue axis. */
export const COLORBLIND_MODE_OPTIONS: readonly ColorblindModeOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'protanopia', label: 'Protan' },
  { value: 'deuteranopia', label: 'Deutan' },
  { value: 'tritanopia', label: 'Tritan' },
];

/** Position of a mode in the segmented control; unknown values map to 0 (off). */
export function indexOfColorblindMode(mode: ColorblindMode): number {
  const index = COLORBLIND_MODE_OPTIONS.findIndex((option) => option.value === mode);
  return index >= 0 ? index : 0;
}

/** Mode at a segmented-control index, clamping out-of-range (and NaN) to valid. */
export function colorblindModeAtIndex(index: number): ColorblindMode {
  const lastIndex = COLORBLIND_MODE_OPTIONS.length - 1;
  const clamped = Number.isFinite(index) ? Math.max(0, Math.min(lastIndex, Math.trunc(index))) : 0;
  return COLORBLIND_MODE_OPTIONS[clamped].value;
}
