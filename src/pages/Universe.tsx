import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { jobToast } from "@/lib/job-toast";
import { fmtFyEnd } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { Search, Plus, DownloadCloud, ChevronLeft, ChevronRight, Save, X, RefreshCw, Trash2 } from "lucide-react";

/**
 * ScopeBuilder — ticker selection constructor (Iteration 3a).
 * The user picks a BASE (index / GICS sector / GICS industry / saved preset),
 * then manually EXCLUDES surplus tickers (chips). The result (base + exclude[])
 * can be saved as a preset — it appears in the Tickers field suggestions on
 * the Jobs page (preset:<name>). Grammar resolution is server-side
 * (services/scope.ts); this component is UI only.
 */
function ScopeBuilder() {
  const utils = trpc.useUtils();
  // base of the scope string: "sp500" | "ndx" | "dow" | "sector:X" | "industry:Y"
  const [base, setBase] = useState<string | null>(null);
  // excluded tickers (editable exclude list)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // name used when saving a preset; when a preset is loaded — its name (overwrite)
  const [presetName, setPresetName] = useState("");

  const groups = trpc.scope.groups.useQuery();
  const presets = trpc.scope.presets.useQuery();
  const members = trpc.scope.members.useQuery(
    { base: base ?? "" },
    { enabled: base !== null }
  );
  const savePreset = trpc.scope.savePreset.useMutation({
    onSuccess: () => utils.scope.presets.invalidate(),
  });
  const deletePreset = trpc.scope.deletePreset.useMutation({
    onSuccess: () => utils.scope.presets.invalidate(),
  });

  /** Picking a new base resets the manual exclusions. */
  const pickBase = (b: string) => {
    setBase(b);
    setExcluded(new Set());
    setPresetName("");
  };

  /** Load a preset into the builder: base + its exclude as an editable set. */
  const loadPreset = (p: { name: string; base: string; exclude: string[] }) => {
    setBase(p.base);
    setExcluded(new Set(p.exclude));
    setPresetName(p.name);
  };

  const toggle = (t: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const activeCount = (members.data?.length ?? 0) - excluded.size;

  return (
    <div className="t-panel px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-label !text-[9px] mr-1">Scope builder</span>
        {/* index groups: count=-1 means the fetch failed (network) */}
        {(groups.data?.indexes ?? []).map((g) => (
          <Button
            key={g.key}
            size="sm"
            variant={base === g.key ? "default" : "outline"}
            className="h-7 t-mono text-[10px]"
            onClick={() => pickBase(g.key)}
          >
            {g.label} {g.count >= 0 ? `(${g.count})` : "(n/a)"}
          </Button>
        ))}
        {/* GICS sectors — only for companies already in the DB */}
        <Select value={base?.startsWith("sector:") ? base.slice(7) : ""} onValueChange={(v) => pickBase(`sector:${v}`)}>
          <SelectTrigger className="h-7 w-52 t-mono text-[10px] bg-[hsl(var(--secondary)/0.5)]">
            <SelectValue placeholder="SECTOR (GICS)…" />
          </SelectTrigger>
          <SelectContent>
            {(groups.data?.sectors ?? []).map((s) => (
              <SelectItem key={s.name} value={s.name} className="t-mono text-[11px]">
                {s.name} ({s.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={base?.startsWith("industry:") ? base.slice(9) : ""} onValueChange={(v) => pickBase(`industry:${v}`)}>
          <SelectTrigger className="h-7 w-60 t-mono text-[10px] bg-[hsl(var(--secondary)/0.5)]">
            <SelectValue placeholder="INDUSTRY (GICS)…" />
          </SelectTrigger>
          <SelectContent>
            {(groups.data?.industries ?? []).map((s) => (
              <SelectItem key={s.name} value={s.name} className="t-mono text-[11px]">
                {s.name} ({s.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* GICS enrichment is automatic since iteration 3c (runs at the end of
            every bootstrap/ingest job from the static snapshot, D14/D16) —
            no manual button here. */}
      </div>

      {/* saved presets */}
      {(presets.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="t-label !text-[9px]">Presets:</span>
          {presets.data!.map((p) => (
            <span
              key={p.name}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border t-mono text-[10px] cursor-pointer transition-colors ${
                presetName === p.name
                  ? "border-[hsl(var(--live))] text-[hsl(var(--live))]"
                  : "border-border text-muted-foreground hover:border-[hsl(var(--live)/0.5)]"
              }`}
              onClick={() => loadPreset(p)}
            >
              {p.name}
              <span className="opacity-60">{p.base}{p.exclude.length > 0 ? ` −${p.exclude.length}` : ""}</span>
              <X
                size={10}
                className="hover:text-[hsl(var(--crit))]"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePreset.mutate({ name: p.name });
                }}
              />
            </span>
          ))}
        </div>
      )}

      {/* member chips of the selected group; click = exclude/include */}
      {base && (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="t-mono text-[10px] text-muted-foreground">
              {base} · ACTIVE {activeCount} / {members.data?.length ?? "…"}
              {excluded.size > 0 && ` · EXCLUDED ${excluded.size}`}
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="PRESET NAME"
                className="h-7 w-36 t-mono text-[10px] uppercase bg-[hsl(var(--secondary)/0.5)]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 t-mono text-[10px] gap-1"
                disabled={!presetName.trim() || !base || savePreset.isPending}
                onClick={() => savePreset.mutate({ name: presetName.trim(), base: base!, exclude: [...excluded] })}
              >
                <Save size={11} /> Save preset
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-1">
            {(members.data ?? []).map((m) => {
              const off = excluded.has(m.ticker);
              return (
                <button
                  key={m.ticker}
                  onClick={() => toggle(m.ticker)}
                  title={m.name ?? undefined}
                  className={`px-1.5 py-0.5 rounded border t-mono text-[10px] transition-colors ${
                    off
                      ? "border-[hsl(var(--crit)/0.4)] text-muted-foreground line-through opacity-50"
                      : m.inDb
                        ? "border-[hsl(var(--live)/0.35)] text-[hsl(var(--live))] hover:bg-[hsl(var(--live)/0.1)]"
                        : "border-dashed border-border text-muted-foreground hover:bg-[hsl(var(--accent)/0.2)]"
                  }`}
                >
                  {m.ticker}
                </button>
              );
            })}
            {members.isLoading && <span className="t-mono text-[10px] text-muted-foreground">loading…</span>}
          </div>
          {/* dashed tickers = index members not yet in the DB (not ingested) */}
          <div className="t-mono text-[9px] text-muted-foreground mt-1.5 opacity-70">
            DASHED = not ingested yet · click a chip to exclude/include · save as preset to reuse in Jobs
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AddTickerBox — typeahead over the full SEC filer directory (iteration 3c).
 * The user can search BOTH by ticker prefix and by company name substring;
 * suggestions come from `universe.directorySearch` (server-side, cached
 * SEC company_tickers.json — the list of every company known to the platform,
 * not just the ones already ingested). Enter on free text still works:
 * the exact typed ticker is queued as-is.
 */
function AddTickerBox({ onPick, disabled }: { onPick: (ticker: string) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // debounce keystrokes so we don't hammer the directory endpoint
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const dir = trpc.universe.directorySearch.useQuery(
    { q: debounced },
    { enabled: debounced.length >= 1, staleTime: 60_000, retry: false }
  );

  // close the dropdown on an outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (ticker: string) => {
    onPick(ticker);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="relative flex items-center" ref={boxRef}>
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = q.trim().toUpperCase();
            if (t) pick(dir.data?.find((r) => r.ticker === t)?.ticker ?? t);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="ADD TICKER / NAME"
        className="h-8 w-48 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
        disabled={disabled}
      />
      {open && q.trim().length >= 1 && (
        <div className="absolute right-0 top-9 z-50 w-[min(320px,86vw)] max-h-64 overflow-y-auto rounded-md border border-border bg-[hsl(var(--card))] shadow-xl">
          {dir.isLoading && (
            <div className="px-3 py-2 t-mono text-[10px] text-muted-foreground">SEARCHING SEC DIRECTORY…</div>
          )}
          {(dir.data ?? []).map((r) => (
            <button
              key={r.ticker}
              type="button"
              onClick={() => pick(r.ticker)}
              className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left hover:bg-[hsl(var(--accent)/0.25)] transition-colors"
            >
              <span className="t-mono text-[11px] font-semibold text-[hsl(var(--live))]">{r.ticker}</span>
              <span className="text-[11px] text-muted-foreground truncate">{r.name}</span>
            </button>
          ))}
          {dir.data && dir.data.length === 0 && !dir.isLoading && (
            <div className="px-3 py-2 t-mono text-[10px] text-muted-foreground">
              NO MATCH IN SEC DIRECTORY — PRESS ENTER TO TRY THE TYPED TICKER AS-IS
            </div>
          )}
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        className="t-mono text-[10px] gap-1.5 h-8 ml-2"
        onClick={() => {
          const t = q.trim().toUpperCase();
          if (t) pick(dir.data?.find((r) => r.ticker === t)?.ticker ?? t);
        }}
        disabled={disabled || !q.trim()}
      >
        <Plus size={12} /> Ingest
      </Button>
    </div>
  );
}

export default function Universe() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // raw input vs the queried value: debounced (4b) so typing does not fire a
  // LIKE-query per keystroke (the AddTickerBox already debounces its own)
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [onlyUniverse, setOnlyUniverse] = useState(true);
  const [page, setPage] = useState(0);
  const utils = trpc.useUtils();

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const list = trpc.universe.list.useQuery(
    { search, onlyUniverse, page, pageSize: 50 },
    { placeholderData: (prev) => prev }
  );
  const sp500 = trpc.universe.sp500Preview.useQuery(undefined, { enabled: isAdmin });
  /**
   * The hide switch (4c, D30): toggles MY membership's active flag only.
   * Unlogged (too noisy) — add/remove carry the audit trail instead.
   */
  const setActiveCo = trpc.universe.setActive.useMutation({
    // 4h review fix: in "Active universe only" mode a hidden row vanishes on
    // refetch — without feedback it reads as a glitch; toast it honestly
    onSuccess: (_r, vars) => {
      utils.universe.list.invalidate();
      if (vars.active === false) {
        jobToast("info", "Hidden from your active view", "the row stays under 'Active universe only' = off · not logged (add/remove carry the audit)");
      }
    },
  });
  /**
   * Add to MY universe (4c, D30/D31): a fresh ACTIVE membership — re-adding a
   * removed company behaves exactly like adding a new one. When the company
   * is new to the platform, the server queues a light single-ticker ingest
   * (startedBy = me) and says so in the toast.
   */
  const addCo = trpc.universe.add.useMutation({
    onSuccess: (r) => {
      utils.universe.list.invalidate();
      utils.jobs.list.invalidate();
      jobToast(
        "success",
        `${r.ticker} added to your universe`,
        r.ingesting
          ? `new to the platform — ingest job #${r.ingestJobId} queued · logged as #${r.jobId}`
          : `active now · logged as job #${r.jobId}`,
      );
    },
    onError: (err) => jobToast("error", "Add failed", err.message),
  });
  /**
   * The trash can (4c, D30): deletes MY membership row. Shared company data
   * is never touched; the action is logged as a micro-job; re-add via the
   * Add box creates a fresh active membership.
   */
  const removeCo = trpc.universe.remove.useMutation({
    onSuccess: (r) => {
      utils.universe.list.invalidate();
      jobToast(
        "success",
        `${r.ticker} removed from your universe`,
        r.already ? "was not in your universe" : `shared data untouched · logged as job #${r.jobId} · re-add via search`,
      );
    },
    onError: (err) => jobToast("error", "Remove failed", err.message),
  });
  const startBootstrap = trpc.jobs.startBootstrap.useMutation({
    onSuccess: (_job, vars) => {
      utils.jobs.list.invalidate();
      utils.universe.list.invalidate();
      // Acceptance feedback: the 8s ring toast fades on its own; the global
      // job watcher (AppLayout) reports completion / failure when it happens.
      jobToast(
        "success",
        "Ingest job accepted",
        `scope ${vars.tickers} · forms ${vars.forms}${vars.withFacts ? " · with facts" : ""}`,
      );
    },
    onError: (err) => {
      jobToast("error", "Ingest job rejected", err.message);
    },
  });

  /**
   * Manual GICS re-enrichment (admin only, iteration 3d): automatic
   * enrichment runs at the end of every bootstrap, this button is the ops
   * trigger for edge cases. The toast names who matched and who was skipped.
   */
  const enrichGics = trpc.scope.enrichClassification.useMutation({
    onSuccess: (r) => {
      utils.universe.list.invalidate();
      utils.scope.groups.invalidate();
      jobToast(
        r.unmatched.length ? "warning" : "success",
        "GICS enrichment finished",
        `${r.updated} updated · ${r.inDb} matched${r.unmatched.length ? ` · skipped: ${r.unmatched.map((u) => u.ticker).join(", ")} (not in S&P 500)` : ""}`,
      );
    },
    onError: (err) => jobToast("error", "GICS enrichment failed", err.message),
  });

  const totalPages = Math.ceil((list.data?.total ?? 0) / 50);

  /** Add a ticker to MY universe (picked from the autocomplete). */
  const addTicker = (ticker: string) => {
    const t = ticker.trim().toUpperCase();
    if (!t || addCo.isPending) return;
    addCo.mutate({ ticker: t });
  };

  return (
    <AppLayout title="Universe Control">
      {/* 4c (D31): the scope builder produces presets for JOB scopes — jobs
          are admin-only now, so the builder is an admin surface too */}
      {isAdmin && <ScopeBuilder />}

      {/* toolbar */}
      <div className="t-panel px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SEARCH TICKER / NAME"
            className="pl-8 h-8 w-64 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={onlyUniverse} onCheckedChange={(v) => { setOnlyUniverse(v); setPage(0); }} />
          <span className="t-label !text-[9px]">Active universe only</span>
        </label>
        {/* 4g: this group must WRAP on phones — its intrinsic width (~508px)
            otherwise overflows a 390px page */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <AddTickerBox onPick={addTicker} disabled={addCo.isPending} />
          {/* Manual GICS re-enrichment + index bootstrap — owner ops triggers
              (4c, D31): they write the SHARED registry, so admin-only. */}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              title="Re-run GICS enrichment now"
              className="t-mono text-[10px] gap-1.5 h-8"
              onClick={() => enrichGics.mutate()}
              disabled={enrichGics.isPending}
            >
              <RefreshCw size={12} className={enrichGics.isPending ? "animate-spin" : undefined} />
              GICS
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              className="t-mono text-[10px] gap-1.5 h-8 bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
              onClick={() => startBootstrap.mutate({ tickers: "sp500", exclude: "", forms: "10-K,10-Q,8-K", withFacts: true })}
              disabled={startBootstrap.isPending}
            >
              <DownloadCloud size={12} />
              Bootstrap S&P 500{sp500.data ? ` (${sp500.data.count})` : ""}
            </Button>
          )}
        </div>
      </div>

      {/* table — 4g: horizontal scroll on small screens instead of crushing */}
      <div className="t-panel mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-border">
              {["Ticker", "Company", "Exchange", "Sector (GICS)", "Industry (GICS)", "FY End", "Active"].map((h) => (
                <th key={h} className="t-label text-left px-4 py-2.5 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(list.data?.rows ?? []).map((c) => (
              // 4c (D30): rows are MY memberships; inactive ones are dimmed,
              // a company whose auto-ingest is still queued shows INGESTING
              <tr key={c.cik} className={`hover:bg-[hsl(var(--accent)/0.15)] transition-colors ${c.active ? "" : "opacity-60"}`}>
                {/* ticker links to the company page /company/:ticker — only
                    once the company exists in the shared registry */}
                <td className="px-4 py-2 t-mono text-[12px] font-semibold">
                  {c.inDb ? (
                    <Link
                      to={`/company/${c.ticker}`}
                      className="text-[hsl(var(--live))] hover:underline underline-offset-2"
                    >
                      {c.ticker}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">{c.ticker}</span>
                      <span
                        className="t-mono text-[9px] px-1.5 py-0.5 border rounded-sm text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.4)]"
                        title="New to the platform — the auto-ingest job is queued/running; data appears when it finishes"
                      >
                        INGESTING
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-[12px]">
                  {c.inDb ? (
                    <Link to={`/company/${c.ticker}`} className="hover:text-[hsl(var(--live))] transition-colors">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{c.name ?? "—"}</span>
                  )}
                </td>
                <td className="px-4 py-2 t-mono text-[11px] text-muted-foreground">{c.exchange ?? "—"}</td>
                {/* GICS classification (static S&P 500 snapshot, D14). Companies
                    outside the index have NULL — the cell falls back to the SEC
                    SIC description, visually de-emphasized (italic, dimmer) so
                    the two taxonomies are never confused (D8). */}
                <td className="px-4 py-2 text-[11px] text-muted-foreground">{c.sector ?? "—"}</td>
                <td className="px-4 py-2 text-[11px] text-muted-foreground">
                  {c.industry ?? (c.sicDescription ? <span className="italic opacity-60">{c.sicDescription} (SIC)</span> : "—")}
                </td>
                <td className="px-4 py-2 t-mono text-[11px] text-muted-foreground">{fmtFyEnd(c.fiscalYearEnd)}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    {/* the switch hides/shows the company in MY universe only
                        (4c, D30) — nobody else's universe or data changes */}
                    <span title="Your view only — shared data and other users are unaffected">
                      <Switch
                        checked={c.active}
                        onCheckedChange={(v) => setActiveCo.mutate({ cik: c.cik, active: v })}
                      />
                    </span>
                    {/* the trash can deletes MY membership row (4c, D30) —
                        shared company data stays; re-add via the Add box */}
                    <button
                      title="Remove from YOUR universe — shared data stays in the DB, the action is logged; re-add via the Add box"
                      onClick={() => removeCo.mutate({ cik: c.cik })}
                      disabled={removeCo.isPending}
                      className="text-muted-foreground hover:text-[hsl(var(--crit))] transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {list.data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center t-mono text-[11px] text-muted-foreground">
                  YOUR UNIVERSE IS EMPTY — ADD TICKERS VIA THE SEARCH BOX ABOVE
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* Taxonomy legend: GICS comes from the static S&P 500 snapshot and is
            re-applied automatically at the end of every ingest job; companies
            outside the index show their SEC SIC description instead. */}
        <div className="px-4 py-2 border-t border-border t-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          YOUR PERSONAL UNIVERSE (4c) — the switch hides/shows a company in your view only · 🗑 removes it from your list (logged; shared data stays; re-add via the Add box) · INGESTING = new to the platform, the auto-ingest job is running · GICS — S&P 500 snapshot, non-index companies show SEC SIC (italic)
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
          <span className="t-mono text-[10px] text-muted-foreground">
            {list.data?.total ?? 0} COMPANIES · PAGE {page + 1}/{Math.max(totalPages, 1)}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={13} />
            </Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
