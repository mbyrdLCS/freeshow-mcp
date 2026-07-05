import Genius from "genius-lyrics";

const client = new Genius.Client();

export interface SongResult {
  title: string;
  artist: string;
  fullTitle: string;
}

export async function searchSongs(query: string): Promise<SongResult[]> {
  const songs = await client.songs.search(query);
  return songs.slice(0, 5).map((s) => ({
    title: s.title,
    artist: s.artist?.name ?? "",
    fullTitle: s.fullTitle,
  }));
}

export async function fetchLyrics(query: string): Promise<{ title: string; artist: string; lyrics: string }> {
  const songs = await client.songs.search(query);
  if (!songs.length) throw new Error(`No songs found for "${query}"`);
  const song = songs[0];
  const raw = await song.lyrics();
  const lyrics = raw
    .split("\n")
    .filter((l) => !/^\d*Embed$/.test(l.trim()))
    .join("\n")
    .trim();
  return { title: song.title, artist: song.artist?.name ?? "", lyrics };
}
