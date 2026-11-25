/**
 * English only (owner, 2026-11-25: "just english, drop other news, no other languages"). Decides whether a news item
 * is English from what carries language: GlobeNewswire's language code in the address when there is one, else the
 * words of the title and summary without tickers and other all-capital tokens, numbers, symbols, addresses and the
 * outlet Google News appends. An item is foreign only when the detector (eld, the large table) is reliable, has at
 * least four real words to go on, puts another language ahead of English by MARGIN, and the text uses a common word
 * of that language (or a non-Latin script); anything shorter stays, because a short English headline ("Expedia
 * declares $0.48 dividend") reads as Spanish to every detector.
 * Measured on the 22,016 items of 2026-11-25: 191 of 194 GlobeNewswire releases match their own language code
 * without using it (the misses: a two-word French title kept, a bilingual Icelandic one dropped).
 */
import { eld } from "eld/large";

export const LANGUAGE_MARGIN = 0.09;

export interface LanguageInput { title: string; summary?: string | null; publisher?: string | null; url?: string | null }
export interface LanguageVerdict { english: boolean; language: string; how: "address" | "text" | "short" }

/** The words that carry language. */
export function languageText(item: LanguageInput): string {
  const publisher = item.publisher ?? "";
  const title = publisher && item.title.endsWith(` - ${publisher}`) ? item.title.slice(0, -publisher.length - 3) : item.title;
  let summary = (item.summary ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (summary.toLowerCase().startsWith(item.title.toLowerCase().slice(0, 40))) summary = summary.slice(item.title.length);
  if (publisher && summary.trim() === publisher) summary = "";
  return `${title}. ${summary}`
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\p{Lu}\d][\p{Lu}\d.&/-]*\b/gu, (token) => (token.length > 1 && token === token.toUpperCase() ? " " : token))
    .replace(/[^\p{L}\s'’-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

const realWords = (text: string) => text.split(" ").filter((word) => /\p{Ll}/u.test(word) && word.length > 1).length;

/**
 * Common short words of the Latin-script languages the feeds carry. A text the detector calls one of these must also
 * use one of its words: an English headline about a company with a foreign name ("Perusahaan Perseroan (Persero) PT
 * Telekomunikasi Indonesia Tbk GAAP EPS of IDR 100.75") reads as Malay from the name alone.
 */
const FUNCTION_WORDS: Record<string, string[]> = {
  de: ["und", "der", "die", "das", "mit", "für", "von", "auf", "ist", "den", "im", "zu", "des", "ein", "eine", "über"],
  fr: ["le", "la", "les", "des", "du", "et", "pour", "une", "un", "sur", "avec", "dans", "au", "aux", "est", "son", "sa", "ses"],
  es: ["el", "la", "los", "las", "del", "de", "y", "para", "con", "por", "una", "un", "en", "su", "sus", "se"],
  it: ["il", "la", "le", "di", "del", "della", "e", "per", "con", "una", "un", "nel", "sul", "dei", "gli"],
  pt: ["os", "do", "da", "dos", "das", "e", "para", "com", "uma", "um", "em", "na", "não"],
  nl: ["het", "een", "en", "van", "voor", "met", "op", "te", "zijn", "naar"],
  sv: ["och", "att", "för", "med", "av", "på", "en", "ett", "som", "är", "till"],
  no: ["og", "til", "med", "av", "på", "et", "som", "er", "ikke", "fra"],
  da: ["og", "til", "med", "af", "på", "et", "som", "er", "ikke", "fra"],
  fi: ["ja", "että", "sekä", "tai", "oy", "oyj", "ovat"],
  et: ["ja", "kui", "või", "ning", "aktsiaselts", "ehk"],
  pl: ["w", "z", "na", "się", "oraz", "dla", "od", "jest"],
  cs: ["v", "na", "se", "z", "pro", "k", "je", "ve"],
  sk: ["v", "na", "sa", "z", "pre", "k", "je", "vo"],
  ms: ["dan", "yang", "di", "untuk", "dengan", "ke", "dari", "pada"],
  id: ["dan", "yang", "di", "untuk", "dengan", "ke", "dari", "pada"],
  tr: ["ve", "bir", "ile", "için", "bu", "da", "de"],
  ro: ["și", "si", "în", "de", "la", "cu", "pentru", "din", "pe"],
};
const NON_LATIN = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}]/gu;

function foreignEvidence(text: string, language: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  if (letters && (text.match(NON_LATIN)?.length ?? 0) / letters > 0.3) return true;
  const words = FUNCTION_WORDS[language];
  if (!words) return true;   // a language without a list: the detector's verdict stands
  const own = new Set(words);
  return text.toLowerCase().split(" ").some((word) => own.has(word));
}

export function newsLanguage(item: LanguageInput): LanguageVerdict {
  const code = /globenewswire\.com\/news-release\/\d{4}\/\d{2}\/\d{2}\/\d+\/\d+\/([a-z]{2})\//.exec(item.url ?? "")?.[1];
  if (code) return { english: code === "en", language: code, how: "address" };
  const text = languageText(item);
  if (realWords(text) < 4) return { english: true, language: "und", how: "short" };
  const result = eld.detect(text);
  const language = result.language || "und";
  if (language === "en" || language === "und" || !result.isReliable()) return { english: true, language, how: "text" };
  const scores = result.getScores();
  const lead = (scores[language] ?? 0) - (scores.en ?? 0);
  return { english: lead < LANGUAGE_MARGIN || !foreignEvidence(text, language), language, how: "text" };
}
