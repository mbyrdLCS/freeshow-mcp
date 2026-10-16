import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// A theme is a folder containing theme.json plus any images it references.
// Relative image paths in theme.json resolve against that folder, so a theme
// folder can be copied to another computer as-is.

const TextStyle = z.object({
  font: z.string().optional().describe('CSS font-family, e.g. "Montserrat, Arial, sans-serif"'),
  size: z.number().optional().describe("Font size in px on a 1920x1080 slide"),
  color: z.string().optional().describe("Text color, e.g. #F5F1EA"),
  weight: z.union([z.string(), z.number()]).optional().describe('Font weight, e.g. 400, 600, "bold"'),
  transform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  letterSpacing: z.string().optional().describe('e.g. "2px"'),
  lineHeight: z.number().optional().describe("Line height multiplier, e.g. 1.15"),
  shadow: z
    .string()
    .optional()
    .describe('CSS text-shadow, e.g. "2px 2px 8px rgba(0,0,0,0.6)". Use "none" on light backgrounds — FreeShow adds a dark shadow by default.'),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "center", "bottom"]).optional().describe("Vertical position of text inside its box (default center)"),
  box: z
    .object({ top: z.number(), left: z.number(), width: z.number(), height: z.number() })
    .optional()
    .describe("Text box position/size in px on a 1920x1080 slide"),
  boxStyle: z.string().optional().describe('Extra CSS for the text box, e.g. "background-color: rgb(0 0 0 / 0.4);border-radius: 20px;padding: 25px;"'),
});

const Style = z.object({
  description: z.string().optional(),
  background: z
    .object({
      color: z.string().optional().describe("Solid background color"),
      image: z.string().optional().describe("Background image path (absolute, or relative to the theme folder)"),
      layer: z
        .boolean()
        .optional()
        .describe(
          "false (default): the image is embedded in each slide, so it shows in previews and thumbnails. " +
            "true: play it on FreeShow's background layer instead, so it can be swapped for a video at runtime."
        ),
    })
    .optional(),
  text: TextStyle.optional().describe("Style for the main text box (first text item on each slide)"),
  secondary: TextStyle.optional().describe("Style for any additional text boxes (e.g. a subtitle under a heading)"),
  split: z
    .enum(["firstLine", "lastLine"])
    .optional()
    .describe(
      "When a slide has a single text box with several lines, move the first line (e.g. a heading) or " +
        "last line (e.g. a scripture reference) into its own box so it gets the secondary style"
    ),
  logo: z
    .object({
      image: z.string().describe("Logo image path (absolute, or relative to the theme folder)"),
      box: z.object({ top: z.number(), left: z.number(), width: z.number(), height: z.number() }),
      opacity: z.number().min(0).max(1).optional(),
    })
    .optional()
    .describe("Optional logo placed on every slide"),
});

export const ThemeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  defaultStyle: z.string().optional().describe("Style used when none is given (defaults to the first style)"),
  styles: z.record(Style).describe('Named styles, e.g. "lyrics", "scripture", "title", "announcement"'),
});

export type Theme = z.infer<typeof ThemeSchema>;
export type ThemeStyle = z.infer<typeof Style>;
type TextStyleT = z.infer<typeof TextStyle>;

const BUNDLED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "themes");

export function userThemesDir(): string {
  return process.env.FREESHOW_MCP_THEMES_DIR ?? path.join(os.homedir(), "Documents", "FreeShow", "MCP Themes");
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "theme";
}

// User themes win over bundled themes with the same folder name.
function themeFolders(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of [BUNDLED_DIR, userThemesDir()]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "theme.json"))) {
        found.set(entry.name, path.join(dir, entry.name));
      }
    }
  }
  return found;
}

export function listThemes() {
  return [...themeFolders()].map(([id, folder]) => {
    try {
      const t = loadThemeFrom(folder);
      return { id, name: t.name, description: t.description, styles: Object.keys(t.styles), folder };
    } catch (err) {
      return { id, folder, error: String(err) };
    }
  });
}

function loadThemeFrom(folder: string): Theme {
  return ThemeSchema.parse(JSON.parse(fs.readFileSync(path.join(folder, "theme.json"), "utf8")));
}

