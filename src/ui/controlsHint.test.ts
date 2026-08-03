import { describe, expect, test } from 'vitest';
import { CONTROLS_HINT_COMPACT_WIDTH, describeRunControls } from './controlsHint';

const WIDE = 1280;
const NARROW = CONTROLS_HINT_COMPACT_WIDTH - 1;

describe('describeRunControls', () => {
  test('touch draws nothing: the on-screen buttons already carry the same verbs', () => {
    expect(describeRunControls({ controlMode: 'joystick', hasWorldMap: true, viewportWidth: WIDE }))
      .toBeNull();
    expect(describeRunControls({ controlMode: 'joystick', hasWorldMap: false, viewportWidth: NARROW }))
      .toBeNull();
  });

  test('the wide keyboard line names all five verbs', () => {
    expect(describeRunControls({ controlMode: 'keyboard', hasWorldMap: true, viewportWidth: WIDE }))
      .toBe('WASD MOVE  ·  SHIFT DASH  ·  Q ULTIMATE  ·  M CHART  ·  ESC PAUSE');
  });

  test('a mouse player gets the keyboard line: every key still fires', () => {
    expect(describeRunControls({ controlMode: 'mouse', hasWorldMap: true, viewportWidth: WIDE }))
      .toBe(describeRunControls({ controlMode: 'keyboard', hasWorldMap: true, viewportWidth: WIDE }));
  });

  test('an arena run names no chart, because its M press does nothing', () => {
    const line = describeRunControls({ controlMode: 'keyboard', hasWorldMap: false, viewportWidth: WIDE });
    expect(line).toBe('WASD MOVE  ·  SHIFT DASH  ·  Q ULTIMATE  ·  ESC PAUSE');
    expect(line).not.toContain('CHART');
  });

  test('the wide gamepad line names buttons, never keys', () => {
    const line = describeRunControls({ controlMode: 'gamepad', hasWorldMap: true, viewportWidth: WIDE });
    expect(line).toBe('STICK MOVE  ·  RB DASH  ·  Y ULTIMATE  ·  LB CHART  ·  START PAUSE');
    expect(line).not.toMatch(/WASD|SHIFT|ESC/);
  });

  test('the compact line keeps only the verbs a player cannot find by trying', () => {
    expect(describeRunControls({ controlMode: 'keyboard', hasWorldMap: true, viewportWidth: NARROW }))
      .toBe('SHIFT DASH  ·  Q ULT  ·  M CHART');
    expect(describeRunControls({ controlMode: 'gamepad', hasWorldMap: true, viewportWidth: NARROW }))
      .toBe('RB DASH  ·  Y ULT  ·  LB CHART');
  });

  test('the compact threshold is exclusive at its own width', () => {
    const atThreshold = describeRunControls({
      controlMode: 'keyboard', hasWorldMap: true, viewportWidth: CONTROLS_HINT_COMPACT_WIDTH,
    });
    expect(atThreshold).toContain('WASD MOVE');
  });
});
