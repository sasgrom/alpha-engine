/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk 2000): items, largest first, are placed in rows along the
 * shorter side of the remaining rectangle; a row grows while that improves its worst aspect ratio.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
  value: number;
}

function worstRatio(row: number[], length: number): number {
  const sum = row.reduce((total, area) => total + area, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
}

export function squarify<T>(items: { value: number; item: T }[], rect: Rect): Tile<T>[] {
  const data = items.filter((entry) => Number.isFinite(entry.value) && entry.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  if (!data.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = data.map((entry) => entry.value * scale);
  const tiles: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let start = 0;
  while (start < areas.length) {
    const length = Math.min(w, h);
    let end = start + 1;
    while (end < areas.length && worstRatio(areas.slice(start, end + 1), length) <= worstRatio(areas.slice(start, end), length)) end++;
    const row = areas.slice(start, end);
    const rowArea = row.reduce((sum, area) => sum + area, 0);
    const last = end === areas.length;
    if (w >= h) {
      // a column along the left side
      const columnWidth = last ? w : rowArea / h;
      let cursor = y;
      row.forEach((area, index) => {
        const height = index === row.length - 1 ? y + h - cursor : area / columnWidth;
        tiles.push({ x, y: cursor, w: columnWidth, h: height, item: data[start + index].item, value: data[start + index].value });
        cursor += height;
      });
      x += columnWidth;
      w -= columnWidth;
    } else {
      // a row along the top
      const rowHeight = last ? h : rowArea / w;
      let cursor = x;
      row.forEach((area, index) => {
        const width = index === row.length - 1 ? x + w - cursor : area / rowHeight;
        tiles.push({ x: cursor, y, w: width, h: rowHeight, item: data[start + index].item, value: data[start + index].value });
        cursor += width;
      });
      y += rowHeight;
      h -= rowHeight;
    }
    start = end;
  }
  return tiles;
}