export function loadTheme(idOrName: string): { theme: Theme; folder: string } {
  const folders = themeFolders();
  let folder = folders.get(idOrName) ?? folders.get(slug(idOrName));
  if (!folder) {
    for (const f of folders.values()) {
      try {
        if (loadThemeFrom(f).name.toLowerCase() === idOrName.toLowerCase()) folder = f;
      } catch {
        // skip unreadable themes
      }
    }
  }
  if (!folder) throw new Error(`Theme "${idOrName}" not found. Available: ${[...folders.keys()].join(", ") || "none"}`);
  return { theme: loadThemeFrom(folder), folder };
}

export function saveTheme(theme: Theme): string {
  const parsed = ThemeSchema.parse(theme);
  const folder = path.join(userThemesDir(), slug(parsed.name));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "theme.json"), JSON.stringify(parsed, null, 2) + "\n", "utf8");
  return folder;
}

export function resolveStyle(theme: Theme, styleName?: string): { name: string; style: ThemeStyle } {
  const name = styleName ?? theme.defaultStyle ?? Object.keys(theme.styles)[0];
  const style = theme.styles[name];
  if (!style) throw new Error(`Theme "${theme.name}" has no style "${name}". Styles: ${Object.keys(theme.styles).join(", ")}`);
  return { name, style };
}

function resolvePath(folder: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(folder, p);
}

// ─── CSS HELPERS ──────────────────────────────────────────────────────────────

function parseCss(css: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of (css ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) map.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  return map;
}

function toCss(map: Map<string, string>): string {
  return [...map].map(([k, v]) => `${k}: ${v};`).join("");
}

function boxCss(box: { top: number; left: number; width: number; height: number }): string {
  return `top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px;`;
}

// Properties a theme owns. They're cleared before applying so nothing leaks from a previous theme;
// anything else on the text (italic, underline, etc.) is kept.
const THEMED_PROPS = ["font-size", "font-family", "color", "font-weight", "text-transform", "letter-spacing", "line-height", "text-shadow"];

function textRunCss(existing: string, t: TextStyleT): string {
  const css = parseCss(existing);
  for (const prop of THEMED_PROPS) css.delete(prop);
  if (t.size !== undefined) css.set("font-size", `${t.size}px`);
  if (t.font) css.set("font-family", t.font);
  if (t.color) css.set("color", t.color);
  if (t.weight !== undefined) css.set("font-weight", String(t.weight));
  if (t.transform) css.set("text-transform", t.transform);
  if (t.letterSpacing) css.set("letter-spacing", t.letterSpacing);
  if (t.lineHeight !== undefined) css.set("line-height", String(t.lineHeight));
  if (t.shadow) css.set("text-shadow", t.shadow);
  return toCss(css);
}

// ─── APPLY ────────────────────────────────────────────────────────────────────

const THEME_ID_PREFIX = "mcp-theme-";
const SPLIT_ID = THEME_ID_PREFIX + "split";

type AnyObj = Record<string, any>;

const VALIGN = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

function styleTextItem(item: AnyObj, t: TextStyleT) {
  item.align = t.valign ? `align-items: ${VALIGN[t.valign]};` : "";
  if (t.box) item.style = boxCss(t.box) + (t.boxStyle ?? "");
  else if (t.boxStyle) item.style = toCss(new Map([...parseCss(item.style), ...parseCss(t.boxStyle)]));
  for (const line of item.lines ?? []) {
    line.align = t.align ? `text-align: ${t.align};` : "";
    for (const run of line.text ?? []) run.style = textRunCss(run.style, t);
  }
}

function isTextItem(item: AnyObj) {
  return (!item.type || item.type === "text") && Array.isArray(item.lines);
}

// Turn one multi-line text box into two. For "firstLine" the heading stays first (main style);
// for "lastLine" the body stays first and the last line becomes the secondary box.
function splitTextItem(slide: AnyObj, mode: "firstLine" | "lastLine") {
  const textItems = slide.items.filter(isTextItem);
  // Already split, but FreeShow dropped our marker when it rewrote the text: re-tag the second box
  if (textItems.length === 2 && !textItems.some((it: AnyObj) => it.id === SPLIT_ID)) textItems[1].id = SPLIT_ID;
  if (textItems.length !== 1) return;
  const item = textItems[0];
  const lines = item.lines.filter((l: AnyObj) => (l.text ?? []).some((t: AnyObj) => String(t.value ?? "").trim()));
  if (lines.length < 2) return;
  const at = mode === "firstLine" ? 1 : lines.length - 1;
  item.lines = lines.slice(0, at);
  const rest = { ...structuredClone(item), id: SPLIT_ID, lines: lines.slice(at) };
  slide.items.splice(slide.items.indexOf(item) + 1, 0, rest);
}

