import { defineConfig } from 'vitest/config';

// Vitest runs the unit suite in a plain Node environment. Tests cover pure
// logic (ECS serialization, data round-trips) that needs neither a DOM nor a
// Phaser scene; anything Phaser-coupled is exercised by mocking its module
// boundary instead.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
