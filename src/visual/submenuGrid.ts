/**
 * submenuGrid — pure layout math for SubmenuOverlay's card grid.
 *
 * Split out so the arithmetic can be pinned by tests; the Phaser half is
 * verified by play.
 */

export interface SubmenuGridInput {
  entryCount: number;
  viewportWidth: number;
  viewportHeight: number;
  /**
   * computeHudScale(...) — density-aware, so a row keeps a finger-sized
   * physical height on a phone instead of the ~35 CSS px the menu font
   * scales' capped density would leave it at.
   */
  hudScale: number;
  /** Vertical space the title block and the hint line already claim. */
  reservedHeight: number;
}

export interface SubmenuGrid {
  columns: number;
  rows: number;
  cardWidth: number;
  rowHeight: number;
  columnGap: number;
  rowGap: number;
  gridWidth: number;
  gridHeight: number;
}

const BASE_ROW_HEIGHT = 64;
const BASE_MAX_CARD_WIDTH = 560;
const BASE_MARGIN = 24;
const BASE_COLUMN_GAP = 16;
const BASE_ROW_GAP = 14;
const MIN_ROW_HEIGHT = 40;
const MAX_COLUMNS = 3;

export function computeSubmenuGrid(input: SubmenuGridInput): SubmenuGrid {
  const { entryCount, viewportWidth, viewportHeight, hudScale, reservedHeight } = input;
  const count = Math.max(1, Math.floor(entryCount));
  const scaled = (base: number) => Math.max(1, Math.round(base * hudScale));

  const portrait = viewportHeight > viewportWidth;
  const columns = portrait ? 1 : Math.min(MAX_COLUMNS, count);
  const rows = Math.ceil(count / columns);

  const margin = scaled(BASE_MARGIN);
  const columnGap = scaled(BASE_COLUMN_GAP);
  const rowGap = scaled(BASE_ROW_GAP);

  const availableWidth = Math.max(1, viewportWidth - margin * 2);
  const cardWidth = Math.max(
    1,
    Math.min(
      scaled(BASE_MAX_CARD_WIDTH),
      Math.floor((availableWidth - columnGap * (columns - 1)) / columns),
    ),
  );

  const availableHeight = Math.max(1, viewportHeight - reservedHeight - margin * 2);
  const rowBudget = Math.floor((availableHeight - rowGap * (rows - 1)) / rows);
  const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.min(scaled(BASE_ROW_HEIGHT), rowBudget));

  return {
    columns,
    rows,
    cardWidth,
    rowHeight,
    columnGap,
    rowGap,
    gridWidth: cardWidth * columns + columnGap * (columns - 1),
    gridHeight: rowHeight * rows + rowGap * (rows - 1),
  };
}
