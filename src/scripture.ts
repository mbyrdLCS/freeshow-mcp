import fs from "fs";
import os from "os";
import path from "path";

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

// First ("a") or second ("b") half of a verse: split at the sentence nearest the middle, or at a
// comma when the verse is one sentence. The cut is marked with "…" (Crossway requires an ellipsis
// for omitted words).
function halfVerse(text: string, part: "a" | "b"): string {
  const pieces = (re: RegExp) => text.match(re)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  let parts = pieces(/[^.!?;:]+[.!?;:]+["'’”)]*\s*|[^.!?;:]+$/g);
  if (parts.length < 2) parts = pieces(/[^,]+,\s*|[^,]+$/g);
  if (parts.length < 2) return text;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const diff = Math.abs(parts.slice(0, i).join(" ").length - text.length / 2);
    if (diff < bestDiff) [best, bestDiff] = [i, diff];
  }
  const first = parts.slice(0, best).join(" ");
  const second = parts.slice(best).join(" ");
  return part === "a" ? `${first.replace(/[,;:]$/, "")} …` : `… ${second}`;
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

// ─── ESV (Crossway's API) ─────────────────────────────────────────────────────
// The ESV isn't in FreeShow's Bible list. Crossway offers a free API key for non-commercial use
// (api.esv.org); quotes must be labeled "ESV". The key is kept in a local config file, not the repo.

const CONFIG_FILE = path.join(os.homedir(), ".freeshow-mcp", "config.json");

function readConfig(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveEsvKey(key: string) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), esvApiKey: key.trim() }, null, 2), { mode: 0o600 });
  return CONFIG_FILE;
}

export const esvKeySaved = () => !!esvKey();

function esvKey(): string | undefined {
  // The Claude desktop app passes an unfilled optional setting through as the literal
  // "${user_config.esv_api_key}", so treat placeholders as "not set"
  const fromEnv = process.env.FREESHOW_MCP_ESV_KEY?.trim();
  return (fromEnv && !fromEnv.includes("${") ? fromEnv : undefined) || readConfig().esvApiKey;
}

export const isEsv = (translation: string) => norm(translation) === "esv";

// Crossway requires this credit wherever ESV text is shown (api.esv.org/#copyright)
export const ESV_NOTICE =
  "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, " +
  "a publishing ministry of Good News Publishers. Used by permission. All rights reserved.\nwww.esv.org";

