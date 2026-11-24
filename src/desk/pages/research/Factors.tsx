import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, ExternalLink, Link2, Search } from "lucide-react";
import { FACTOR_META } from "../../../../api/services/factor-meta";
import { useDocumentTitle } from "../../context";
import { DevNotes } from "../../DevNotes";
import "./LibraryDocuments.css";

export default function Factors() {
  useDocumentTitle("Factor wiki");
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return FACTOR_META;
    return FACTOR_META.filter((factor) => [factor.key, factor.name, factor.shortHint, factor.wiki, factor.formula, factor.howWeCompute, factor.reference].join(" ").toLocaleLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="desk-library-page">
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Library · definitions and calculations</span>
          <h1>Factor wiki</h1>
          <p className="desk-lede">The logic, exact formula, data lineage and academic source behind every factor. These are reference readings, never orders.</p>
        </div>
        <Link to="/desk/research/library" className="desk-button"><ArrowLeft size={14} /> Library</Link>
      </div>

      <label className="desk-factor-search">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">Search factors</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search factors, formulas or sources" />
        <span>{entries.length} of {FACTOR_META.length}</span>
      </label>

      <div className="desk-factor-list">
        {entries.map((factor) => (
          <section key={factor.key} id={factor.key} className="desk-card desk-factor-entry">
            <div className="desk-factor-title">
              <h2>{factor.name}</h2>
              <a href={`#${factor.key}`} aria-label={`Link to ${factor.name}`} title="Link to this entry"><Link2 size={15} /></a>
            </div>
            <p className="desk-factor-reading">A description of the reading. No signal is claimed: see <Link to="/desk/research">Signals</Link> for what has been measured.</p>
            <p className="desk-factor-description">{factor.shortHint}</p>
            <p>{factor.wiki}</p>
            <div className="desk-factor-details">
              <div><h3>Formula we run</h3><code>{factor.formula}</code></div>
              <div><h3>How we compute it</h3><p>{factor.howWeCompute}</p></div>
              <div><h3>Reference read</h3><p>{factor.reference}</p></div>
            </div>
            <div className="desk-factor-sources">
              <a href={factor.anchor.link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {factor.anchor.citation}</a>
              <a href={factor.wikiLink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Further reading (Wikipedia)</a>
            </div>
          </section>
        ))}
      </div>
      {!entries.length && <div className="desk-card desk-empty">No factor matches “{query}”. Try a name, formula or source.</div>}
      <DevNotes page="factorWiki" />
    </div>
  );
}
