/**
 * Local LLM test bench (home worker). Run: npx tsx worker/llm-test.mts
 *
 * Verifies the Ollama setup end to end: daemon alive, model pulled, then
 * scores 5 CANONICAL financial snippets with known expected signs and prints
 * a speed/quality report. Nothing is sent anywhere — pure local check.
 */
import "dotenv/config";
import { generate, status, extractVerdict, tonePrompt, LLM_MODEL } from "./lib/ollama";

const CASES: { text: string; want: "pos" | "neg" | "zero" }[] = [
  { want: "pos", text: "Microsoft beats expectations: Azure revenue up 29%, operating margin expands to 44%, guidance raised for the fiscal year." },
  { want: "neg", text: "AT&T misses on earnings, cuts dividend outlook amid rising debt; wireless subscriber losses accelerate in the quarter." },
  { want: "zero", text: "Prologis announced it will hold its annual shareholder meeting on May 4. Agenda items include board election and auditor ratification." },
  { want: "pos", text: "NVIDIA data center revenue doubles year over year as Blackwell demand exceeds supply; gross margin holds above 74%." },
  { want: "neg", text: "Apple faces antitrust ruling requiring App Store fee changes; services growth slows to its weakest pace in two years, China sales slide." },
];
const signOf = (s: number | null) => (s === null ? "null" : s > 0.15 ? "pos" : s < -0.15 ? "neg" : "zero");

const st = await status();
if (!st.ok) {
  console.error("[llm-test] Ollama daemon not reachable at 127.0.0.1:11434 — is it installed and running? (ollama serve)");
  process.exit(1);
}
console.log(`[llm-test] daemon ok; models: ${st.models.join(", ") || "(none)"}`);
if (!st.models.some((m) => m.startsWith(LLM_MODEL.split(":")[0]))) {
  console.error(`[llm-test] model ${LLM_MODEL} not pulled yet:  ollama pull ${LLM_MODEL}`);
  process.exit(1);
}

// warmup (first load can be slow — honest timing measured AFTER it)
console.log("[llm-test] warmup…");
await generate("Say ok.", { numPredict: 8 });

let pass = 0, totTok = 0, totMs = 0;
for (const c of CASES) {
  const r = await generate(tonePrompt(c.text));
  const v = extractVerdict(r.text);
  const score = v?.score ?? null;
  const got = signOf(score);
  const ok = got === c.want;
  if (ok) pass++;
  totTok += r.evalCount; totMs += r.totalMs;
  console.log(`[llm-test] want=${c.want.padEnd(4)} got=${got.padEnd(4)} score=${score ?? "—"}\t${ok ? "OK " : "MISS"}  (${r.evalPerSec} tok/s)  ${c.text.slice(0, 70)}…`);
  if (v?.why) console.log(`           why: ${v.why}`);
}
console.log(`[llm-test] DONE: ${pass}/${CASES.length} sign-correct, model ${LLM_MODEL}, avg ${Math.round(totMs / CASES.length)} ms/case, ${totTok} tokens total`);
