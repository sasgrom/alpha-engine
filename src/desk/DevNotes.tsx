import { Wrench } from "lucide-react";
import { useDesk } from "./context";
import { DEV_NOTES, type DevNotesPage } from "./devnotes-data";

/** Owner-only build notes at the foot of a page; collapsed until opened. Other users never see them. */
export function DevNotes({ page }: { page: DevNotesPage }) {
  const { isAdmin } = useDesk();
  if (!isAdmin) return null;
  const notes = DEV_NOTES[page];
  return (
    <details className="desk-devnotes">
      <summary>
        <Wrench size={15} aria-hidden="true" /> Build notes
        <small>owner only · {notes.missing.length} missing · {notes.better.length} could be better</small>
      </summary>
      <div className="desk-devnotes-body">
        <div>
          <h4>Missing</h4>
          <ul>{notes.missing.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
        <div>
          <h4>Could be better — and what we are short of</h4>
          <ul>
            {notes.better.map(([what, shortOf]) => (
              <li key={what}><b>{what}</b> — short of {shortOf}.</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
