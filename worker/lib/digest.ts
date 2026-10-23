/**
 * 5e — morning-digest prompt builder (pure, unit-tested). The local model
 * gets the last-window signals (already pre-digested: edgar whys, stocktwits
 * crowd reads) and writes ONE brief for humans. Input-heavy, tiny output —
 * the exact profile that makes the home GPU cheap (owner's arithmetic 5c).
 */

export interface DigestSignal {
  ticker: string | null;
  source: string;      // edgar | stocktwits | …
  signalType: string;  // tone | buzz | label
  eventTs: string;
  score: number | null;
  magnitude: number | null;
  note: string | null;
}

const fmtScore = (s: number | null) => (s === null ? "n/a" : (s >= 0 ? "+" : "") + s.toFixed(2));

export function buildDigestPrompt(forDate: string, rows: DigestSignal[]): string {
  const byTicker = new Map<string, DigestSignal[]>();
  for (const r of rows) {
    const t = r.ticker ?? `CIK?`;
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t)!.push(r);
  }
  const sections = [...byTicker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, rs]) => {
      const lines = rs.map((r) => {
        const what = r.note ? ` — ${r.note.replace(/\s+/g, " ").slice(0, 300)}` : "";
        const mag = r.signalType === "buzz" && r.magnitude != null ? `, ${r.magnitude} msgs` : "";
        return `- [${r.source}/${r.signalType}] mood ${fmtScore(r.score)}${mag}${what}`;
      });
      return `${t}:\n${lines.join("\n")}`;
    })
    .join("\n\n");

  return `You are writing the morning brief of an investment terminal for ${forDate}. Below are yesterday's machine signals per company: SEC filing tone (with model summaries), Stocktwits crowd mood and message volume.

Write the brief in English, Markdown, at most 250 words:
- One line per company that actually has news (skip silent tickers): **TICKER** — what happened, mood, why it matters.
- Separate any SEC filing facts from crowd chatter — never blend them into one claim.
- End with one "Tape:" line — the overall mood across the universe.
Facts ONLY from the data below; if a number is not there, do not invent it. No headers beyond the company lines, no preamble.

SIGNALS:
"""
${sections.slice(0, 60000)}
"""`;
}
