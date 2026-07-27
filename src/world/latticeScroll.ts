/**
 * latticeScroll — pure index math for sliding GridBackground's screen-sized spring
 * lattice across a larger world.
 *
 * The lattice never grows. Its window snaps to whole cells so rendered lines coincide
 * with the world's fixed 40 px grid, and the per-node simulation state is shifted by the
 * same whole-cell amount, so a ripple in flight stays pinned to the world position where
 * it started instead of riding the screen.
 */

/** Largest whole-cell multiple at or below `scroll`. Floors for negative scrolls too. */
export function snappedOrigin(scroll: number, cellSize: number): number {
  return Math.floor(scroll / cellSize) * cellSize;
}

/** The mutable per-node arrays GridBackground simulates, in row-major order. */
export interface LatticeField {
  restX: Float32Array;
  restY: Float32Array;
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
}

/**
 * Shift every node's displacement-from-rest and its velocity by whole cells: the node
 * now standing at (col, row) inherits the state of the node that used to stand at
 * (col + cellShiftX, row + cellShiftY). Nodes whose source falls outside the window
 * enter at rest. Runs in place with no allocation.
 *
 * `inverseMass` and `dampingArr` are deliberately NOT shifted: they are properties of a
 * window position (the immovable border ring) rather than of a world position, so the
 * pinned ring must stay at the window edge.
 */
export function scrollLatticeField(
  field: LatticeField,
  numCols: number,
  numRows: number,
  cellShiftX: number,
  cellShiftY: number,
): void {
  if (cellShiftX === 0 && cellShiftY === 0) return;

  const total = numCols * numRows;
  // Source index is always target + flatShift, so walking away from the source keeps
  // every read ahead of the writes and the shift stays allocation-free.
  const flatShift = cellShiftY * numCols + cellShiftX;
  const ascending = flatShift > 0;

  for (let step = 0; step < total; step++) {
    const target = ascending ? step : total - 1 - step;
    const targetCol = target % numCols;
    const targetRow = (target - targetCol) / numCols;
    const sourceCol = targetCol + cellShiftX;
    const sourceRow = targetRow + cellShiftY;

    if (sourceCol < 0 || sourceCol >= numCols || sourceRow < 0 || sourceRow >= numRows) {
      field.posX[target] = field.restX[target];
      field.posY[target] = field.restY[target];
      field.posZ[target] = 0;
      field.velX[target] = 0;
      field.velY[target] = 0;
      field.velZ[target] = 0;
      continue;
    }

    const source = sourceRow * numCols + sourceCol;
    field.posX[target] = field.restX[target] + (field.posX[source] - field.restX[source]);
    field.posY[target] = field.restY[target] + (field.posY[source] - field.restY[source]);
    field.posZ[target] = field.posZ[source];
    field.velX[target] = field.velX[source];
    field.velY[target] = field.velY[source];
    field.velZ[target] = field.velZ[source];
  }
}
