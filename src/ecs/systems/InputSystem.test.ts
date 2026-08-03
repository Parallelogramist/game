import { describe, test, expect } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { PlayerTag, Transform, Velocity } from '../components';
import { inputSystem, resetInputSystem, type InputState } from './InputSystem';

/**
 * CHORE-DASH-VELOCITY-OVERWRITE: the dash used to write Velocity directly in GameScene.update()
 * and inputSystem overwrote it later in the same frame, so the dash carried the ship no faster
 * than the stick and nothing failed. These two cases pin the single-writer contract that fixed
 * it, which is invisible in a diff and unfalsifiable without a browser.
 */

const STICK_SPEED = 150;
const DASH_SPEED = 525;
const FRAME = 1 / 60;

// Only the joystick fields are read: inputSystem's joystick branch is priority 1 and never
// touches the Phaser key objects the rest of InputState carries.
const stickHeldRight = {
  joystickX: 1,
  joystickY: 0,
  gamepadX: 0,
  gamepadY: 0,
  mouseX: 0,
  mouseY: 0,
  mouseActive: false,
  controlMode: 'joystick',
  clickTargetX: 0,
  clickTargetY: 0,
  hasClickTarget: false,
} as unknown as InputState;

function createPlayerWorld() {
  const world = createWorld();
  const playerId = addEntity(world);
  addComponent(world, Transform, playerId);
  addComponent(world, Velocity, playerId);
  addComponent(world, PlayerTag, playerId);
  Transform.x[playerId] = 0;
  Transform.y[playerId] = 0;
  Velocity.x[playerId] = 0;
  Velocity.y[playerId] = 0;
  Velocity.speed[playerId] = STICK_SPEED;
  return { world, playerId };
}

describe('inputSystem — dash override', () => {
  test('a dash owns the frame it fires in', () => {
    resetInputSystem();
    const { world, playerId } = createPlayerWorld();

    inputSystem(world, stickHeldRight, FRAME, 1, { velocityX: DASH_SPEED, velocityY: 0 });

    expect(Velocity.x[playerId]).toBe(DASH_SPEED);
    expect(Velocity.y[playerId]).toBe(0);
  });

  test('the frame after a dash eases down from dash speed, not up from stick speed', () => {
    resetInputSystem();
    const { world, playerId } = createPlayerWorld();

    inputSystem(world, stickHeldRight, FRAME, 1, { velocityX: DASH_SPEED, velocityY: 0 });
    inputSystem(world, stickHeldRight, FRAME, 1, null);

    const approach = 1 - Math.exp(-30 * FRAME);
    expect(Velocity.x[playerId]).toBeCloseTo(DASH_SPEED + (STICK_SPEED - DASH_SPEED) * approach, 3);
  });
});
