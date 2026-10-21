/**
 * Defensive header-driven parser for Wikipedia constituent tables.
 *
 * Why header-driven: the three index lists we consume (S&P 500, NASDAQ-100,
 * Dow Jones) put the ticker in DIFFERENT columns (S&P: "Symbol" col 1 with
 * id="constituents"; NDX: "Ticker" col 1; Dow: "Symbol" col 3), and Wikipedia
 * editors reorder/add columns without notice. Parsing by fixed column index
 * breaks silently; parsing by header NAME fails loudly (column not found =>
 * empty result => caller throws), which is what we want for a data pipeline.
 *
 * Scope: deliberately minimal regex parser (no DOM dependency — this module
 * runs inside the API server where jsdom is not loaded). It only understands
 * flat tables: no rowspan/colspan support, because the three target tables
 * are flat grids. If Wikipedia ever adds spanning cells, the affected column
 * values will misalign — the unit tests in wikitable.test.ts pin the current
 * table shapes with fixtures so we notice on the next dependency run.
 */

/** One parsed table: header names (verbatim, trimmed) + row cell strings. */
export interface WikiTable {
  headers: string[];
  rows: string[][];
}

/** Decode the small set of HTML entities Wikipedia actually emits in cells. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#038;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Strip tags + entities + collapse whitespace — the canonical cell text. */
export function cellText(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract every <table> whose first row consists of <th> cells.
 * Optionally restrict to a table with a specific id attribute
 * (S&P 500 uses id="constituents"; passing an id avoids accidentally
 * picking up a navbox or infobox when page layout changes).
 */
export function parseWikiTables(html: string, tableId?: string): WikiTable[] {
  const tables: WikiTable[] = [];
  // non-greedy up to the first closing </table> — target tables contain no
  // nested tables (verified against live pages 2026-10; fixture-pinned)
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const tableHtml = tm[0];
    if (tableId && !new RegExp(`id="${tableId}"`).test(tableHtml.slice(0, 200))) continue;
    const rows: string[][] = [];
    let headers: string[] | null = null;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(tableHtml)) !== null) {
      const rowHtml = rm[1];
      // header row: contains <th>; data row: <td>. A row mixing both (rowspan
      // headers) is treated as data — does not occur in our target tables.
      const isHeader = /<th[\s>]/.test(rowHtml);
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g;
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rowHtml)) !== null) cells.push(cellText(cm[1]));
      if (cells.length === 0) continue;
      if (isHeader && headers === null) {
        headers = cells;
      } else if (headers !== null) {
        rows.push(cells);
      }
      // rows before the first header (caption rows) are ignored
    }
    if (headers && rows.length > 0) tables.push({ headers, rows });
  }
  return tables;
}

/**
 * Project a parsed table onto named columns, matched by header regex.
 * Returns one record per row; columns not found yield null (caller decides
 * whether a missing column is fatal — ticker is, sector is not).
 */
export function projectColumns(
  table: WikiTable,
  columns: Record<string, RegExp>
): Record<string, string | null>[] {
  // resolve each requested column to its index in the header row (once)
  const idx: Record<string, number> = {};
  for (const [key, re] of Object.entries(columns)) {
    idx[key] = table.headers.findIndex((h) => re.test(h));
  }
  return table.rows.map((cells) => {
    const rec: Record<string, string | null> = {};
    for (const key of Object.keys(columns)) {
      const i = idx[key];
      rec[key] = i >= 0 && i < cells.length ? cells[i] || null : null;
    }
    return rec;
  });
}
