import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DeskNewsStory } from "@contracts/desk-news";
import { Card, Segmented, Shimmer } from "../../components";
import { useDeskSnapshot } from "../../data";
import { fmtDate } from "../../format";
import { BriefView } from "../../news/Brief";
import { StoryList } from "../../news/StoryList";

type View = "about" | "all";
const VIEWS: { value: View; label: string }[] = [{ value: "about", label: "About it" }, { value: "all", label: "Every mention" }];
const SHOWN = 15;

/** About the company: the model's subject, its own SEC filing, or the wire's ticker tag. Its company feed alone is not
 * enough, because those feeds also return news about other companies. */
const isAbout = (story: DeskNewsStory, cik: number) => story.companies.some((company) => company.cik === cik && company.ties.some((tie) => tie === "subject" || tie === "filer" || tie === "tagged"));

export function CompanyNews({ cik }: { cik: number }) {
  const [chosen, setView] = useState<View | null>(null);
  const [all, setAll] = useState(false);
  const query = trpc.desk.companyNews.useQuery({ cik }, { enabled: cik > 0, staleTime: 5 * 60_000 });
  const brief = trpc.desk.companyBrief.useQuery({ cik }, { enabled: cik > 0, staleTime: 2 * 60_000 });
  const snapshot = useDeskSnapshot();
  const known = useMemo(() => new Map((snapshot.data?.companies ?? []).map((company) => [company.cik, { ticker: company.ticker, cik: company.cik }])), [snapshot.data]);
  const data = query.data;
  // until the reader chooses: the stories about the company when there are any, else every mention
  const view: View = chosen ?? ((data?.stories ?? []).some((story) => isAbout(story, cik)) ? "about" : "all");
  const matching = (data?.stories ?? []).filter((story) => view === "all" || isAbout(story, cik));
  const rows = all ? matching : matching.slice(0, SHOWN);
  const since = data?.days[0];
  return (
    <Card
      className="desk-span-12"
      title="News"
      subtitle={data
        ? `${(data.stories.length).toLocaleString("en-US")} stories since ${fmtDate(since, "medium")} from the wires, the SEC, market news and its company feeds · each story once, however many outlets carried it`
        : "Stories from the wires, the SEC, market news and its company feeds"}
      action={data ? <Segmented label="Which stories" options={VIEWS} value={view} onChange={(next) => { setView(next); setAll(false); }} /> : undefined}
    >
      {query.isLoading ? (
        <Shimmer height={180} />
      ) : query.error ? (
        <div className="desk-empty">The news could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-empty">No news is built for this company yet.</div>
      ) : (
        <>
          {brief.data && <BriefView brief={brief.data} />}
          <StoryList stories={rows} known={known} focus={cik} empty={view === "about" ? "No story about this company in the covered days; “Every mention” also lists stories that only name it." : "No story names this company in the covered days."} />
          {matching.length > SHOWN && (
            <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, marginTop: 8, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAll((open) => !open)}>
              {all ? `Show the latest ${SHOWN}` : `Show all ${matching.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
