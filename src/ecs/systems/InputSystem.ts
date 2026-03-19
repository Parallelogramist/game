import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity, PlayerTag } from '../components';

// Query for player entities
const playerQuery = defineQuery([Transform, Velocity, PlayerTag]);

// Dead zone radius — player stops moving when within this distance of the cursor
const MOUSE_DEAD_ZONE = 20;

// Control mode tracks which input device the player is actively using
export type ControlMode = 'keyboard' | 'mouse' | 'joystick';

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
export function inputSystem(world: IWorld, input: InputState): IWorld {
  const players = playerQuery(world);

  for (let i = 0; i < players.length; i++) {
    const playerId = players[i];

    let directionX = 0;
    let directionY = 0;

    // Priority 1: Virtual joystick (touch devices)
    if (input.joystickX !== 0 || input.joystickY !== 0) {
      directionX = input.joystickX;
      directionY = input.joystickY;
    } else {
      // Priority 2: Keyboard (WASD / arrows)
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
    Velocity.x[playerId] = directionX * speed;
    Velocity.y[playerId] = directionY * speed;
  }

  return world;
}
