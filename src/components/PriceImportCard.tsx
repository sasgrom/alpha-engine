// Admin tool card for the Stage 1.7 bulk price archive import (3g/3k, D26).
//
// TEMPORARY CRUTCH (marked TODO throughout the codebase and manuals):
// the cloud runtime cannot reach stooq.com / Yahoo directly, so the operator
// uploads the Stooq daily zip from the browser.
//
// Upload engine (3k):
//  - MULTI-FILE: select all pre-split parts at once (`split -b 32m`,
//    7-Zip volumes .001/.002…) or just the whole zip — files are sorted
//    name-numerically and treated as one byte stream;
//  - ADAPTIVE SLICING: each file is cut into pieces starting at 8 MB; on an
//    HTTP 413 (the platform edge rejects large bodies before our code runs)
//    the piece size is halved GLOBALLY and the batch restarts under a new id
//    (piece indices are positional — a size change re-plans the whole batch);
//  - RETRIES: a network error retries the piece 3× with backoff;
//  - RESUME: batch id + piece size + file list persist in localStorage; after
//    a crash/reload the owner re-selects the same files and every part index
    //    already stored (server-side listing) is skipped.
// Parts are never deleted on Reset — the user directive keeps them in
// storage as the sample archive. TODO: full-history import later; the home
// worker eventually replaces manual upload entirely.

import { useEffect, useRef, useState } from "react";
import { Archive, Upload, Play, RotateCcw } from "lucide-react";
import { jobToast } from "@/lib/job-toast";
import { trpc } from "@/providers/trpc";

const INITIAL_PIECE = 8 * 1024 * 1024; // below common edge limits; halves on 413
const MIN_PIECE = 1 * 1024 * 1024;
const LS_KEY = "pricesImportBatch.v1";

interface BatchRecord {
  batch: string;
  pieceSize: number;
  files: { name: string; size: number }[];
  updatedAt: string;
}

type Phase = "idle" | "uploading" | "uploaded" | "launching";

/** name-numeric sort: part_9 before part_10, .002 before .010 */
const byNameNumeric = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true });

const filesMatch = (files: File[], rec: BatchRecord) =>
  files.length === rec.files.length &&
  [...files].sort(byNameNumeric).every((f, i) => f.name === rec.files[i].name && f.size === rec.files[i].size);

