// Keep these dimensions in sync with the row/card styles.
export const LIST_ROW_HEIGHT = 62;
export const GRID_ROW_HEIGHT = 137;
export const GRID_ITEM_WIDTH = 100;
export const OVERSCAN_ROWS = 3;

export function getVirtualWindow({
  count,
  columns = 1,
  rowHeight,
  top,
  height,
}) {
  const rows = Math.ceil(count / columns);
  const firstRow = Math.min(
    Math.max(0, rows - 1),
    Math.floor(Math.max(0, top) / rowHeight)
  );
  const startRow = Math.max(0, firstRow - OVERSCAN_ROWS);
  const endRow = Math.min(
    rows,
    Math.max(firstRow + 1, Math.ceil((Math.max(0, top) + height) / rowHeight)) +
      OVERSCAN_ROWS
  );

  return {
    start: startRow * columns,
    end: Math.min(count, endRow * columns),
    before: startRow * rowHeight,
    after: Math.max(0, rows - endRow) * rowHeight,
    totalHeight: rows * rowHeight,
  };
}

export function getScrollTopForIndex({
  index,
  columns,
  rowHeight,
  scrollTop,
  height,
  offset,
  headerHeight,
}) {
  const top = offset + Math.floor(index / columns) * rowHeight;
  const bottom = top + rowHeight;

  if (top < scrollTop + headerHeight) {
    return Math.max(0, top - headerHeight);
  }

  if (bottom > scrollTop + height) {
    return Math.max(0, bottom - height);
  }

  return scrollTop;
}
