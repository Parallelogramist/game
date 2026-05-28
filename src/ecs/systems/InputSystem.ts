import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity, PlayerTag } from '../components';

// Query for player entities
const playerQuery = defineQuery([Transform, Velocity, PlayerTag]);

// Dead zone radius — player stops moving when within this distance of the cursor
const MOUSE_DEAD_ZONE = 20;

// Base velocity-approach rate (per second) for the acceleration/momentum model.
// Higher = snappier (less momentum). The player's accelerationMultiplier (Quick
// Start upgrade) scales this up so top speed is reached faster.
// TUNING: 30 ≈ ~0.10s to 95% speed by default, ~0.06s with the maxed upgrade.
// Raise it toward instant if the default movement feels floaty; lower it for
// weightier momentum. This is the single knob for player movement feel.
const PLAYER_ACCEL_BASE = 30;

// Smoothed player velocity (module state — survives between frames to model
// acceleration). Reset per run via resetInputSystem() to avoid stale carry-over.
let smoothedVelX = 0;
let smoothedVelY = 0;

/**
 * Reset the smoothed-velocity state. Call in GameScene create() like other
 * module-level system state (see CLAUDE.md "System state reset").
 */
export function resetInputSystem(): void {
  smoothedVelX = 0;
  smoothedVelY = 0;
}

// Control mode tracks which input device the player is actively using
export type ControlMode = 'keyboard' | 'mouse' | 'joystick' | 'gamepad';

// Input state interface
export interface InputState {
  cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  joystickX: number;
  joystickY: number;
  gamepadX: number;
  gamepadY: number;
  mouseX: number;
  mouseY: number;
  mouseActive: boolean;
  controlMode: ControlMode;
  clickTargetX: number;
  clickTargetY: number;
  hasClickTarget: boolean;
}

/**
 * InputSystem reads keyboard and joystick input and sets player velocity.
 * Supports arrow keys, WASD, and virtual joystick.
 * Normalizes diagonal movement to prevent faster diagonal speed.
 */
export function inputSystem(
  world: IWorld,
  input: InputState,
  deltaSeconds: number = 0,
  accelerationMultiplier: number = 1,
): IWorld {
  const players = playerQuery(world);

  for (let i = 0; i < players.length; i++) {
    const playerId = players[i];

    let directionX = 0;
    let directionY = 0;

    // Priority 1: Virtual joystick (touch devices)
    if (input.joystickX !== 0 || input.joystickY !== 0) {
      directionX = input.joystickX;
      directionY = input.joystickY;
    } else if (input.gamepadX !== 0 || input.gamepadY !== 0) {
      // Priority 2: Gamepad left stick
      directionX = input.gamepadX;
      directionY = input.gamepadY;
    } else {
      // Priority 3: Keyboard (WASD / arrows)
      if (input.cursors.left.isDown || input.wasd.A.isDown) {
        directionX -= 1;
      }
      if (input.cursors.right.isDown || input.wasd.D.isDown) {
        directionX += 1;
      }
      if (input.cursors.up.isDown || input.wasd.W.isDown) {
        directionY -= 1;
      }
      if (input.cursors.down.isDown || input.wasd.S.isDown) {
        directionY += 1;
      }

      // Normalize keyboard diagonal movement
      const keyboardMagnitude = Math.sqrt(directionX * directionX + directionY * directionY);
      if (keyboardMagnitude > 0) {
        directionX /= keyboardMagnitude;
        directionY /= keyboardMagnitude;
      } else if (input.controlMode === 'mouse' && input.hasClickTarget) {
        // Priority 3: Point-and-click — move toward clicked destination
        const playerX = Transform.x[playerId];
        const playerY = Transform.y[playerId];
        const deltaX = input.clickTargetX - playerX;
        const deltaY = input.clickTargetY - playerY;
        const distanceToTarget = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distanceToTarget > MOUSE_DEAD_ZONE) {
          directionX = deltaX / distanceToTarget;
          directionY = deltaY / distanceToTarget;
        } else {
          // Arrived at destination — clear target
          input.hasClickTarget = false;
        }
      }
    }

    // Apply speed to direction
    const speed = Velocity.speed[playerId];
    const targetVelX = directionX * speed;
    const targetVelY = directionY * speed;

    // Acceleration/momentum: ease the actual velocity toward the target rather
    // than snapping. Frame-rate-independent exponential approach; the rate
    // scales with the player's acceleration upgrade so top speed is reached
    // faster. deltaSeconds <= 0 (or a paused frame) snaps instantly.
    if (deltaSeconds > 0) {
      const approach = 1 - Math.exp(-PLAYER_ACCEL_BASE * accelerationMultiplier * deltaSeconds);
      smoothedVelX += (targetVelX - smoothedVelX) * approach;
      smoothedVelY += (targetVelY - smoothedVelY) * approach;
    } else {
      smoothedVelX = targetVelX;
      smoothedVelY = targetVelY;
    }

    Velocity.x[playerId] = smoothedVelX;
    Velocity.y[playerId] = smoothedVelY;
  }

  return world;
}
