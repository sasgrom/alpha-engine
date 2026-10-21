/**
 * Captcha service (4d, D33) — self-contained SVG math captcha: no external
 * provider, no keys, nothing billed. The server issues {id, svg}; the answer
 * is stored only as a SHA-256 hash with a 5-minute TTL and is one-shot
 * (verified or expired entries are destroyed). In-process store — the
 * single-instance deployment makes this exact (D25).
 *
 * Rendering: per-character rotation/jitter + noise strokes, dark-theme
 * palette — enough to defeat trivial OCR/autofill without punishing humans.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

const TTL_MS = 5 * 60_000;
const store = new Map<string, { answerHash: string; exp: number }>();

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export function issueCaptcha(): { id: string; svg: string } {
  const a = randomInt(2, 20);
  const b = randomInt(1, 19);
  const minus = a > b && randomInt(0, 2) === 1;
  const answer = String(minus ? a - b : a + b);
  const text = `${a} ${minus ? "−" : "+"} ${b} = ?`;

  const id = randomBytes(16).toString("hex");
  store.set(id, { answerHash: hash(answer), exp: Date.now() + TTL_MS });
  // lazy sweep so the map cannot grow unbounded under attack
  for (const [k, v] of store) if (v.exp < Date.now()) store.delete(k);

  const W = 160, H = 48;
  const chars = [...text].map((ch, i) => {
    const x = 14 + i * 18 + randomInt(-3, 4);
    const y = 30 + randomInt(-5, 6);
    const rot = randomInt(-25, 26);
    const fill = ["#e8f6f8", "#53d9ec", "#9adce8", "#cdeef4"][randomInt(0, 4)];
    return `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" fill="${fill}" font-family="monospace" font-size="20" font-weight="700">${esc(ch)}</text>`;
  });
  const noise = Array.from({ length: 4 }, () => {
    const x1 = randomInt(0, W / 2), y1 = randomInt(0, H), x2 = randomInt(W / 2, W), y2 = randomInt(0, H);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="hsl(223 42% 25%)" stroke-width="1"/>`;
  });
  const dots = Array.from({ length: 24 }, () =>
    `<circle cx="${randomInt(0, W)}" cy="${randomInt(0, H)}" r="1" fill="hsl(223 30% 30%)"/>`
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="hsl(222 45% 9%)" rx="6"/>` +
    noise.join("") + dots.join("") + chars.join("") +
    `</svg>`;
  return { id, svg };
}

/** One-shot verification; expired/missing ids fail closed. */
export function verifyCaptcha(id: string | undefined, answer: string | undefined): boolean {
  if (!id || !answer) return false;
  const rec = store.get(id);
  store.delete(id); // one-shot regardless of outcome
  if (!rec || rec.exp < Date.now()) return false;
  return rec.answerHash === hash(answer.trim());
}