export async function fetchEsvPassage(reference: string): Promise<{ reference: string; abbr: string; verses: Verse[] }> {
  const key = esvKey();
  if (!key) throw new Error("ESV needs a free API key from api.esv.org — save it with set_esv_api_key");
  const verses: Verse[] = [];
  const labels: string[] = [];
  for (const ref of parseReferences(reference)) {
    const span = ref.from === undefined ? "" : `:${ref.from}${ref.toChapter && ref.toChapter !== ref.chapter ? `-${ref.toChapter}:${ref.to}` : ref.to !== ref.from ? `-${ref.to}` : ""}`;
    const q = `${ref.book} ${ref.chapter}${span}`;
    const params = new URLSearchParams({
      q,
      "include-passage-references": "false",
      "include-verse-numbers": "true",
      "include-first-verse-numbers": "true",
      "include-footnotes": "false",
      "include-headings": "false",
      "include-short-copyright": "false",
      "include-copyright": "false",
      "indent-paragraphs": "0",
      "indent-poetry": "false",
      "line-length": "0",
    });
    const res = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
      headers: { Authorization: `Token ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) throw new Error("The ESV API key was rejected — check it at api.esv.org");
    if (!res.ok) throw new Error(`ESV API returned HTTP ${res.status}`);
    const data = (await res.json()) as { canonical?: string; passages?: string[] };
    const passage = data.passages?.[0];
    if (!passage || !data.canonical) throw new Error(`Couldn't find "${q}" in the ESV`);
    const bookName = data.canonical.replace(/\s+\d+(?::[\d–-]+)?(?:[–-]\d+(?::\d+)?)?$/, "");

    // "[16] For God so loved… [17] For God did not…": split on the verse markers
    const pieces = [...passage.matchAll(/\[(\d+)\]\s*([\s\S]*?)(?=\s*\[\d+\]|$)/g)];
    let chapter = ref.chapter;
    let prev = 0;
    pieces.forEach(([, num, body], i) => {
      const n = Number(num);
      if (n < prev) chapter++; // crossed into the next chapter
      prev = n;
      let text = cleanText(body);
      let suffix = "";
      if (i === pieces.length - 1 && ref.toPart) [text, suffix] = [halfVerse(text, ref.toPart), ref.toPart];
      else if (i === 0 && ref.fromPart) [text, suffix] = [halfVerse(text, ref.fromPart), ref.fromPart];
      verses.push({ reference: `${bookName} ${chapter}:${n}${suffix}`, text });
    });
    labels.push(data.canonical.replace("–", "-") + (ref.toPart && ref.to !== ref.from ? ref.toPart : ""));
  }
  return { reference: labels.join("; "), abbr: "ESV", verses };
}

/**
 * Group consecutive verses onto slides while they fit (≈ maxChars at full size), balanced so a
 * passage splits evenly instead of leaving one short verse alone. References become ranges
 * ("Luke 16:23–24"). Verses too long for one slide are split on their own.
 */
export function packVerses(verses: Verse[], maxChars: number): { reference: string; text: string }[] {
  const slides: { reference: string; text: string }[] = [];
  const emit = (group: Verse[]) => {
    const first = group[0].reference;
    const last = group[group.length - 1].reference;
    const lastVerse = last.slice(last.lastIndexOf(":") + 1);
    const sameChapter = first.slice(0, first.lastIndexOf(":")) === last.slice(0, last.lastIndexOf(":"));
    const reference = group.length === 1 ? first : sameChapter ? `${first}–${lastVerse}` : `${first}–${last.slice(last.lastIndexOf(" ") + 1)}`;
    slides.push({ reference, text: group.map((v) => v.text).join(" ") });
  };

  // Split a run of verses (each shorter than maxChars) into the fewest slides, then balance them
  const packRun = (run: Verse[]) => {
    if (!run.length) return;
    const len = (i: number, j: number) => run.slice(i, j).reduce((n, v) => n + v.text.length + 1, -1);
    let count = 0;
    for (let i = 0; i < run.length; count++) {
      let j = i + 1;
      while (j < run.length && len(i, j + 1) <= maxChars) j++;
      i = j;
    }
    // best[i][k] = smallest possible "longest slide" for verses i.. split into k slides
    const memo = new Map<string, { worst: number; cut: number }>();
    const best = (i: number, k: number): { worst: number; cut: number } => {
      const key = `${i},${k}`;
      if (memo.has(key)) return memo.get(key)!;
      let result = { worst: Infinity, cut: run.length };
      if (k === 1) result = { worst: len(i, run.length) <= maxChars ? len(i, run.length) : Infinity, cut: run.length };
      else
        for (let j = i + 1; j <= run.length - (k - 1); j++) {
          const here = len(i, j);
          if (here > maxChars) break;
          const worst = Math.max(here, best(j, k - 1).worst);
          if (worst < result.worst) result = { worst, cut: j };
        }
      memo.set(key, result);
      return result;
    };
    for (let i = 0, k = count; i < run.length; k--) {
      const { cut } = best(i, k);
      emit(run.slice(i, cut));
      i = cut;
    }
  };

  let run: Verse[] = [];
  for (const verse of verses) {
    if (verse.text.length > maxChars) {
      packRun(run);
      run = [];
      const parts = splitLongText(verse.text, maxChars);
      parts.forEach((part, i) => slides.push({ reference: `${verse.reference}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`, text: part }));
      continue;
    }
    run.push(verse);
  }
  packRun(run);
  return slides;
}
