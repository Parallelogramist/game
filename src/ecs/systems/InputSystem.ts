import { defineQuery, IWorld } from 'bitecs';
import { Transform, Velocity, PlayerTag } from '../components';

// Query for player entities
const playerQuery = defineQuery([Transform, Velocity, PlayerTag]);

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

    // Check if joystick is providing input (already normalized)
    if (input.joystickX !== 0 || input.joystickY !== 0) {
      directionX = input.joystickX;
      directionY = input.joystickY;
    } else {
      // Fallback to keyboard input
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
      const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
      if (magnitude > 0) {
        directionX /= magnitude;
        directionY /= magnitude;
      }
    }

    // Apply speed to direction
    const speed = Velocity.speed[playerId];
    Velocity.x[playerId] = directionX * speed;
    Velocity.y[playerId] = directionY * speed;
  }

  return world;
}
