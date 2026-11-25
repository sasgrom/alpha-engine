/**
 * News stories as a reading list: one row per story however many outlets carried it. The headline links to the
 * first outlet we saw; "+N outlets" opens who else carried it and when we saw each copy. The local model's reading
 * (event, direction, new or follow-up, one-line fact) shows only when the server sent it.
 */
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus, Shuffle } from "lucide-react";
import { NEWS_EVENT_LABELS, type DeskNewsStory, type NewsCompanyTie } from "@contracts/desk-news";
import { CompanyLink } from "../components";
import { fmtClock, fmtDate, fmtDateTime } from "../format";

const DIRECTION = {
  positive: { label: "Positive", Icon: ArrowUpRight, className: "desk-up" },
  negative: { label: "Negative", Icon: ArrowDownRight, className: "desk-down" },
  neutral: { label: "Neutral", Icon: Minus, className: "desk-muted" },
  mixed: { label: "Mixed", Icon: Shuffle, className: "desk-ink-2" },
} as const;
const NOVELTY = { new: "New", followup: "Follow-up", noise: "Noise" } as const;
const TIE_WORDS: Record<string, string> = { subject: "the story is about it", filer: "its SEC filing", tagged: "tagged by the wire", mentioned: "named in the story", asked: "returned by its company feed" };

const when = (story: DeskNewsStory) => story.publishedAt ?? story.firstSeenAt;

/** "10:42 AM" for today, "Nov 21" before. */
function StoryTime({ story, now }: { story: DeskNewsStory; now: Date }) {
  const at = when(story);
  const sameDay = new Date(at).toDateString() === now.toDateString();
  return <time dateTime={at} title={`Published ${fmtDateTime(story.publishedAt)} · first seen by us ${fmtDateTime(story.firstSeenAt)}`}>{sameDay ? fmtClock(at).replace(/ [A-Z]{2,5}$/, "") : fmtDate(at.slice(0, 10), "short")}</time>;
}

function lateNote(story: DeskNewsStory): string | null {
  if (!story.publishedAt) return null;
  const hours = (Date.parse(story.firstSeenAt) - Date.parse(story.publishedAt)) / 3_600_000;
  if (hours < 6) return null;
  return hours < 48 ? `seen ${Math.round(hours)} hours after publication` : `seen ${Math.round(hours / 24)} days after publication`;
}

function Chips({ companies, known, focus }: { companies: NewsCompanyTie[]; known: Map<number, { ticker: string; cik: number }>; focus?: number }) {
  const shown = companies.filter((company) => company.cik !== focus).slice(0, 6);
  if (!shown.length) return null;
  return (
    <span className="desk-news-chips">
      {shown.map((company) => {
        const desk = known.get(company.cik);
        const label = company.ticker ?? company.name ?? `CIK ${company.cik}`;
        const title = `${company.name ?? label}: ${company.ties.map((tie) => TIE_WORDS[tie]).join(", ")}`;
        return desk
          ? <CompanyLink key={company.cik} company={desk} className={`desk-news-chip${company.ties[0] === "asked" || company.ties[0] === "mentioned" ? " weak" : ""}`} aria-label={title}><span title={title}>{label}</span></CompanyLink>
          : <span key={company.cik} className="desk-news-chip outside" title={`${title} · outside the covered companies`}>{label}</span>;
      })}
      {companies.length > shown.length + (focus ? 1 : 0) && <span className="desk-muted">+{companies.length - shown.length - (focus ? 1 : 0)}</span>}
    </span>
  );
}

export function StoryRow({ story, known, focus, now }: { story: DeskNewsStory; known: Map<number, { ticker: string; cik: number }>; focus?: number; now: Date }) {
  const [open, setOpen] = useState(false);
  const reading = story.reading;
  const direction = reading ? DIRECTION[reading.direction] : null;
  const late = lateNote(story);
  return (
    <li className={`desk-news-row${reading?.novelty === "noise" ? " noise" : ""}`}>
      <span className="desk-news-time"><StoryTime story={story} now={now} /></span>
      <div className="desk-news-body">
        <a className="desk-news-title" href={story.url} target="_blank" rel="noreferrer">{story.title}<ExternalLink size={11} aria-hidden="true" /></a>
        {reading?.fact && reading.fact.toLowerCase() !== story.title.toLowerCase() && <p className="desk-news-fact">{reading.fact}</p>}
        <div className="desk-news-meta">
          <span>{story.publisher}</span>
          {story.copies > 0 && (
            <button type="button" className="desk-news-more" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              +{story.copies} {story.copies === 1 ? "outlet" : "outlets"}
            </button>
          )}
          {late && <span className="desk-muted">{late}</span>}
          {reading && <span className="desk-badge" style={{ height: 19 }}>{NEWS_EVENT_LABELS[reading.eventType] ?? reading.eventType}</span>}
          {direction && (
            <span className={`desk-news-direction ${direction.className}`}>
              <direction.Icon size={13} aria-hidden="true" />{direction.label}
            </span>
          )}
          {reading && reading.novelty !== "new" && <span className="desk-muted">{NOVELTY[reading.novelty]}</span>}
          <Chips companies={story.companies} known={known} focus={focus} />
        </div>
        {open && (
          <ul className="desk-news-sources">
            {story.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a className="desk-link" href={source.url} target="_blank" rel="noreferrer">{source.publisher}</a>
                <span className="desk-muted"> · seen {fmtDateTime(source.firstSeenAt)}</span>
              </li>
            ))}
            {story.copies > story.sources.length && <li className="desk-muted">and {story.copies - story.sources.length} more</li>}
          </ul>
        )}
      </div>
    </li>
  );
}

export function StoryList({ stories, known, focus, empty }: { stories: DeskNewsStory[]; known: Map<number, { ticker: string; cik: number }>; focus?: number; empty: string }) {
  const now = new Date();
  if (!stories.length) return <div className="desk-empty">{empty}</div>;
  return (
    <ol className="desk-news-list">
      {stories.map((story) => <StoryRow key={story.id} story={story} known={known} focus={focus} now={now} />)}
    </ol>
  );
}
