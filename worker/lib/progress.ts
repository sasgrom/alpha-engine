/**
 * Shared progress reporter for worker entries (5c, owner ask: "when did it
 * start? how far is it? what's the ETA?"). Every line carries a wall-clock
 * timestamp, so the log alone answers "when did it start" (first line) and
 * "where is it now" (tail). Long stages get rate + ETA + elapsed.
 *
 * Watch live from another terminal:
 *   Get-Content worker\.runs\overnight.log -Tail 30 -Wait
 */
function hhmmss(d = new Date()): string {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}
function dur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 90) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export interface Progress {
  /** timestamped free-form line */
  log(msg: string): void;
  /** start of a unit of work (company etc.) */
  stage(msg: string): void;
  /** periodic progress inside a unit: rate + ETA + elapsed since stage start */
  item(done: number, total: number, extra?: string): void;
  /** unit done */
  stageDone(msg: string): void;
  /** whole run done: total elapsed */
  done(msg: string): void;
}

export function startProgress(label: string, config?: string): Progress {
  const runT0 = Date.now();
  let stageT0 = runT0;
  const p: Progress = {
    log: (msg) => console.log(`[${label} ${hhmmss()}] ${msg}`),
    stage: (msg) => { stageT0 = Date.now(); p.log(`▸ ${msg}`); },
    item: (done, total, extra) => {
      const el = Date.now() - stageT0;
      const rate = done > 0 && el > 0 ? done / (el / 60000) : 0;
      const eta = rate > 0 ? ` | ETA ${dur((total - done) / rate * 60000)}` : "";
      p.log(`${done}/${total}${extra ? ` (${extra})` : ""} | ${rate.toFixed(1)}/min${eta} | elapsed ${dur(el)}`);
    },
    stageDone: (msg) => p.log(`✓ ${msg} | stage ${dur(Date.now() - stageT0)}`),
    done: (msg) => p.log(`■ ${msg} | TOTAL ${dur(Date.now() - runT0)} (started ${new Date(runT0).toLocaleString("en-GB")})`),
  };
  p.log(`■ started ${new Date(runT0).toLocaleString("en-GB")}${config ? ` | ${config}` : ""}`);
  return p;
}
