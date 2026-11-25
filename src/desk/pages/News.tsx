/**
 * News: every story from the press wires, the SEC's current reports, the market feeds and the per-company feeds, once
 * however many outlets carried it, newest first. Filters sit in one row above the list; the side column counts what
 * the filtered list holds. The local model's readings and their filters are for the owner and NDA reviewers.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { NEWS_EVENT_LABELS } from "@contracts/desk-news";
import { Card, CompanyLink, Notice, Segmented, Shimmer } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { useDeskSnapshot, useWatchlist } from "../data";
import { DevNotes } from "../DevNotes";
import { entityName, fmtClock } from "../format";
import { StoryList } from "../news/StoryList";

type Hours = "24" | "48" | "72";
type Scope = "all" | "registry" | "watchlist";
const HOURS: { value: Hours; label: string }[] = [{ value: "24", label: "24 hours" }, { value: "48", label: "48 hours" }, { value: "72", label: "3 days" }];
const SCOPES: { value: Scope; label: string }[] = [{ value: "registry", label: "Our companies" }, { value: "watchlist", label: "Watchlist" }, { value: "all", label: "All news" }];
const DIRECTIONS = [{ value: "", label: "Any direction" }, { value: "positive", label: "Positive" }, { value: "negative", label: "Negative" }, { value: "mixed", label: "Mixed" }, { value: "neutral", label: "Neutral" }];
const PAGE = 60;

export default function News() {
  useDocumentTitle("News");
  const { isPresentation } = useDesk();
  const snapshot = useDeskSnapshot();
  const watch = useWatchlist();
  const [hours, setHours] = useState<Hours>("24");
  const [scope, setScope] = useState<Scope>("registry");
  const [event, setEvent] = useState("");
  const [direction, setDirection] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [publisher, setPublisher] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const watchCiks = useMemo(() => [...watch.ciks], [watch.ciks]);
  const input = {
    hours: Number(hours), scope, limit,
    ...(scope === "watchlist" ? { ciks: watchCiks } : {}),
    ...(isPresentation && event ? { event } : {}),
    ...(isPresentation && direction ? { direction: direction as "positive" } : {}),
    ...(isPresentation && newOnly ? { newOnly: true } : {}),
    ...(publisher ? { publisher } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const query = trpc.desk.news.useQuery(input, { staleTime: 60_000, refetchInterval: 5 * 60_000, refetchIntervalInBackground: false, placeholderData: (previous) => previous, enabled: scope !== "watchlist" || !watch.isLoading });
  const known = useMemo(() => new Map((snapshot.data?.companies ?? []).map((company) => [company.cik, { ticker: company.ticker, cik: company.cik, name: company.name }])), [snapshot.data]);
  const data = query.data;
  const reset = () => setLimit(PAGE);

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research input</span>
          <h1>News</h1>
          <p className="desk-lede">
            The press wires, the SEC's current reports, market news and every company's own feeds, each story once however many outlets carried it.
            {isPresentation ? " The local model reads every story: what kind of news, which way it points, and whether it is new." : ""}
          </p>
        </div>
      </div>

      <div className="desk-controls">
        <Segmented label="Time window" options={HOURS} value={hours} onChange={(value) => { setHours(value); reset(); }} />
        <Segmented label="Which news" options={SCOPES} value={scope} onChange={(value) => { setScope(value); reset(); }} />
        <input className="desk-input" type="search" placeholder="Words, ticker or company" value={search} onChange={(change) => { setSearch(change.target.value); reset(); }} aria-label="Search the news" style={{ width: 220 }} />
        {isPresentation && (
          <>
            <select className="desk-select" value={event} onChange={(change) => { setEvent(change.target.value); reset(); }} aria-label="Kind of news">
              <option value="">Every kind of news</option>
              {Object.entries(NEWS_EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="desk-select" value={direction} onChange={(change) => { setDirection(change.target.value); reset(); }} aria-label="Direction">
              {DIRECTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="desk-check"><input type="checkbox" checked={newOnly} onChange={(change) => { setNewOnly(change.target.checked); reset(); }} />New events only</label>
          </>
        )}
        {publisher && <button type="button" className="desk-badge accent" style={{ cursor: "pointer" }} onClick={() => { setPublisher(""); reset(); }} aria-label={`Remove the outlet filter ${publisher}`}>{publisher} ×</button>}
      </div>

      {query.isLoading ? (
        <Shimmer height={480} />
      ) : query.error ? (
        <Notice title="The news could not be loaded">{query.error.message}</Notice>
      ) : !data?.builtAt ? (
        <Notice title="No news is built yet">The news files are rebuilt after every reading run; none is on hand.</Notice>
      ) : (
        <div className="desk-grid">
          <Card
            className="desk-span-8"
            title={`${data.matching.toLocaleString("en-US")} ${data.matching === 1 ? "story" : "stories"}`}
            subtitle={`${data.copies.toLocaleString("en-US")} more copies from other outlets joined to them · ${data.total.toLocaleString("en-US")} stories in the window${isPresentation ? ` · ${data.read.toLocaleString("en-US")} read by the model` : ""} · rebuilt ${fmtClock(data.builtAt)}`}
          >
            {scope === "watchlist" && !watchCiks.length ? (
              <div className="desk-empty">You follow no company yet: follow companies on the Watchlist page or on a company page.</div>
            ) : (
              <StoryList stories={data.stories} known={known} empty="No story matches these filters in the window." />
            )}
            {data.matching > data.stories.length && limit < 200 && (
              <button type="button" className="desk-button" style={{ marginTop: 12 }} onClick={() => setLimit((value) => Math.min(200, value + PAGE))}>Show more</button>
            )}
          </Card>

          <div className="desk-span-4" style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <Card title="Most in the news" subtitle={isPresentation ? "Covered companies by stories · stories about them the model read as positive (+) or negative (−)" : "Covered companies by stories"}>
              {data.companies.length ? (
                <ol className="desk-news-rank">
                  {data.companies.map((company) => {
                    const desk = known.get(company.cik);
                    return (
                      <li key={company.cik}>
                        {desk ? <CompanyLink company={desk} className="desk-ticker">{desk.ticker}</CompanyLink> : <span className="desk-ticker">{company.ticker}</span>}
                        <span className="desk-ink-2 desk-news-rank-name">{desk?.name ?? entityName(company.name)}</span>
                        <span className="desk-num">{company.stories}</span>
                        {isPresentation && (
                          <span className="desk-num desk-news-rank-split">
                            {company.positive > 0 && <span className="desk-up" title="Stories about it the model read as positive">+{company.positive}</span>}
                            {company.positive > 0 && company.negative > 0 && " "}
                            {company.negative > 0 && <span className="desk-down" title="Stories about it the model read as negative">−{company.negative}</span>}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : <div className="desk-empty">No covered company in these stories.</div>}
            </Card>
            {isPresentation && data.events.length > 0 && (
              <Card title="What kind of news" subtitle="Stories the model read, by kind">
                <ul className="desk-news-bars">
                  {data.events.map((row) => (
                    <li key={row.event}>
                      <button type="button" onClick={() => { setEvent(event === row.event ? "" : row.event); reset(); }} aria-pressed={event === row.event}>
                        <span>{NEWS_EVENT_LABELS[row.event] ?? row.event}</span>
                        <span className="desk-num">{row.stories}</span>
                        <span className="desk-news-bar" style={{ width: `${(100 * row.stories) / data.events[0].stories}%` }} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Outlets" subtitle="Who published the first copy · pick one to filter">
              <ul className="desk-news-bars">
                {data.publishers.slice(0, 12).map((row) => (
                  <li key={row.publisher}>
                    <button type="button" onClick={() => { setPublisher(publisher === row.publisher ? "" : row.publisher); reset(); }} aria-pressed={publisher === row.publisher}>
                      <span>{row.publisher}</span>
                      <span className="desk-num">{row.stories}</span>
                      <span className="desk-news-bar" style={{ width: `${(100 * row.stories) / data.publishers[0].stories}%` }} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
      <DevNotes page="news" />
    </div>
  );
}
