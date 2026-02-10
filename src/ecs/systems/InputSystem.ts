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
      } else if (input.controlMode === 'mouse') {
        // Priority 3: Mouse cursor — only when mouse is the active control mode
        const playerX = Transform.x[playerId];
        const playerY = Transform.y[playerId];
        const deltaX = input.mouseX - playerX;
        const deltaY = input.mouseY - playerY;
        const distanceToCursor = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distanceToCursor > MOUSE_DEAD_ZONE) {
          directionX = deltaX / distanceToCursor;
          directionY = deltaY / distanceToCursor;
        }
        // Within dead zone: directionX/Y stay 0, player stops near cursor
      }
    }

    // Apply speed to direction
    const speed = Velocity.speed[playerId];
    Velocity.x[playerId] = directionX * speed;
    Velocity.y[playerId] = directionY * speed;
  }

  return world;
}
