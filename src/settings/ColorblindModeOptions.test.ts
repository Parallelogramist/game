import { describe, test, expect } from 'vitest';

import {
  COLORBLIND_MODE_OPTIONS,
  indexOfColorblindMode,
  colorblindModeAtIndex,
} from './ColorblindModeOptions';
import type { ColorblindMode } from './SettingsManager';

describe('COLORBLIND_MODE_OPTIONS', () => {
  test('covers every ColorblindMode exactly once, with "off" first', () => {
    const values = COLORBLIND_MODE_OPTIONS.map((option) => option.value);
    expect(values[0]).toBe('off');
    expect([...values].sort()).toEqual(
      (['off', 'protanopia', 'deuteranopia', 'tritanopia'] as ColorblindMode[]).sort()
    );
    expect(new Set(values).size).toBe(values.length);
  });

  test('orders deficiency modes by red→green→blue axis (protan, deutan, tritan)', () => {
    expect(COLORBLIND_MODE_OPTIONS.map((option) => option.value)).toEqual([
      'off',
      'protanopia',
      'deuteranopia',
      'tritanopia',
    ]);
  });

  test('every option has a short, non-empty pill label', () => {
    for (const option of COLORBLIND_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      // Segmented pills are ~60px wide at 12px font — labels must stay short.
      expect(option.label.length).toBeLessThanOrEqual(7);
    }
  });
});

describe('indexOfColorblindMode', () => {
  test('round-trips every option value to its position', () => {
    COLORBLIND_MODE_OPTIONS.forEach((option, index) => {
      expect(indexOfColorblindMode(option.value)).toBe(index);
    });
  });

  test('falls back to 0 (off) for an unknown stored value', () => {
    expect(indexOfColorblindMode('rainbow' as ColorblindMode)).toBe(0);
  });
});

describe('colorblindModeAtIndex', () => {
  test('returns the option value at each valid index', () => {
    COLORBLIND_MODE_OPTIONS.forEach((option, index) => {
      expect(colorblindModeAtIndex(index)).toBe(option.value);
    });
  });

  test('clamps out-of-range indices instead of returning undefined', () => {
    expect(colorblindModeAtIndex(-1)).toBe('off');
    expect(colorblindModeAtIndex(999)).toBe('tritanopia');
    expect(colorblindModeAtIndex(Number.NaN)).toBe('off');
  });
});
