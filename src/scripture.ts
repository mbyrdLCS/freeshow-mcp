// Bible text from ChurchApps' Bible service — the same source FreeShow's online Bibles use
// (API.Bible and YouVersion, including licensed translations like NIV and NASB). No key needed.

const API = "https://api.churchapps.org/content/bibles";

export interface Verse {
  reference: string; // e.g. "Ephesians 6:10"
  text: string;
}

interface BibleInfo {
  abbreviation: string;
  name: string;
  source: string;
  sourceKey: string;
  language: string;
}
interface Book {
  keyName: string; // USFM code, e.g. "EPH"
  name: string;
  abbreviation: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Bible service returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

let biblesCache: BibleInfo[] | undefined;
async function bibles(): Promise<BibleInfo[]> {
  return (biblesCache ??= await getJson<BibleInfo[]>(API));
}

// YouVersion labels languages with 2-letter codes ("en"), API.Bible with 3 ("eng")
const LANG_ALIASES: Record<string, string> = { en: "eng", es: "spa", fr: "fra", de: "deu", pt: "por", nl: "nld" };
const lang = (code: string) => LANG_ALIASES[code] ?? code;

// "engKJV" -> "KJV"
const displayAbbr = (b: BibleInfo) => b.abbreviation.replace(/^eng(?=[A-Z])/, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find a translation by abbreviation (NIV, KJV…), name, or ID. English editions win ties. */
export async function findTranslation(query: string): Promise<{ id: string; abbr: string; name: string }> {
  const all = await bibles();
  const q = norm(query);
  const matches = all.filter(
    (b) => b.sourceKey.toLowerCase() === query.toLowerCase() || norm(displayAbbr(b)) === q || norm(b.abbreviation) === q || norm(b.name) === q
  );
  matches.sort((a, b) => Number(lang(b.language) === "eng") - Number(lang(a.language) === "eng"));
  const hit = matches[0];
  if (!hit) throw new Error(`Translation "${query}" isn't available. Try list_bible_translations.`);
  return { id: hit.sourceKey, abbr: displayAbbr(hit), name: hit.name };
}

export async function listTranslations(language = "eng") {
  return (await bibles())
    .filter((b) => language === "*" || lang(b.language) === lang(language))
    .map((b) => ({ abbreviation: displayAbbr(b), name: b.name, id: b.sourceKey, source: b.source }));
}

const booksCache: Record<string, Book[]> = {};
const BOOK_ALIASES: Record<string, string> = {
  psalm: "PSA", ps: "PSA", songofsongs: "SNG", songofsolomon: "SNG", song: "SNG", canticles: "SNG", revelations: "REV", rev: "REV",
  jn: "JHN", jhn: "JHN", mk: "MRK", mt: "MAT", lk: "LUK", phil: "PHP", philem: "PHM", jas: "JAS",
};

async function findBook(bibleId: string, name: string): Promise<Book> {
  const books = (booksCache[bibleId] ??= await getJson<Book[]>(`${API}/${bibleId}/books`));
  const q = norm(name);
  const alias = BOOK_ALIASES[q];
  const hit =
    books.find((b) => b.keyName === alias) ??
    books.find((b) => norm(b.name) === q || norm(b.abbreviation) === q || norm(b.keyName) === q) ??
    (q.length >= 3 ? books.find((b) => norm(b.name).startsWith(q)) : undefined);
  if (!hit) throw new Error(`Couldn't find the book "${name}"`);
  return hit;
}

interface Ref {
  book: string;
  chapter: number;
  from?: number;
  to?: number;
  toChapter?: number;
  fromPart?: "a" | "b"; // "16b": start halfway through the first verse
  toPart?: "a" | "b"; // "44a": stop halfway through the last verse
}

/** Parse "John 3:16-18; Eph 2:8, 10" into individual references (later parts inherit book/chapter). */
export function parseReferences(input: string): Ref[] {
  const refs: Ref[] = [];
  let book = "";
  let chapter = 0;
  for (const rawPart of input.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    // Partial verses: "41-44a" ends with the first half of 44; "16b-18" starts with the second half of 16
    const parts = [...rawPart.matchAll(/(\d)([ab])\b/gi)].map((m) => m[2].toLowerCase() as "a" | "b");
    const raw = rawPart.replace(/(\d)[ab]\b/gi, "$1");
    const isRange = /[-–—]/.test(raw);
    const fromPart = /^\D*\d+:\d+[ab]/i.test(rawPart) || (!isRange && parts.length) ? parts[0] : undefined;
    const toPart = isRange && /[ab]\s*$/i.test(rawPart) ? parts[parts.length - 1] : !isRange ? fromPart : undefined;
    const before = refs.length;
    const full = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d+)(?::(\d+)(?:\s*[-–—]\s*(?:(\d+):)?(\d+))?)?$/.exec(raw);
    if (full) {
      book = full[1].trim();
      chapter = Number(full[2]);
      if (!full[3]) refs.push({ book, chapter });
      else if (full[4]) refs.push({ book, chapter, from: Number(full[3]), toChapter: Number(full[4]), to: Number(full[5]) });
      else refs.push({ book, chapter, from: Number(full[3]), to: Number(full[5] ?? full[3]) });
      if (refs.length > before) Object.assign(refs[refs.length - 1], { fromPart, toPart });
      continue;
    }
    // Continuation like "31" or "31-33" or "4:2" after an earlier reference
    const cont = /^(?:(\d+):)?(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(raw);
    if (cont && book) {
      if (cont[1]) chapter = Number(cont[1]);
      refs.push({ book, chapter, from: Number(cont[2]), to: Number(cont[3] ?? cont[2]), fromPart, toPart });
      continue;
    }
    throw new Error(`Couldn't read the reference "${raw}"`);
  }
  return refs;
}

// Small caps like L<span>ORD</span> arrive split ("L ord", "G od"); restore LORD/GOD
function cleanText(text: string): string {
  return text
    .replace(/¶/g, "")
    .replace(/\bL\s+ord\b/g, "LORD")
    .replace(/\bL\s+ORD\b/g, "LORD")
    .replace(/\bG\s+od\b/g, "GOD")
    .replace(/\bG\s+OD\b/g, "GOD")
    .replace(/\s+/g, " ")
    .trim();
}

// First ("a") or second ("b") half of a verse, split at the sentence boundary nearest the middle
function halfVerse(text: string, part: "a" | "b"): string {
  const sentences = text.match(/[^.!?;:]+[.!?;:]+["'’”)]*\s*|[^.!?;:]+$/g)?.map((x) => x.trim()) ?? [text];
  if (sentences.length < 2) return text;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < sentences.length; i++) {
    const diff = Math.abs(sentences.slice(0, i).join(" ").length - text.length / 2);
    if (diff < bestDiff) [best, bestDiff] = [i, diff];
  }
  return (part === "a" ? sentences.slice(0, best) : sentences.slice(best)).join(" ");
}

export async function fetchPassage(reference: string, translation: string): Promise<{ reference: string; abbr: string; verses: Verse[] }> {
  const t = await findTranslation(translation);
  const verses: Verse[] = [];
  const labels: string[] = [];
  for (const ref of parseReferences(reference)) {
    const book = await findBook(t.id, ref.book);
    const bookName = book.keyName === "PSA" ? "Psalm" : book.name; // "Psalm 23", not "Psalms 23"
    let from = ref.from;
    let to = ref.to;
    const toChapter = ref.toChapter ?? ref.chapter;
    if (from === undefined) {
      // Whole chapter
      const list = await getJson<{ number: number }[]>(`${API}/${t.id}/chapters/${book.keyName}.${ref.chapter}/verses`);
      from = 1;
      to = Math.max(...list.map((v) => v.number));
    }
    const range = `${book.keyName}.${ref.chapter}.${from}-${book.keyName}.${toChapter}.${to}`;
    const data = await getJson<{ chapterNumber?: number; verseKey: string; verseNumber: number; content: string }[]>(`${API}/${t.id}/verses/${range}`);
    if (!data.length) throw new Error(`No verses found for ${reference} in ${t.abbr}`);
    data.forEach((v, i) => {
      const chapter = v.chapterNumber ?? Number(v.verseKey.split(".")[1]);
      let text = cleanText(v.content);
      let suffix = "";
      if (i === data.length - 1 && ref.toPart) [text, suffix] = [halfVerse(text, ref.toPart), ref.toPart];
      else if (i === 0 && ref.fromPart) [text, suffix] = [halfVerse(text, ref.fromPart), ref.fromPart];
      verses.push({ reference: `${bookName} ${chapter}:${v.verseNumber}${suffix}`, text });
    });
    labels.push(
      ref.from === undefined
        ? `${bookName} ${ref.chapter}`
        : `${bookName} ${ref.chapter}:${from}${ref.fromPart ?? ""}${toChapter !== ref.chapter ? `-${toChapter}:${to}` : to !== from ? `-${to}` : ""}${to !== from && ref.toPart ? ref.toPart : ""}`
    );
  }
  return { reference: labels.join("; "), abbr: t.abbr, verses };
}

// Split a long verse into slide-sized pieces at sentence, then clause, boundaries
export function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf("? "));
    if (cut < maxChars * 0.4) cut = window.lastIndexOf(", ");
    if (cut < maxChars * 0.4) cut = window.lastIndexOf(" ");
    pieces.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
