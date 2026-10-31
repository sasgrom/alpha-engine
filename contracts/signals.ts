export const SIGNAL_NOTE_MAX_LENGTH = 2000;
export const SIGNAL_WHY_MAX_LENGTH = 480;

/** Keep complete sentences or complete window notes whenever the limit allows.
 * Fall back to a word boundary with an ellipsis for one overlong sentence. */
export function truncateSignalNote(value: string, maxLength = SIGNAL_NOTE_MAX_LENGTH): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new Error("maxLength must be a positive integer");
  const text = value.trim();
  if (text.length <= maxLength) return text;
  if (maxLength === 1) return "…";

  const prefix = text.slice(0, maxLength);
  let sentenceEnd = 0;
  for (const match of prefix.matchAll(/[.!?]+(?:["')\]]+)?(?=\s|$)/g)) {
    sentenceEnd = (match.index ?? 0) + match[0].length;
  }
  const windowBoundary = prefix.lastIndexOf(" | ");
  const safeBoundary = Math.max(sentenceEnd, windowBoundary);
  const minimumUsefulLength = Math.floor(maxLength * 0.6);
  if (safeBoundary >= minimumUsefulLength) return prefix.slice(0, safeBoundary).trimEnd();

  const fallback = prefix.slice(0, maxLength - 1);
  const wordBoundary = fallback.lastIndexOf(" ");
  const cut = wordBoundary >= minimumUsefulLength ? fallback.slice(0, wordBoundary) : fallback;
  return `${cut.trimEnd()}…`;
}

export function joinSignalNotes(notes: string[], maxLength = SIGNAL_NOTE_MAX_LENGTH): string | null {
  const joined = notes.filter((note) => note.trim().length > 0).join(" | ");
  return joined ? truncateSignalNote(joined, maxLength) : null;
}
