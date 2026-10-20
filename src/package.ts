import fs from "fs";
import os from "os";
import path from "path";
import { appDataDir, dataDir } from "./deleteShows.js";
import { listThemes, loadTheme, userThemesDir } from "./themes.js";

// A package is a plain folder that carries a church's setup to another computer:
//   manifest.json       what's inside, plus the original paths so they can be rewritten
//   shows/<id>.json     full FreeShow show data
//   themes/<folder>/    theme folders (theme.json + images)
//   media/              other files the shows reference (logos, videos…)
//   bibles/             offline Bibles (.fsb) — only ones you're licensed to share
//   fonts/              font files the theme needs

export interface PackageManifest {
  format: 1;
  created: string;
  project?: { name: string; shows: string[] };
  shows: Record<string, { name: string; file: string }>;
  themes: { name: string; folder: string; originalPath: string }[];
  media: Record<string, string>; // original absolute path -> path inside the package
  bibles: string[];
  fonts: string[];
  settings: {
    textTransition?: string;
    scriptureTemplates?: { theme: string; style: string; name: string; default?: boolean }[];
  };
}

type AnyObj = Record<string, any>;

function copyDir(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

// show.media entries actually used by a slide (FreeShow keeps entries for media that was only dropped on a show)
function usedMediaIds(show: AnyObj): Set<string> {
  const used = new Set<string>();
  for (const layout of Object.values<AnyObj>(show.layouts ?? {})) {
    for (const ref of layout.slides ?? []) {
      if (ref.background) used.add(ref.background);
      for (const a of ref.audio ?? []) used.add(a);
      for (const child of Object.values<AnyObj>(ref.children ?? {})) {
        if (child.background) used.add(child.background);
        for (const a of child.audio ?? []) used.add(a);
      }
    }
  }
  return used;
}

// A copy of the show without unused media entries
function withoutUnusedMedia(show: AnyObj): AnyObj {
  const used = usedMediaIds(show);
  const media = Object.fromEntries(Object.entries<AnyObj>(show.media ?? {}).filter(([id]) => used.has(id)));
  return { ...show, media };
}

// Every absolute file path a show points at (backgrounds, media items, remembered images)
function referencedFiles(show: AnyObj): string[] {
  const found = new Set<string>();
  for (const m of Object.values<AnyObj>(show.media ?? {})) if (m?.path) found.add(m.path);
  for (const slide of Object.values<AnyObj>(show.slides ?? {})) {
    for (const item of slide.items ?? []) if (typeof item.src === "string") found.add(item.src);
  }
  for (const list of Object.values<AnyObj[]>(show.settings?.mcpImages ?? {})) for (const img of list) if (img.src) found.add(img.src);
  return [...found].filter((p) => path.isAbsolute(p));
}

// Replace path prefixes anywhere in a JSON value
function rewritePaths<T>(value: T, replacements: [string, string][]): T {
  let json = JSON.stringify(value);
  for (const [from, to] of replacements) json = json.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  return JSON.parse(json);
}

export function writePackage(
  folder: string,
  shows: Record<string, AnyObj>,
  project: { name: string; shows: string[] } | undefined,
  options: { bibles?: string[]; fonts?: string[]; settings?: PackageManifest["settings"] }
) {
  fs.mkdirSync(path.join(folder, "shows"), { recursive: true });
  const manifest: PackageManifest = { format: 1, created: new Date().toISOString(), project, shows: {}, themes: [], media: {}, bibles: [], fonts: [], settings: options.settings ?? {} };

  // Themes the shows use
  const themeNames = new Set(Object.values(shows).map((s) => s.settings?.mcpTheme?.theme).filter(Boolean) as string[]);
  for (const t of options.settings?.scriptureTemplates ?? []) themeNames.add(t.theme);
  for (const name of themeNames) {
    const { folder: themeFolder } = loadTheme(name);
    const base = path.basename(themeFolder);
    if (manifest.themes.some((t) => t.folder === base)) continue; // same theme under another spelling
    copyDir(themeFolder, path.join(folder, "themes", base));
    manifest.themes.push({ name, folder: base, originalPath: themeFolder });
  }

  // Other referenced files (not inside a theme folder)
  const themeRoots = manifest.themes.map((t) => t.originalPath + path.sep);
  const missing: string[] = [];
  for (const [id, original] of Object.entries(shows)) {
    const show = withoutUnusedMedia(original);
    for (const file of referencedFiles(show)) {
      if (themeRoots.some((root) => file.startsWith(root)) || manifest.media[file]) continue;
      if (!fs.existsSync(file)) {
        missing.push(file);
        continue;
      }
      let name = path.basename(file);
      while (Object.values(manifest.media).includes(`media/${name}`)) name = `_${name}`;
      fs.mkdirSync(path.join(folder, "media"), { recursive: true });
      fs.copyFileSync(file, path.join(folder, "media", name));
      manifest.media[file] = `media/${name}`;
    }
    fs.writeFileSync(path.join(folder, "shows", `${id}.json`), JSON.stringify(show), "utf8");
    manifest.shows[id] = { name: show.name, file: `shows/${id}.json` };
  }

  for (const bible of options.bibles ?? []) {
    const file = path.join(dataDir(), "Bibles", bible.endsWith(".fsb") ? bible : `${bible}.fsb`);
    if (!fs.existsSync(file)) throw new Error(`Bible not found: ${file}`);
    fs.mkdirSync(path.join(folder, "bibles"), { recursive: true });
    fs.copyFileSync(file, path.join(folder, "bibles", path.basename(file)));
    manifest.bibles.push(path.basename(file));
  }

  for (const font of options.fonts ?? []) {
    fs.mkdirSync(path.join(folder, "fonts"), { recursive: true });
    fs.copyFileSync(font, path.join(folder, "fonts", path.basename(font)));
    manifest.fonts.push(path.basename(font));
  }

  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { manifest, missing };
}

/** Copy a package's files into place on this computer; returns shows with paths rewritten for here. */
export function installPackageFiles(folder: string) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")) as PackageManifest;
  const replacements: [string, string][] = [];

  for (const t of manifest.themes) {
    const dest = path.join(userThemesDir(), t.folder);
    copyDir(path.join(folder, "themes", t.folder), dest);
    replacements.push([t.originalPath, dest]);
  }

  const mediaDir = path.join(dataDir(), "Media", path.basename(folder));
  for (const [original, inPackage] of Object.entries(manifest.media)) {
    const dest = path.join(mediaDir, path.basename(inPackage));
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(path.join(folder, inPackage), dest);
    replacements.push([original, dest]);
  }

  const bibleDir = path.join(dataDir(), "Bibles");
  for (const bible of manifest.bibles) {
    fs.mkdirSync(bibleDir, { recursive: true });
    fs.copyFileSync(path.join(folder, "bibles", bible), path.join(bibleDir, bible));
  }

  const fontsInstalled: string[] = [];
  if (manifest.fonts.length && process.platform === "darwin") {
    const fontDir = path.join(os.homedir(), "Library", "Fonts");
    fs.mkdirSync(fontDir, { recursive: true });
    for (const font of manifest.fonts) {
      fs.copyFileSync(path.join(folder, "fonts", font), path.join(fontDir, font));
      fontsInstalled.push(font);
    }
  }

  // Longest prefixes first so a theme path isn't half-replaced by a shorter one
  replacements.sort((a, b) => b[0].length - a[0].length);
  const shows: Record<string, AnyObj> = {};
  for (const [id, entry] of Object.entries(manifest.shows)) {
    shows[id] = rewritePaths(JSON.parse(fs.readFileSync(path.join(folder, entry.file), "utf8")), replacements);
  }

  return {
    manifest,
    shows,
    fontsInstalled,
    fontsSkipped: process.platform === "darwin" ? [] : manifest.fonts,
  };
}

