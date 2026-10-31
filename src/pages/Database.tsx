import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, LineChart as LineChartIcon, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Filings browser
// ---------------------------------------------------------------------------
function FilingsBrowser() {
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<{ cik: number; accessionNo: string; primaryDoc: string | null; label: string } | null>(null);

  const list = trpc.browse.filingsList.useQuery(
    { search, form: form === "all" ? undefined : form, page, pageSize: 40 },
    { placeholderData: (p) => p }
  );
  const doc = trpc.browse.filingDocument.useQuery(
    viewing ? { cik: viewing.cik, accessionNo: viewing.accessionNo, primaryDoc: viewing.primaryDoc } : (undefined as never),
    { enabled: !!viewing }
  );

  const totalPages = Math.ceil((list.data?.total ?? 0) / 40);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="TICKER FILTER"
            className="pl-8 h-8 w-48 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
          />
        </div>
        <Select value={form} onValueChange={(v) => { setForm(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-32 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all forms</SelectItem>
            <SelectItem value="10-K">10-K</SelectItem>
            <SelectItem value="10-Q">10-Q</SelectItem>
            <SelectItem value="8-K">8-K</SelectItem>
          </SelectContent>
        </Select>
        <span className="t-mono text-[10px] text-muted-foreground ml-auto">{list.data?.total ?? 0} filings</span>
      </div>

      <div className="t-panel overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-border">
              {["Ticker", "Form", "Filing date", "Report date", "Accession", ""].map((h) => (
                <th key={h} className="t-label text-left px-4 py-2.5 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(list.data?.rows ?? []).map((f) => (
              <tr key={f.id} className="hover:bg-[hsl(var(--accent)/0.15)]">
                <td className="px-4 py-2 t-mono text-[12px] font-semibold text-[hsl(var(--live))]">{f.ticker}</td>
                <td className="px-4 py-2 t-mono text-[11px]">{f.form}</td>
                <td className="px-4 py-2 t-mono text-[11px] text-muted-foreground">{f.filingDate}</td>
                <td className="px-4 py-2 t-mono text-[11px] text-muted-foreground">{f.reportDate ?? "—"}</td>
                <td className="px-4 py-2 t-mono text-[10px] text-muted-foreground">{f.accessionNo}</td>
                <td className="px-4 py-2">
                  <Button
                    size="sm" variant="ghost" className="h-6 w-6 p-0"
                    onClick={() => setViewing({ cik: f.cik, accessionNo: f.accessionNo, primaryDoc: f.primaryDoc, label: `${f.ticker} ${f.form} ${f.filingDate}` })}
                  >
                    <Eye size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
          <span className="t-mono text-[10px] text-muted-foreground">PAGE {page + 1}/{Math.max(totalPages, 1)}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={13} /></Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={13} /></Button>
          </div>
        </div>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-4xl t-panel !bg-[hsl(var(--card))]">
          <DialogHeader>
            <DialogTitle className="t-mono text-[12px] uppercase tracking-[0.14em]">{viewing?.label}</DialogTitle>
          </DialogHeader>
          <div className="console rounded-md max-h-[60vh] overflow-y-auto p-3">
            {doc.isLoading && <div className="lv-ts">fetching document from SEC EDGAR…</div>}
            {doc.error && <div className="lv-error">{String(doc.error)}</div>}
            {doc.data && (
              <>
                <div className="lv-ts mb-2">{doc.data.docName} · {doc.data.length.toLocaleString()} chars (excerpt)</div>
                <div className="lv-info whitespace-pre-wrap">{doc.data.excerpt}</div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fundamentals explorer
// ---------------------------------------------------------------------------
function Fundamentals() {
  const [tickerInput, setTickerInput] = useState("");
  const [cik, setCik] = useState<number | null>(null);
  const [tickerLabel, setTickerLabel] = useState("");
  const [concept, setConcept] = useState<string>("");
  const [formFilter, setFormFilter] = useState<string>("10-K");

  const lookup = trpc.universe.lookupTicker.useQuery(
    { ticker: tickerInput },
    { enabled: false }
  );
  const concepts = trpc.browse.concepts.useQuery({ cik: cik! }, { enabled: cik !== null });
  const series = trpc.browse.conceptSeries.useQuery(
    { cik: cik!, concept, form: formFilter === "all" ? undefined : formFilter },
    { enabled: cik !== null && !!concept }
  );

  const chartData = useMemo(() => {
    const rows = (series.data ?? []).filter((r) => r.endDate && r.val !== null);
    // de-duplicate same endDate keeping last filed
    const byDate = new Map<string, { endDate: string; val: number }>();
    for (const r of rows) byDate.set(r.endDate!, { endDate: r.endDate!, val: r.val! });
    return [...byDate.values()].sort((a, b) => a.endDate.localeCompare(b.endDate));
  }, [series.data]);

  const doLookup = async () => {
    const res = await lookup.refetch();
    if (res.data) {
      setCik(res.data.cik);
      setTickerLabel(res.data.ticker);
      setConcept("");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && doLookup()}
          placeholder="TICKER (e.g. AAPL)"
          className="h-8 w-40 t-mono text-[11px] uppercase bg-[hsl(var(--secondary)/0.5)]"
        />
        <Button size="sm" variant="outline" className="h-8 t-mono text-[10px] gap-1.5" onClick={doLookup}>
          <LineChartIcon size={12} /> Load
        </Button>
        {cik !== null && (
          <>
            <Select value={concept} onValueChange={setConcept}>
              <SelectTrigger className="h-8 w-80 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]">
                <SelectValue placeholder={`select concept (${concepts.data?.length ?? 0} available)`} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {(concepts.data ?? [])
                  .filter((c) => c.taxonomy === "us-gaap")
                  .map((c) => (
                    <SelectItem key={c.concept} value={c.concept} className="t-mono text-[11px]">{c.concept}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={formFilter} onValueChange={setFormFilter}>
              <SelectTrigger className="h-8 w-28 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10-K">10-K</SelectItem>
                <SelectItem value="10-Q">10-Q</SelectItem>
                <SelectItem value="all">all</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {cik !== null && concept && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="t-panel lg:col-span-2 p-4">
            <div className="t-label mb-3">{tickerLabel} · {concept} · {formFilter}</div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="hsl(223 42% 14%)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="endDate"
                  tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  tickFormatter={(d: string) => d.slice(0, 7)}
                />
                <YAxis
                  tick={{ fill: "hsl(217 20% 62%)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  tickFormatter={(v: number) => compact(v)}
                  width={70}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(219 43% 12%)", border: "1px solid hsl(223 42% 18%)", borderRadius: 6, fontFamily: "JetBrains Mono", fontSize: 11 }}
                  formatter={(v: number) => [compact(v), concept]}
                />
                <Line type="monotone" dataKey="val" stroke="hsl(187 86% 53%)" strokeWidth={1.75} dot={false} activeDot={{ r: 3, fill: "hsl(187 86% 53%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="t-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-border t-label">Data points</div>
            <div className="max-h-[340px] overflow-y-auto divide-y divide-[hsl(var(--border)/0.6)]">
              {[...chartData].reverse().map((r) => (
                <div key={r.endDate} className="flex justify-between px-4 py-1.5">
                  <span className="t-mono text-[11px] text-muted-foreground">{r.endDate}</span>
                  <span className="t-mono text-[11px] text-foreground">{compact(r.val)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {cik === null && (
        <div className="t-panel-inset border-dashed px-4 py-16 text-center t-mono text-[11px] text-muted-foreground">
          LOAD A TICKER TO EXPLORE ITS XBRL FUNDAMENTALS — REVENUE, INVENTORY, RECEIVABLES, DEBT…
        </div>
      )}
    </>
  );
}

export default function DatabasePage() {
  return (
    <AppLayout title="Database Browser">
      <Tabs defaultValue="filings">
        <TabsList className="t-panel !bg-[hsl(var(--secondary)/0.4)] h-9 mb-4">
          <TabsTrigger value="filings" className="t-mono text-[10px] uppercase tracking-[0.12em]">Filings</TabsTrigger>
          <TabsTrigger value="fundamentals" className="t-mono text-[10px] uppercase tracking-[0.12em]">Fundamentals</TabsTrigger>
        </TabsList>
        <TabsContent value="filings"><FilingsBrowser /></TabsContent>
        <TabsContent value="fundamentals"><Fundamentals /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
