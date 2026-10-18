// Public-domain Bible text from bible-api.com (no key needed). Copyrighted translations
// (NIV, ESV, NKJV, …) aren't available there and have to be pasted in by hand.

export const TRANSLATIONS: Record<string, string> = {
  kjv: "KJV",
  web: "WEB",
  asv: "ASV",
  bbe: "BBE",
  darby: "Darby",
  ylt: "YLT",
};

export interface Verse {
  reference: string; // e.g. "Ephesians 6:10"
  text: string;
}

export async function fetchPassage(reference: string, translation: string): Promise<{ reference: string; verses: Verse[] }> {
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = (await res.json().catch(() => ({}))) as {
    reference?: string;
    error?: string;
    verses?: { book_name: string; chapter: number; verse: number; text: string }[];
  };
  if (!res.ok || !data.verses?.length) throw new Error(`Couldn't find "${reference}" (${data.error ?? `HTTP ${res.status}`})`);
  return {
    reference: data.reference ?? reference,
    verses: data.verses.map((v) => ({
      reference: `${v.book_name} ${v.chapter}:${v.verse}`,
      text: v.text.replace(/\s+/g, " ").trim(),
    })),
  };
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