export function PriceImportCard() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resume, setResume] = useState<BatchRecord | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setResume(JSON.parse(raw) as BatchRecord);
    } catch { /* corrupted record — ignore */ }
  }, []);

  const startImport = trpc.prices.startImport.useMutation({
    onSuccess: () => {
      jobToast("success", "Import job launched", "watch the Jobs page");
      utils.jobs.list.invalidate();
      localStorage.removeItem(LS_KEY);
      setPhase("uploaded");
    },
    onError: (e) => jobToast("error", "Import launch failed", e.message),
  });

  /** POST one piece with retries; returns "ok" | "413" | throws on final fail */
  const sendPiece = async (batchId: string, idx: number, blob: Blob): Promise<"ok" | "413"> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`/api/prices-import/chunk?batch=${batchId}&idx=${idx}`, {
          method: "POST",
          body: blob,
          credentials: "include",
        });
        if (res.ok) return "ok";
        if (res.status === 413) return "413"; // edge limit — caller re-plans globally
        if (res.status >= 500 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt)); // transient server
          continue;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `part ${idx} failed (HTTP ${res.status})`);
      } catch (e) {
        if (e instanceof TypeError && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt)); // network blip
          continue;
        }
        throw e;
      }
    }
    return "ok"; // unreachable
  };

  const upload = async () => {
    if (files.length === 0) return;
    const sorted = [...files].sort(byNameNumeric);

    // resume: same file set as the persisted record → keep the batch id and
    // skip indices the server already holds
    let rec = resume && filesMatch(sorted, resume) ? resume : null;
    let batchId = rec?.batch ?? crypto.randomUUID();
    let pieceSize = rec?.pieceSize ?? INITIAL_PIECE;
    let skip = new Set<number>();
    if (rec) {
      try {
        const res = await fetch(`/api/prices-import/parts?batch=${batchId}`, { credentials: "include" });
        if (res.ok) skip = new Set(((await res.json()) as { indices: number[] }).indices);
      } catch { /* listing failed — re-upload everything */ }
    }

    setPhase("uploading");

    // adaptive loop: a 413 halves the piece size globally and restarts the
    // batch under a NEW id (indices are positional — sizes must be uniform)
    for (;;) {
      const totalBytes = sorted.reduce((s, f) => s + f.size, 0);
      // global piece plan across all files, in order
      const plan: { file: File; offset: number }[] = [];
      for (const f of sorted) for (let off = 0; off < f.size; off += pieceSize) plan.push({ file: f, offset: off });
      const planSizes = plan.map((p) => Math.min(pieceSize, p.file.size - p.offset));
      let uploaded = planSizes.filter((_, i) => skip.has(i)).reduce((s, n) => s + n, 0);
      setProgress({ done: uploaded, total: totalBytes });

      let hit413 = false;
      try {
        for (let i = 0; i < plan.length; i++) {
          if (skip.has(i)) continue;
          const p = plan[i];
          const slice = p.file.slice(p.offset, p.offset + pieceSize);
          const r = await sendPiece(batchId, i, slice);
          if (r === "413") { hit413 = true; break; }
          uploaded += planSizes[i];
          setProgress({ done: uploaded, total: totalBytes });
        }
      } catch (e) {
        // persisted record lets the owner resume after a crash
        localStorage.setItem(LS_KEY, JSON.stringify({
          batch: batchId, pieceSize,
          files: sorted.map((f) => ({ name: f.name, size: f.size })),
          updatedAt: new Date().toISOString(),
        } satisfies BatchRecord));
        jobToast("error", "Upload paused", e instanceof Error ? e.message : String(e));
        setPhase("idle");
        setProgress(null);
        setResume(JSON.parse(localStorage.getItem(LS_KEY)!) as BatchRecord);
        return;
      }

      if (hit413) {
        if (pieceSize <= MIN_PIECE) {
          jobToast("error", "Upload failed", `the platform edge rejects even ${MIN_PIECE / 1048576} MB bodies`);
          setPhase("idle");
          setProgress(null);
          return;
        }
        pieceSize = Math.max(MIN_PIECE, pieceSize / 2);
        batchId = crypto.randomUUID(); // re-plan under a fresh batch
        skip = new Set();
        jobToast("warning", "Edge rejected the piece size", `restarting with ${pieceSize / 1048576} MB parts`);
        continue;
      }

      // fully uploaded
      const finalRec: BatchRecord = {
        batch: batchId, pieceSize,
        files: sorted.map((f) => ({ name: f.name, size: f.size })),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(finalRec));
      setBatch(batchId);
      setPhase("uploaded");
      jobToast("success", `${plan.length} parts uploaded (${(totalBytes / 1048576).toFixed(0)} MB)`, "ready to import");
      return;
    }
  };

  const reset = () => {
    // parts stay in storage on purpose (sample archive directive) — Reset
    // only clears the local upload state
    localStorage.removeItem(LS_KEY);
    setPhase("idle");
    setFiles([]);
    setBatch(null);
    setProgress(null);
    setResume(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const mb = (n: number) => (n / 1048576).toFixed(0);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="panel p-4 sm:col-span-2">
      <div className="flex items-center gap-2 t-mono text-xs uppercase tracking-widest text-live-cyan">
        <Archive size={13} />
        Bulk price archive import (stage 1.7)
      </div>
      <p className="mt-2 text-[11px] text-crit-amber uppercase tracking-wide">
        Temporary crutch — imports universe tickers + SPY only; parts kept in storage as the sample archive. TODO: full-history import later.
      </p>
      <p className="mt-1 text-[11px] text-[var(--ink-3)]">
        Select ALL pre-split parts at once (split -b 32m / 7-Zip volumes) or the whole zip — adaptive slicing restarts smaller if the platform edge rejects a part (HTTP 413). Interrupted uploads resume: re-select the same files.
      </p>

      {resume && phase === "idle" && files.length === 0 && (
        <div className="mt-2 t-mono text-[11px] text-warn-amber">
          unfinished batch {resume.batch.slice(0, 8)}… ({resume.files.length} files, {resume.pieceSize / 1048576} MB parts) — re-select the same files to resume, or Reset
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          disabled={phase === "uploading" || phase === "launching"}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-xs text-[var(--ink-3)] file:mr-3 file:border file:border-[var(--line)] file:bg-transparent file:px-3 file:py-1.5 file:text-[11px] file:uppercase file:tracking-wider file:text-[var(--ink)] hover:file:border-live-cyan file:cursor-pointer"
        />
        {phase === "idle" && files.length > 0 && (
          <button
            onClick={upload}
            className="inline-flex items-center gap-1.5 border border-[var(--line)] px-3 py-1.5 text-[11px] uppercase tracking-wider hover:border-live-cyan"
          >
            <Upload size={12} /> Upload {files.length > 1 ? `${files.length} files ` : ""}({mb(totalBytes)} MB)
          </button>
        )}
        {phase === "uploading" && progress && (
          <span className="t-mono text-xs text-live-cyan">
            {mb(progress.done)}/{mb(progress.total)} MB
          </span>
        )}
        {phase === "uploaded" && batch && (
          <>
            <span className="t-mono text-xs text-ok-green">uploaded · batch {batch.slice(0, 8)}…</span>
            <button
              onClick={() => { setPhase("launching"); startImport.mutate({ batch }); }}
              disabled={startImport.isPending}
              className="inline-flex items-center gap-1.5 border border-live-cyan px-3 py-1.5 text-[11px] uppercase tracking-wider text-live-cyan hover:bg-live-cyan/10 disabled:opacity-50"
            >
              <Play size={12} /> Start import
            </button>
            <button onClick={reset} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--ink-3)] hover:text-[var(--ink)]">
              <RotateCcw size={12} /> Reset
            </button>
          </>
        )}
        {phase === "idle" && resume && files.length === 0 && (
          <button onClick={reset} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--ink-3)] hover:text-[var(--ink)]">
            <RotateCcw size={12} /> Clear saved batch
          </button>
        )}
      </div>
    </div>
  );
}
