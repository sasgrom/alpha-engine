import { JSDOM } from "jsdom";
import { isoDate, type HouseFiling } from "./congress-house";
import type { Candidate, CompanyIndex } from "./news-companies";

export interface CongressTrade {
  chamber: "house" | "senate";
  member: string;
  state: string | null;
  district: string | null;
  filer: "member" | "spouse" | "joint" | "child";
  reportId: string;
  filedDate: string;
  transactionDate: string;
  notificationDate: string | null;
  owner: string;
  asset: string;
  ticker: string | null;
  assetType: string;
  type: "purchase" | "sale" | "partial sale" | "exchange";
  amountLow: number | null;
  amountHigh: number | null;
  comment: string;
  parseMethod: "text PDF" | "HTML";
  sourceSha256: string;
  sourceUrl: string;
}

export interface ResolvedCongressTrade extends CongressTrade {
  resolution: "resolved" | "ambiguous" | "not a company";
  cik: number | null;
  candidates: Candidate[];
}

export function amountRange(value: string): { low: number | null; high: number | null } {
  const numbers = [...value.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map(match => Number(match[1].replaceAll(",", "")));
  if (!numbers.length) return { low: null, high: null };
  return { low: numbers[0], high: numbers[1] ?? (/over|more than|up to/i.test(value) && !/up to/i.test(value) ? null : numbers[0]) };
}

export function transactionType(value: string): CongressTrade["type"] {
  const normalized = value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/^(p|purchase|purchase of asset)$/.test(normalized)) return "purchase";
  if (/^(e|exchange)$/.test(normalized)) return "exchange";
  if (/^(s|sale|sale full|full sale)$/.test(normalized)) return "sale";
  if (/^(s partial|sale partial|partial sale|partial)$/.test(normalized)) return "partial sale";
  throw new Error(`Unknown congressional transaction type: ${value.slice(0, 60)}`);
}

const OWNER: Record<string, CongressTrade["filer"]> = { "": "member", SELF: "member", SP: "spouse", SPOUSE: "spouse", JT: "joint", JOINT: "joint", DC: "child", CHILD: "child", "DEPENDENT CHILD": "child" };
const ASSET_TYPES: Record<string, string> = { ST: "stock", OP: "option", BO: "bond", MF: "fund", ET: "fund", CS: "bond", GS: "bond", PS: "stock", RE: "real estate", OT: "other" };
const withOptionEvidence = (asset: string, assetType: string) => /\b(?:call|put)\b/i.test(asset) ? "option" : assetType;

export function parseHousePdfText(text: string, filing: HouseFiling, sourceSha256: string): CongressTrade[] {
  if (!(new RegExp(`Filing\\s+ID\\s*#\\s*${filing.docId}(?!\\d)`, "i")).test(text)) throw new Error(`House PDF text does not identify report ${filing.docId}`);
  if (!filing.filedDate) throw new Error(`House PTR ${filing.docId} has no filing date`);
  const trades: CongressTrade[] = [];
  const lines = text.split(/\r?\n/).map(raw => raw.replace(/\s+/g, " ").replace(/\b(?:gfedcb|gfedc|nmlkji|nmlkj|nmlk)\b/g, "").trim());
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    let continuation = "";
    if (/\$[\d,]+\s*-\s*$/.test(line) && lines[index + 1]) {
      const next = lines[index + 1].match(/^(.*?)\s*(\$[\d,]+)$/);
      if (next) {
        line = `${line} ${next[2]}`;
        continuation = next[1];
        index++;
      }
    }
    const match = line.match(/^(?:\d{7,}\s+)?(?:(SP|JT|DC|SELF)\s+)?(.+?)\s+(P|S(?:\s*\(partial\))?|E)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+((?:Over\s+)?\$[\d,]+(?:\s*-\s*\$[\d,]+)?)(?:\s+(.*))?$/i);
    if (!match) continue;
    if (lines[index + 1] && /\[[A-Z]{2}\]/i.test(lines[index + 1]) && !/\d{1,2}\/\d{1,2}\/\d{4}/.test(lines[index + 1])) {
      continuation = `${continuation} ${lines[index + 1]}`.trim();
      index++;
    }
    const [, rawOwner, rawAsset, rawType, traded, notified, rawAmount, comment = ""] = match;
    const asset = `${rawAsset} ${continuation}`.trim();
    const assetCode = asset.match(/\s+\[([A-Z]{2})\]\s*$/i)?.[1]?.toUpperCase() ?? null;
    const ticker = asset.match(/\(([A-Z][A-Z0-9.-]{0,11})\)/i)?.[1] ?? null;
    const amount = amountRange(rawAmount);
    const owner = (rawOwner ?? "").toUpperCase();
    trades.push({
      chamber: "house",
      member: filing.member,
      state: filing.state,
      district: filing.district,
      filer: OWNER[owner] ?? "member",
      reportId: filing.docId,
      filedDate: filing.filedDate,
      transactionDate: isoDate(traded),
      notificationDate: isoDate(notified),
      owner,
      asset,
      ticker,
      assetType: withOptionEvidence(asset, ASSET_TYPES[assetCode ?? ""] ?? (ticker ? "stock" : "other")),
      type: transactionType(rawType),
      amountLow: amount.low,
      amountHigh: amount.high,
      comment: comment.trim(),
      parseMethod: "text PDF",
      sourceSha256,
      sourceUrl: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filing.year}/${filing.docId}.pdf`,
    });
  }
  return trades;
}

export interface SenateSearchReport {
  firstName: string;
  lastName: string;
  member: string;
  reportId: string;
  filedDate: string;
  sourceUrl: string;
  sourceKind: "ptr" | "paper";
}

export function parseSenateSearchRows(data: unknown): SenateSearchReport[] {
  if (!Array.isArray(data)) throw new Error("Senate search data is not an array");
  const reports = data.map(row => {
    if (!Array.isArray(row) || row.length < 5) throw new Error("Senate search row has fewer than five columns");
    const document = new JSDOM(String(row[3])).window.document;
    const href = document.querySelector("a")?.getAttribute("href") ?? "";
    const match = href.match(/^\/search\/view\/(ptr|paper)\/([0-9a-f-]{36})\/$/i);
    if (!match) throw new Error(`Senate search row has no PTR link: ${href.slice(0, 100)}`);
    return {
      firstName: String(row[0]).trim(),
      lastName: String(row[1]).trim(),
      member: String(row[2]).replace(/\s*\([^)]*\)\s*$/, "").trim(),
      reportId: match[2],
      filedDate: isoDate(String(row[4])),
      sourceUrl: `https://efdsearch.senate.gov${href}`,
      sourceKind: match[1].toLowerCase() as "ptr" | "paper",
    };
  });
  const unique = new Map<string, SenateSearchReport>();
  for (const report of reports) {
    const previous = unique.get(report.reportId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(report)) throw new Error(`Conflicting Senate PTR ${report.reportId}`);
    unique.set(report.reportId, report);
  }
  return [...unique.values()];
}