// Undo splitTextItem so a different style starts from the original single text box.
function mergeSplitItems(slide: AnyObj) {
  const items: AnyObj[] = slide.items ?? [];
  for (let i = items.length - 1; i > 0; i--) {
    if (items[i].id !== SPLIT_ID) continue;
    const prev = items.slice(0, i).reverse().find(isTextItem);
    if (!prev) {
      delete items[i].id; // nothing to merge into; keep the text as a normal box
      continue;
    }
    prev.lines = [...(prev.lines ?? []), ...(items[i].lines ?? [])];
    items.splice(i, 1);
  }
}

/**
 * Restyle a FreeShow show object in place using a theme style.
 * Re-applying is safe: anything a previous theme added is replaced, not duplicated.
 * With slideIds, only those slides are restyled (background-layer mode is embedded instead,
 * since the layer is shared by the whole show).
 */
export function applyStyleToShow(show: AnyObj, style: ThemeStyle, folder: string, slideIds?: Set<string>) {
  const whole = !slideIds;
  // FreeShow re-applies a show's template to its slides whenever it loads the show (e.g. after a
  // restart), which would wipe the theme. Clear it, as FreeShow's own "remove template" does.
  show.settings = { ...show.settings, template: null };
  // Remove media added by an earlier whole-show theme application
  show.media ??= {};
  if (whole) for (const key of Object.keys(show.media)) if (key.startsWith(THEME_ID_PREFIX)) delete show.media[key];

  const bgPath = style.background?.image ? resolvePath(folder, style.background.image) : undefined;
  let bgKey: string | undefined;
  if (whole && bgPath && style.background?.layer) {
    bgKey = THEME_ID_PREFIX + "bg";
    show.media[bgKey] = { name: path.basename(bgPath), path: bgPath, type: "image" };
  }

  for (const [id, slide] of Object.entries<AnyObj>(show.slides ?? {})) {
    if (slideIds && !slideIds.has(id)) continue;
    mergeSplitItems(slide);
    slide.items = (slide.items ?? []).filter((it: AnyObj) => !String(it.id ?? "").startsWith(THEME_ID_PREFIX));

    if (style.split) splitTextItem(slide, style.split);

    let textIndex = 0;
    for (const item of slide.items) {
      if (!isTextItem(item)) continue;
      const t = textIndex === 0 ? style.text : style.secondary ?? style.text;
      if (t) styleTextItem(item, t);
      textIndex++;
    }

    if (bgPath && !bgKey) {
      slide.items.unshift({
        id: THEME_ID_PREFIX + "bg",
        type: "media",
        src: bgPath,
        fit: "cover",
        style: "top:0px;left:0px;width:1920px;height:1080px;",
      });
    }

    if (style.logo) {
      const opacity = style.logo.opacity !== undefined ? `opacity:${style.logo.opacity};` : "";
      slide.items.push({
        id: THEME_ID_PREFIX + "logo",
        type: "media",
        src: resolvePath(folder, style.logo.image),
        fit: "contain",
        style: boxCss(style.logo.box) + opacity,
      });
    }

    slide.settings ??= {};
    delete slide.settings.template; // a slide template would override the theme
    if (style.background?.color) slide.settings.color = style.background.color;
    else delete slide.settings.color;
  }

  if (!whole) return show;

  for (const layout of Object.values<AnyObj>(show.layouts ?? {})) {
    // FreeShow carries a layout background forward to later slides, so the first slide is enough
    (layout.slides ?? []).forEach((ref: AnyObj, i: number) => {
      if (bgKey && i === 0) ref.background = bgKey;
      else if (String(ref.background ?? "").startsWith(THEME_ID_PREFIX)) delete ref.background;
    });
  }

  return show;
}
