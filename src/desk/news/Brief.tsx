/**
 * A followed company's news brief: the morning brief of the news since the previous close and the updates since, as
 * the local model wrote them from the picked stories. Every number and name was checked by code against the cited
 * stories; a part that failed shows its headline instead, marked. Shown only to the owner and NDA reviewers (the
 * server sends nothing to others).
 */
import { useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { BriefCheck, BriefSource, NewsBrief } from "@contracts/news-briefs";
import { fmtClock, fmtDate, fmtDateTime } from "../format";

const SKIP_WORDS: Record<string, string> = { old: "published before the window", "not about it": "about other companies", noise: "noise", commentary: "commentary", holdings: "holdings and insider trades", "follow-up": "follow-ups", unread: "not read yet" };

function Sources({ sources }: { sources: BriefSource[] }) {
  const [first, ...rest] = sources;
  if (!first) return null;
  return (
    <span className="desk-brief-sources">
      <a className="desk-link" href={first.url} target="_blank" rel="noreferrer" title={`${first.title} · ${fmtDateTime(first.at)}`}>{first.publisher}<ExternalLink size={10} aria-hidden="true" /></a>
      {rest.slice(0, 3).map((source) => (
        <a key={source.id} className="desk-link" href={source.url} target="_blank" rel="noreferrer" title={`${source.title} · ${fmtDateTime(source.at)}`}>{source.publisher}</a>
      ))}
      {rest.length > 3 && <span className="desk-muted">+{rest.length - 3}</span>}
    </span>
  );
}

/** A part whose text failed the check: its headline stands, marked, with what failed on hover. */
function Unchecked({ check }: { check: BriefCheck }) {
  if (check.checked) return null;
  return (
    <span className="desk-brief-unchecked" title={(check.problems ?? []).join("; ")}>
      <AlertTriangle size={12} aria-hidden="true" />headline only: the summary did not pass the check
    </span>
  );
}

function skipLine(skipped: Record<string, number>): string {
  const parts = Object.entries(skipped).filter(([, count]) => count > 0).map(([reason, count]) => `${count} ${SKIP_WORDS[reason] ?? reason}`);
  return parts.length ? ` Left out: ${parts.join(", ")}.` : "";
}

export function BriefView({ brief }: { brief: NewsBrief }) {
  const [others, setOthers] = useState(false);
  const quiet = !brief.points.length && !brief.updates.length;
  return (
    <section className="desk-brief" aria-label="News brief">
      <div className="desk-brief-head">
        <span className="desk-brief-label">Brief · {fmtDate(brief.edition, "medium")}</span>
        <span className="desk-muted">news since {fmtDateTime(brief.from)}{brief.updates.length ? ` · updated ${fmtClock(brief.updates.at(-1)!.at)}` : ` · written ${fmtClock(brief.generatedAt)}`}</span>
        {brief.price && <span className="desk-brief-price">{brief.price}</span>}
      </div>
      <p className={`desk-brief-top${quiet ? " quiet" : ""}`}>{brief.topLine.text} <Unchecked check={brief.topLine} /></p>
      {brief.points.length > 0 && (
        <ol className="desk-brief-points">
          {brief.points.map((point) => (
            <li key={point.thread}>
              {point.checked ? <strong>{point.title}.</strong> : <a className="desk-brief-headline" href={point.sources[0]?.url} target="_blank" rel="noreferrer">{point.title}<ExternalLink size={11} aria-hidden="true" /></a>}
              {point.text && <> {point.text}</>}
              <span className="desk-brief-meta">
                <Sources sources={point.sources} />
                {point.continues && <span className="desk-muted">continues a story since {fmtDate(point.since.slice(0, 10), "short")}</span>}
                <Unchecked check={point} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {brief.updates.length > 0 && (
        <div className="desk-brief-updates">
          <h4>Since the morning brief</h4>
          <ol>
            {brief.updates.map((update, index) => {
              // the time of the news itself; when we added it much later (the reader was behind), that shows too
              const newsAt = update.sources.map((source) => source.at).sort().at(-1) ?? update.at;
              const late = Date.parse(update.at) - Date.parse(newsAt) > 3_600_000;
              return (
                <li key={`${update.thread}-${index}`}>
                  <time dateTime={newsAt} title={`Added to the brief ${fmtDateTime(update.at)}`}>{fmtClock(newsAt)}</time>
                  <span>
                    {update.title && <strong>{update.title}{update.text ? ":" : ""}</strong>} {update.text}
                    <span className="desk-brief-meta">
                      <Sources sources={update.sources} />
                      {late && <span className="desk-muted">added {fmtClock(update.at)}</span>}
                      <Unchecked check={update} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="desk-brief-foot">
        Written by the local model from {brief.counts.given} picked of {brief.counts.stories} stories tied to the company; every number and name is checked against the cited stories, which are mostly headlines and feed summaries. The check cannot catch two true facts joined wrongly.
        {skipLine(brief.counts.skipped)}
        {brief.others.length > 0 && (
          <> <button type="button" className="desk-news-more" aria-expanded={others} onClick={() => setOthers((open) => !open)}>{others ? "Hide" : "Show"} the {brief.others.length} other picked {brief.others.length === 1 ? "story" : "stories"}</button></>
        )}
      </p>
      {others && (
        <ul className="desk-news-sources">
          {brief.others.map((source) => (
            <li key={source.id}><a className="desk-link" href={source.url} target="_blank" rel="noreferrer">{source.title}</a><span className="desk-muted"> · {source.publisher} · {fmtDateTime(source.at)}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