export interface SenateReportMetadata {
  member: string;
  state: string | null;
  district: string | null;
  reportId: string;
  filedDate: string;
  sourceSha256: string;
  sourceUrl: string;
}

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const cell = (cells: string[], headers: string[], names: string[]) => {
  const index = headers.findIndex(header => names.includes(header));
  return index < 0 ? "" : cells[index] ?? "";
};

export function parseSenateHtml(html: string, report: SenateReportMetadata): CongressTrade[] {
  const document = new JSDOM(html).window.document;
  const table = [...document.querySelectorAll("table")].find(candidate => {
    const headers = [...candidate.querySelectorAll("thead th")].map(node => headerKey(node.textContent ?? ""));
    return headers.includes("amount") && headers.some(header => header === "asset" || header === "asset name") && headers.some(header => header === "date" || header === "transaction date");
  });
  if (!table) throw new Error(`Senate report ${report.reportId} has no electronic transaction table`);
  const headers = [...table.querySelectorAll("thead th")].map(node => headerKey(node.textContent ?? ""));
  const trades: CongressTrade[] = [];
  for (const row of table.querySelectorAll("tbody tr")) {
    const cells = [...row.querySelectorAll("td")].map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim());
    if (!cells.length || cells.every(value => !value)) continue;
    const date = cell(cells, headers, ["transaction date", "date"]);
    const asset = cell(cells, headers, ["asset", "asset name"]);
    const rawType = cell(cells, headers, ["transaction type", "type"]);
    if (!date && !asset && !rawType) continue;
    const rawOwner = cell(cells, headers, ["owner"]).toUpperCase();
    const amount = amountRange(cell(cells, headers, ["amount"]));
    const ticker = cell(cells, headers, ["ticker"]).replace(/^--$/, "");
    trades.push({
      chamber: "senate",
      member: report.member,
      state: report.state,
      district: report.district,
      filer: OWNER[rawOwner] ?? "member",
      reportId: report.reportId,
      filedDate: report.filedDate,
      transactionDate: isoDate(date),
      notificationDate: null,
      owner: rawOwner,
      asset,
      ticker: ticker || null,
      assetType: withOptionEvidence(asset, cell(cells, headers, ["asset type"]).toLowerCase() || "other"),
      type: transactionType(rawType),
      amountLow: amount.low,
      amountHigh: amount.high,
      comment: cell(cells, headers, ["comment", "comments"]),
      parseMethod: "HTML",
      sourceSha256: report.sourceSha256,
      sourceUrl: report.sourceUrl,
    });
  }
  return trades;
}

export function resolveCongressTrade(index: CompanyIndex, trade: CongressTrade): ResolvedCongressTrade {
  const candidates = index.candidates(trade.asset, trade.ticker, 8);
  const resolved = index.resolve(trade.asset, trade.ticker);
  return {
    ...trade,
    resolution: resolved ? "resolved" : candidates.length ? "ambiguous" : "not a company",
    cik: resolved?.cik ?? null,
    candidates,
  };
}
