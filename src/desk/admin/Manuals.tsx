import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, Notice, Shimmer } from "../components";
import { Markdown } from "../Markdown";

type ManualId = "engine-manual-en" | "engine-manual-ru" | "llm-context" | "design-value-signals";

export default function Manuals() {
  const manuals = trpc.admin.manuals.useQuery(undefined, { retry: false });
  const [manualId, setManualId] = useState<ManualId | null>(null);
  useEffect(() => {
    if (!manualId && manuals.data?.length) setManualId(manuals.data[0].id);
  }, [manuals.data, manualId]);
  const content = trpc.admin.manualContent.useQuery({ id: manualId ?? "engine-manual-en" }, { enabled: manualId !== null, retry: false });
  return (
    <Card title="Project manuals" subtitle="Structured documents with headings, tables, code and source lineage.">
      {manuals.isLoading && <Shimmer height={300} />}
      {manuals.error && <Notice title="The manual registry could not be loaded">{manuals.error.message}</Notice>}
      {manuals.data?.length === 0 && <div className="desk-empty">No manuals available.</div>}
      {(manuals.data?.length ?? 0) > 0 && (
        <>
          <div className="desk-manual-tabs" role="group" aria-label="Manual">
            {manuals.data!.map((manual) => <button key={manual.id} type="button" className="desk-button" aria-pressed={manual.id === manualId} onClick={() => setManualId(manual.id)}>{manual.title}</button>)}
          </div>
          {content.isLoading && <Shimmer height={360} />}
          {content.error && <Notice title="The manual could not be loaded">{content.error.message}</Notice>}
          {content.data && (
            <>
              <div className="desk-manual-meta">{content.data.title} · {content.data.source} · updated {String(content.data.updatedAt).slice(0, 10)}</div>
              <Markdown content={content.data.content} />
            </>
          )}
        </>
      )}
    </Card>
  );
}
