/**
 * menuNavigation.ts
 *
 * Pure grid-navigation math for MenuNavigator. Index layout is row-major:
 * index = row × columns + col. The last row may be partial; any computed
 * target past the end clamps to the last item.
 */

/**
 * Compute the next selected index for a navigation step of (dx, dy) grid
 * cells. Wrap mode wraps each axis independently; otherwise both axes clamp
 * at the edges. Horizontal input is a geometric no-op when columns is 1.
 */
export function computeNextNavIndex(
  currentIndex: number,
  dx: number,
  dy: number,
  itemCount: number,
  columns: number,
  wrap: boolean,
): number {
  if (itemCount <= 0) return currentIndex;

  const currentCol = currentIndex % columns;
  const currentRow = Math.floor(currentIndex / columns);
  const totalRows = Math.ceil(itemCount / columns);

  let newCol = currentCol + dx;
  let newRow = currentRow + dy;

  if (wrap) {
    newCol = ((newCol % columns) + columns) % columns;
    newRow = ((newRow % totalRows) + totalRows) % totalRows;
  } else {
    newCol = Math.max(0, Math.min(columns - 1, newCol));
    newRow = Math.max(0, Math.min(totalRows - 1, newRow));
  }

  let newIndex = newRow * columns + newCol;

  // Clamp to valid range (last row may not be full).
  if (newIndex >= itemCount) {
    newIndex = itemCount - 1;
  }

  return newIndex;
}

export type HorizontalNavMode = 'grid' | 'item' | 'none';

/**
 * Decide how a left/right input is routed: multi-column layouts navigate the
 * grid; single-column lists hand the input to the focused item's own
 * onLeft/onRight handler (segmented pills, volume rows) when it has one.
 */
export function resolveHorizontalNav(columns: number, itemHasHandler: boolean): HorizontalNavMode {
  if (columns > 1) return 'grid';
  return itemHasHandler ? 'item' : 'none';
}
