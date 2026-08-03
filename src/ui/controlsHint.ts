/**
 * controlsHint: the pure text half of the in-run controls line. The HUD named one verb of
 * five, so dash, the ultimate and the world chart were reachable only by accident or by a
 * one-shot tutorial toast. Kept Phaser-free so the device-and-mode matrix is testable
 * without a live scene, the same split `toastGate` uses in this directory.
 */

import type { ControlMode } from '../ecs/systems/InputSystem';

/** Under this viewport width the full line runs past the HUD's bottom-left corner into the
 *  auto-upgrade pill, so the line drops to the verbs a player cannot find by trying: moving
 *  and pausing announce themselves (a stick moves the ship, the pause button is on screen),
 *  dash, the ultimate and the chart do not. */
export const CONTROLS_HINT_COMPACT_WIDTH = 560;

const SEPARATOR = '  ·  ';

export interface ControlsHintInput {
  controlMode: ControlMode;
  /** Expedition runs only: arena has no chart, and its `M` / `LB` press does nothing. */
  hasWorldMap: boolean;
  viewportWidth: number;
}

/** The line the HUD should draw, or null when it should draw none. */
export function describeRunControls(input: ControlsHintInput): string | null {
  if (input.controlMode === 'joystick') return null;
  const compact = input.viewportWidth < CONTROLS_HINT_COMPACT_WIDTH;
  const isGamepad = input.controlMode === 'gamepad';
  const segments: string[] = [];
  if (!compact) segments.push(isGamepad ? 'STICK MOVE' : 'WASD MOVE');
  segments.push(isGamepad ? 'RB DASH' : 'SHIFT DASH');
  segments.push(compact
    ? (isGamepad ? 'Y ULT' : 'Q ULT')
    : (isGamepad ? 'Y ULTIMATE' : 'Q ULTIMATE'));
  if (input.hasWorldMap) segments.push(isGamepad ? 'LB CHART' : 'M CHART');
  if (!compact) segments.push(isGamepad ? 'START PAUSE' : 'ESC PAUSE');
  return segments.join(SEPARATOR);
}
