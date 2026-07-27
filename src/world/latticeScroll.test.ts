import { describe, expect, it } from 'vitest';
import { LatticeField, scrollLatticeField, snappedOrigin } from './latticeScroll';

const CELL = 40;

function makeField(numCols: number, numRows: number): LatticeField {
  const count = numCols * numRows;
  const field: LatticeField = {
    restX: new Float32Array(count), restY: new Float32Array(count),
    posX: new Float32Array(count), posY: new Float32Array(count),
    posZ: new Float32Array(count),
    velX: new Float32Array(count), velY: new Float32Array(count),
    velZ: new Float32Array(count),
  };
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const index = row * numCols + col;
      field.restX[index] = col * CELL;
      field.restY[index] = row * CELL;
      field.posX[index] = col * CELL;
      field.posY[index] = row * CELL;
    }
  }
  return field;
}

describe('snappedOrigin', () => {
  it('floors a scroll to the whole cell at or below it, negatives included', () => {
    expect(snappedOrigin(95, CELL)).toBe(80);
    expect(snappedOrigin(80, CELL)).toBe(80);
    expect(snappedOrigin(-5, CELL)).toBe(-40);
  });
});

describe('scrollLatticeField', () => {
  it('moves node state one index left for a +1 column shift', () => {
    const field = makeField(5, 4);
    const source = 1 * 5 + 3;
    field.posX[source] += 7;
    field.velY[source] = 3;

    scrollLatticeField(field, 5, 4, 1, 0);

    const target = 1 * 5 + 2;
    expect(field.posX[target] - field.restX[target]).toBeCloseTo(7);
    expect(field.velY[target]).toBeCloseTo(3);
    expect(field.posX[source] - field.restX[source]).toBeCloseTo(0);
    expect(field.velY[source]).toBeCloseTo(0);
  });

  it('moves node state one index right for a -1 column shift', () => {
    const field = makeField(5, 4);
    const source = 1 * 5 + 3;
    field.posX[source] += 7;
    field.velY[source] = 3;

    scrollLatticeField(field, 5, 4, -1, 0);

    const target = 1 * 5 + 4;
    expect(field.posX[target] - field.restX[target]).toBeCloseTo(7);
    expect(field.velY[target]).toBeCloseTo(3);
  });

  it('moves node state one index up for a +1 row shift', () => {
    const field = makeField(5, 4);
    const source = 2 * 5 + 2;
    field.posY[source] += 5;
    field.velX[source] = 2;

    scrollLatticeField(field, 5, 4, 0, 1);

    const target = 1 * 5 + 2;
    expect(field.posY[target] - field.restY[target]).toBeCloseTo(5);
    expect(field.velX[target]).toBeCloseTo(2);
  });

  it('rebuilds positions against the target rest, not carrying the absolute value', () => {
    const field = makeField(5, 4);
    const source = 1 * 5 + 3;
    field.posX[source] += 7;

    scrollLatticeField(field, 5, 4, 1, 0);

    const target = 1 * 5 + 2;
    expect(field.posX[target]).toBeCloseTo(2 * CELL + 7);
    expect(field.posX[target]).toBeCloseTo(3 * CELL + 7 - CELL);
  });

  it('brings vacated cells in at rest', () => {
    const field = makeField(5, 4);
    for (let row = 0; row < 4; row++) {
      const index = row * 5;
      field.posX[index] += 9;
      field.velX[index] = 4;
    }

    scrollLatticeField(field, 5, 4, -1, 0);

    for (let row = 0; row < 4; row++) {
      const index = row * 5;
      expect(field.posX[index] - field.restX[index]).toBeCloseTo(0);
      expect(field.posY[index] - field.restY[index]).toBeCloseTo(0);
      expect(field.velX[index]).toBeCloseTo(0);
      expect(field.velY[index]).toBeCloseTo(0);
    }
  });

  it('resets everything when the shift is wider than the window', () => {
    const field = makeField(5, 4);
    field.posX[7] += 11;
    field.posY[12] += 6;
    field.velZ[3] = 8;

    scrollLatticeField(field, 5, 4, 99, 0);

    for (let index = 0; index < 20; index++) {
      expect(field.posX[index] - field.restX[index]).toBeCloseTo(0);
      expect(field.posY[index] - field.restY[index]).toBeCloseTo(0);
      expect(field.posZ[index]).toBeCloseTo(0);
      expect(field.velX[index]).toBeCloseTo(0);
      expect(field.velY[index]).toBeCloseTo(0);
      expect(field.velZ[index]).toBeCloseTo(0);
    }
  });

  it('leaves the field untouched for a zero shift', () => {
    const field = makeField(5, 4);
    const index = 1 * 5 + 3;
    field.posX[index] += 7;
    field.velY[index] = 3;

    scrollLatticeField(field, 5, 4, 0, 0);

    expect(field.posX[index] - field.restX[index]).toBeCloseTo(7);
    expect(field.velY[index]).toBeCloseTo(3);
  });
});