// ─── SETUP CHECKUP ────────────────────────────────────────────────────────────

function readJson(file: string): AnyObj {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function installedFontNames(): string[] {
  const dirs =
    process.platform === "darwin"
      ? [path.join(os.homedir(), "Library", "Fonts"), "/Library/Fonts", "/System/Library/Fonts", "/System/Library/Fonts/Supplemental"]
      : process.platform === "win32"
        ? [path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Fonts")]
        : [path.join(os.homedir(), ".fonts"), path.join(os.homedir(), ".local", "share", "fonts"), "/usr/share/fonts"];
  const names: string[] = [];
  for (const dir of dirs) {
    try {
      names.push(...fs.readdirSync(dir).map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, "")));
    } catch {
      // folder missing
    }
  }
  return names;
}

export function checkSetup(apiUp: boolean, esvKeySaved: boolean) {
  const settings = readJson(path.join(appDataDir(), "settings.json"));
  const synced = { ...readJson(path.join(appDataDir(), "settings_synced.json")), ...readJson(path.join(dataDir(), "Config", "settings_synced.json")) };
  const templates = { ...readJson(path.join(appDataDir(), "templates.json")), ...readJson(path.join(dataDir(), "Config", "templates.json")) };
  const issues: string[] = [];
  const ok: string[] = [];

  if (apiUp) ok.push("FreeShow API is on");
  else issues.push("FreeShow isn't answering on its API port — open FreeShow and turn on Settings → Connections → API");

  const outputs = Object.entries<AnyObj>(settings.outputs ?? {}).filter(([, o]) => o.enabled && !o.stageOutput);
  ok.push(`${outputs.length} output(s): ${outputs.map(([, o]) => o.name).join(", ") || "none"}`);
  if (outputs.length > 1) {
    const sameSpot = new Set(outputs.map(([, o]) => JSON.stringify(o.bounds))).size < outputs.length;
    if (sameSpot) issues.push("Two outputs sit in exactly the same place on screen — usually one should be deleted");
  }

  // Video sound: each output window must be routed to an audio channel, and routes must not point at deleted outputs
  const connections: { from: string; to: string }[] = settings.audioRouting?.connections ?? [];
  for (const c of connections) {
    const id = c.from.startsWith("output_win_sub_") ? c.from.slice("output_win_sub_".length) : null;
    if (id && !settings.outputs?.[id]) issues.push(`Audio routing still points at a deleted output (${id}) — fix in Settings → Audio`);
  }
  for (const [id, o] of outputs) {
    if (connections.length && !connections.some((c) => c.from === `output_win_sub_${id}`)) {
      issues.push(`Output "${o.name}" isn't connected in the audio routing, so its video sound won't play — connect it in Settings → Audio`);
    }
  }

  const textTransition = settings.transitionData?.text;
  ok.push(`Slide transition: ${textTransition?.type ?? "fade (default)"}`);

  // Scripture
  const scriptureTemplate = synced.scriptureSettings?.template ?? "scripture";
  if (templates[scriptureTemplate]) ok.push(`Scripture template: ${templates[scriptureTemplate].name}`);
  else if (!/^scripture/.test(scriptureTemplate)) issues.push(`Scripture template "${scriptureTemplate}" doesn't exist`);
  else ok.push("Scripture template: FreeShow default");
  const localBibles = Object.values<AnyObj>(synced.scriptures ?? {}).filter((b) => !b.api && !b.collection);
  if (localBibles.length) ok.push(`Offline Bibles (for Auto Scripture): ${localBibles.map((b) => b.name).join(", ")}`);
  else {
    const files = fs.existsSync(path.join(dataDir(), "Bibles")) ? fs.readdirSync(path.join(dataDir(), "Bibles")).filter((f) => f.endsWith(".fsb")) : [];
    issues.push(
      files.length
        ? `No offline Bible is added in FreeShow yet (found ${files.join(", ")}) — Scripture tab → "+ New scripture" → Local`
        : "No offline Bible — Auto Scripture needs one"
    );
  }
  ok.push(esvKeySaved ? "ESV API key saved" : "No ESV API key (only needed for ESV)");

  // Themes: images present, fonts installed
  const fonts = installedFontNames();
  for (const t of listThemes()) {
    if (!("name" in t) || !t.folder?.startsWith(userThemesDir())) continue;
    const { theme, folder } = loadTheme(t.id);
    const families = new Set<string>();
    const images = new Set<string>();
    const styles = [...Object.values(theme.styles), ...(theme.lowerThird ? [{ text: theme.lowerThird.title, secondary: theme.lowerThird.subtitle }] : [])];
    for (const s of styles as AnyObj[]) {
      for (const part of [s.text, s.secondary, s.tertiary]) if (part?.font) families.add(part.font.split(",")[0].replace(/['"]/g, "").trim());
      if (s.background?.image) images.add(s.background.image);
      if (s.logo?.image) images.add(s.logo.image);
    }
    if (theme.lowerThird?.logo) images.add(theme.lowerThird.logo.image);
    const missingImages = [...images].filter((img) => !fs.existsSync(path.isAbsolute(img) ? img : path.join(folder, img)));
    if (missingImages.length) issues.push(`Theme "${theme.name}" is missing images: ${missingImages.join(", ")}`);
    const missingFonts = [...families].filter((f) => !fonts.some((name) => name.includes(f.toLowerCase().replace(/[^a-z0-9]/g, ""))));
    if (missingFonts.length) issues.push(`Theme "${theme.name}" uses fonts that aren't installed (fallbacks will show): ${missingFonts.join(", ")}`);
    else ok.push(`Theme "${theme.name}": images and fonts present`);
  }

  return { issues, ok };
}
