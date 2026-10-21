/**
 * /wiki — the factor encyclopedia (4j): one long entry per factor — the
 * logic, the formula we run, how we got here (data lineage), the academic
 * anchor with a link, and further reading (Wikipedia). Entries come from the
 * shared registry api/services/factor-meta.ts — the popover hints on the
 * Value tab and this page can never drift apart.
 */
import { useEffect } from "react";
import { useLocation } from "react-router";
import AppLayout from "@/components/AppLayout";
import { FACTOR_META } from "../../api/services/factor-meta";
import { BookOpen, ExternalLink } from "lucide-react";

export default function Wiki() {
  const { hash } = useLocation();
  // anchor jump: /wiki#accruals scrolls to the entry
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <AppLayout title="Factor Wiki">
      <div className="max-w-[860px] space-y-4">
        <div className="t-panel px-5 py-4">
          <div className="t-label flex items-center gap-2"><BookOpen size={12} className="text-[hsl(var(--live))]" /> FACTOR WIKI</div>
          <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
            Every number on the Value tab is computed in-house from our own tables. Each entry below documents the
            logic, the exact formula we run, the academic anchor, and how to read the signal. Signals read the
            literature's direction — they are inputs, never orders.
          </p>
        </div>
        {FACTOR_META.map((f) => (
          <div key={f.key} id={f.key} className="t-panel px-5 py-4 scroll-mt-20">
            <div className="t-mono text-[14px] font-semibold text-[hsl(var(--live))]">{f.name}</div>
            <p className="text-[12px] text-muted-foreground leading-relaxed mt-2">{f.wiki}</p>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <div className="t-panel-inset px-3 py-2">
                <div className="t-label !text-[9px]">Formula we run</div>
                <div className="t-mono text-[10px] mt-1">{f.formula}</div>
              </div>
              <div className="t-panel-inset px-3 py-2">
                <div className="t-label !text-[9px]">How we compute it</div>
                <div className="t-mono text-[10px] mt-1">{f.howWeCompute}</div>
              </div>
            </div>
            <div className="t-panel-inset px-3 py-2 mt-3">
              <div className="t-label !text-[9px]">Reference read</div>
              <div className="t-mono text-[10px] mt-1">{f.reference}</div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-[hsl(var(--border)/0.5)] space-y-1">
              <a href={f.anchor.link} target="_blank" rel="noreferrer" className="t-mono text-[10px] text-[hsl(var(--live))] hover:underline flex items-start gap-1.5">
                <ExternalLink size={10} className="mt-0.5 shrink-0" /> {f.anchor.citation}
              </a>
              <a href={f.wikiLink} target="_blank" rel="noreferrer" className="t-mono text-[10px] text-muted-foreground hover:text-foreground flex items-start gap-1.5">
                <ExternalLink size={10} className="mt-0.5 shrink-0" /> Further reading (Wikipedia)
              </a>
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}
