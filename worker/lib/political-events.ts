import { endOfUtcDay, sha256Text } from "./fred";

export interface PoliticalEvent {
  eventId: string;
  source: "OFAC";
  title: string;
  publishedAt: string;
  availablePrecision: "day";
  researchEligibleAt: string;
  effectiveAt: null;
  sourceUrl: string;
  ingestedAt: string;
  sourceHash: string;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { "&amp;": "&", "&quot;": "\"", "&#039;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
  let text = value;
  for (const [entity, replacement] of Object.entries(named)) text = text.split(entity).join(replacement);
  return text.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function isoDate(month: string, day: string, year: string): string {
  const months: Record<string, string> = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };
  const number = months[month];
  if (!number) throw new Error(`Unknown OFAC month ${month}`);
  return `${year}-${number}-${day.padStart(2, "0")}`;
}

export function parseOfacRecentActions(html: string, ingestedAt: string): PoliticalEvent[] {
  const sourceHash = sha256Text(html);
  const events: PoliticalEvent[] = [];
  const pattern = /<a href="(\/recent-actions\/(\d{8}))"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s*-/g;
  for (const match of html.matchAll(pattern)) {
    const [, relativeUrl, numericId, rawTitle, month, day, year] = match;
    const date = isoDate(month, day, year);
    const title = decodeHtml(rawTitle);
    if (!title) continue;
    events.push({
      eventId: `ofac:${numericId}`,
      source: "OFAC",
      title,
      publishedAt: `${date}T00:00:00.000Z`,
      availablePrecision: "day",
      researchEligibleAt: endOfUtcDay(date),
      effectiveAt: null,
      sourceUrl: `https://ofac.treasury.gov${relativeUrl}`,
      ingestedAt,
      sourceHash,
    });
  }
  return events.sort((a, b) => a.eventId.localeCompare(b.eventId));
}

export function mergePoliticalEvents(previous: PoliticalEvent[], current: PoliticalEvent[]): PoliticalEvent[] {
  const events = new Map(previous.map((event) => [event.eventId, event]));
  for (const event of current) events.set(event.eventId, event);
  return [...events.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.eventId.localeCompare(b.eventId));
}
