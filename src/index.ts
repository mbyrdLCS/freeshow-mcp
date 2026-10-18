#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { callAction } from "./freeshow.js";
import { searchSongs, fetchLyrics } from "./lyrics.js";
import { TRANSLATIONS, fetchPassage, splitLongText } from "./scripture.js";
import { deleteShows, readOverlays, withFreeShowClosed, writeOverlays } from "./deleteShows.js";
import { ThemeSchema, applyStyleToShow, buildLowerThird, listThemes, loadTheme, resolveStyle, saveTheme, userThemesDir } from "./themes.js";

const server = new McpServer({
  name: "freeshow-mcp",
  version: "0.8.0",
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function action(name: string, data?: Record<string, unknown>) {
  const result = await callAction(name, data);
  return ok(result ?? { success: true });
}

// ─── SLIDES ───────────────────────────────────────────────────────────────────

server.tool("next_slide", "Go to the next slide", {}, async () => action("next_slide"));
server.tool("previous_slide", "Go to the previous slide", {}, async () => action("previous_slide"));
server.tool("random_slide", "Jump to a random slide", {}, async () => action("random_slide"));

server.tool(
  "select_slide_by_index",
  "Select a slide by its position in the current layout",
  {
    index: z.number().int().min(1).describe("Slide number, starting at 1"),
    showId: z.string().optional().describe("Show ID (defaults to active show)"),
    layoutId: z.string().optional().describe("Layout ID (defaults to active layout)"),
  },
  async ({ index, showId, layoutId }) => action("index_select_slide", { index, showId, layoutId })
);

server.tool(
  "select_slide_by_name",
  "Jump to a slide by its text/name",
  { value: z.string().describe("Slide name or text to match") },
  async ({ value }) => action("name_select_slide", { value })
);

// ─── SHOWS ────────────────────────────────────────────────────────────────────

server.tool(
  "select_show_by_name",
  "Select a show by name and start presenting it",
  { value: z.string().describe("Show name") },
  async ({ value }) => action("name_select_show", { value })
);

server.tool(
  "start_show",
  "Start presenting a show by its ID",
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("start_show", { id })
);

server.tool(
  "select_show_by_id",
  "Open a show in FreeShow by its ID (without presenting it)",
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("id_select_show", { id })
);

server.tool("get_shows", "Get list of all available shows", {}, async () => action("get_shows"));

server.tool(
  "get_show",
  "Get details of a specific show",
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("get_show", { id })
);

server.tool(
  "get_output_slide_text",
  "Get the text content of the currently displayed slide",
  {},
  async () => action("get_output_slide_text")
);

server.tool(
  "get_output_group_name",
  "Get the group name (e.g. Verse, Chorus) of the currently displayed slide",
  {},
  async () => action("get_output_group_name")
);

server.tool(
  "get_plain_text",
  'Get a show\'s full content as plain text, with "[Group]" section labels and blank lines between slides. Ideal for reading or preparing an edit.',
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("get_plain_text", { id })
);

server.tool(
  "set_plain_text",
  "Replace a show's entire content from plain text. Same format as get_plain_text / create_show: " +
    'blank line between slides, optional "[Verse 1]", "[Chorus]" etc. labels to group slides. ' +
    "Use get_plain_text first, modify, then set — this overwrites all existing slides. " +
    "If the show has a theme applied, it is re-applied automatically.",
  {
    id: z.string().describe("Show ID"),
    value: z.string().describe("New plain-text content for the whole show"),
  },
  async ({ id, value }) => {
    const before = await getShowData(id);
    const remembered = before.settings?.mcpTheme as RememberedTheme | undefined;
    const hasImages = Object.keys(before.settings?.mcpImages ?? {}).length > 0;
    await callAction("set_plain_text", { id, value });
    if (!remembered?.theme && !hasImages) return ok({ success: true });
    // FreeShow applies the text a moment after the call returns. Re-styling before it lands lets
    // FreeShow's write pour all the text into the first box, so wait until the show stops changing.
    const original = JSON.stringify(before.slides);
    let last = original;
    let changed = false;
    for (let stable = 0, i = 0; i < 40 && !(changed && stable >= 2); i++) {
      await sleep(150);
      const now = JSON.stringify((await getShowData(id)).slides);
      if (now !== original) changed = true;
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    if (remembered?.theme) return ok({ success: true, themed: await reapplyTheme(id, remembered) });
    const show = await getShowData(id);
    placeImages(show);
    await callAction("set_show", { id, value: JSON.stringify(show) });
    return ok({ success: true });
  }
);

server.tool(
  "get_groups",
  "Get a show's slide groups (Verse, Chorus, etc.) with their content",
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("get_groups", { id })
);

server.tool(
  "select_group_by_id",
  "Jump the presentation to a slide group by its group ID (e.g. straight to the chorus)",
  { id: z.string().describe("Group ID (from get_groups)") },
  async ({ id }) => action("id_select_group", { id })
);

server.tool(
  "get_show_layout",
  "Get the slide layout (order of slides) of a show",
  { id: z.string().describe("Show ID") },
  async ({ id }) => action("get_show_layout", { id })
);

server.tool(
  "change_layout",
  "Switch a show to a different layout",
  {
    showId: z.string().describe("Show ID"),
    layoutId: z.string().describe("Layout ID"),
  },
  async ({ showId, layoutId }) => action("change_layout", { showId, layoutId })
);

server.tool(
  "set_template",
  "Apply a template (styling) to the active show",
  { id: z.string().describe("Template ID") },
  async ({ id }) => action("set_template", { id })
);

server.tool(
  "set_show",
  "Advanced: replace a show's full data (slides, layouts, media, settings). Read it with get_show, change it, " +
    "and send the whole object back. Prefer set_plain_text for text and apply_theme for styling.",
  {
    id: z.string().describe("Show ID"),
    show: z.record(z.unknown()).describe("Complete show object, as returned in get_show's data"),
  },
  async ({ id, show }) => action("set_show", { id, value: JSON.stringify(show) })
);

server.tool(
  "set_slide_timers",
  "Make a show advance automatically (e.g. a looping announcements slideshow before service). " +
    "Sets the same timer on every slide of the active layout; seconds = 0 removes the timers.",
  {
    showId: z.string().describe("Show ID"),
    seconds: z.number().min(0).describe("Seconds each slide stays up (0 = remove timers)"),
    loop: z.boolean().optional().describe("Go back to the first slide after the last one (default true)"),
  },
  async ({ showId, seconds, loop }) => {
    const show = await getShowData(showId);
    const slides: Record<string, any>[] = show.layouts?.[show.settings?.activeLayout]?.slides ?? [];
    slides.forEach((ref, i) => {
      if (seconds > 0) ref.nextTimer = seconds;
      else delete ref.nextTimer;
      if (seconds > 0 && (loop ?? true) && i === slides.length - 1) ref.end = true;
      else delete ref.end;
    });
    await callAction("set_show", { id: showId, value: JSON.stringify(show) });
    return ok({ showId, slides: slides.length, seconds, loop: seconds > 0 && (loop ?? true) });
  }
);

server.tool(
  "disable_slide",
  "Hide or unhide a slide in a show's layout (hidden slides are skipped when presenting)",
  {
    index: z.number().int().min(1).describe("Slide number in the layout, starting at 1"),
    showId: z.string().optional().describe("Show ID (defaults to active show)"),
    layoutId: z.string().optional().describe("Layout ID (defaults to active layout)"),
    value: z.boolean().optional().describe("true = hide, false = show, omit = toggle"),
  },
  async ({ index, showId, layoutId, value }) => action("disable_slide", { index, showId, layoutId, value })
);

// ─── PROJECTS ─────────────────────────────────────────────────────────────────

server.tool("get_projects", "Get list of all projects", {}, async () => action("get_projects"));

server.tool(
  "select_project_by_name",
  "Select a project by name",
  { value: z.string().describe("Project name") },
  async ({ value }) => action("name_select_project", { value })
);

server.tool(
  "select_project_by_id",
  "Open a project by its ID",
  { id: z.string().describe("Project ID") },
  async ({ id }) => action("id_select_project", { id })
);

server.tool(
  "start_project_item_by_name",
  "Start presenting the item in the active project whose name matches",
  { value: z.string().describe("Item (show) name") },
  async ({ value }) => action("name_start_project_item", { value })
);

server.tool("next_project_item", "Move to the next item in the project", {}, async () => action("next_project_item"));
server.tool("previous_project_item", "Move to the previous item in the project", {}, async () => action("previous_project_item"));

server.tool(
  "select_project_item_by_index",
  "Select a project item by its position",
  { index: z.number().int().min(1).describe("Item number in the project, starting at 1") },
  async ({ index }) => action("index_select_project_item", { index })
);

server.tool(
  "get_project",
  "Get details of a specific project",
  { id: z.string().describe("Project ID") },
  async ({ id }) => action("get_project", { id })
);

server.tool(
  "create_project",
  "Create a new project (e.g. a service plan to hold shows in order)",
  { name: z.string().describe("Project name") },
  async ({ name }) => action("create_project", { name })
);

server.tool(
  "add_to_project",
  "Add a show to a project",
  {
    projectId: z.string().describe("Project ID"),
    id: z.string().describe("Show ID to add"),
  },
  async ({ projectId, id }) => action("add_to_project", { projectId, id })
);

server.tool(
  "rename_project",
  "Rename a project",
  {
    id: z.string().describe("Project ID"),
    name: z.string().describe("New project name"),
  },
  async ({ id, name }) => action("rename_project", { id, name })
);

server.tool(
  "remove_project_item",
  "Remove an item from a project by its position",
  {
    id: z.string().describe("Project ID"),
    index: z.number().int().min(1).describe("Item number to remove, starting at 1"),
  },
  async ({ id, index }) => action("remove_project_item", { id, index })
);

server.tool(
  "delete_project",
  "Delete a project (the shows in it are not deleted)",
  { id: z.string().describe("Project ID") },
  async ({ id }) => action("delete_project", { id })
);

// ─── CLEAR / OUTPUT ───────────────────────────────────────────────────────────

server.tool("clear_all", "Clear all outputs (slide, background, audio, overlays)", {}, async () => action("clear_all"));
server.tool("clear_slide", "Clear only the slide output", {}, async () => action("clear_slide"));
server.tool("clear_background", "Clear only the background", {}, async () => action("clear_background"));
server.tool("clear_audio", "Clear all playing audio", {}, async () => action("clear_audio"));
server.tool("clear_overlays", "Clear all overlays", {}, async () => action("clear_overlays"));

server.tool(
  "lock_output",
  "Lock or unlock the output (freeze current slide)",
  {
    value: z.boolean().optional().describe("true = lock, false = unlock, omit = toggle"),
    outputId: z.string().optional().describe("Specific output ID"),
  },
  async ({ value, outputId }) => action("lock_output", { value, outputId })
);

server.tool(
  "get_output",
  "Get current output state",
  { id: z.string().optional().describe("Output ID (omit for default)") },
  async ({ id }) => action("get_output", { id })
);

server.tool(
  "get_cleared",
  "Get which output layers (slide, background, audio, overlays) are currently cleared",
  {},
  async () => action("get_cleared")
);

server.tool(
  "toggle_output_windows",
  "Show or hide all output windows (the projector/screen outputs)",
  { value: z.boolean().optional().describe("true = show, false = hide, omit = toggle") },
  async ({ value }) => action("toggle_output_windows", { value })
);

server.tool(
  "toggle_output",
  "Turn a specific output on or off",
  {
    id: z.string().describe("Output ID"),
    value: z.boolean().optional().describe("true = on, false = off, omit = toggle"),
  },
  async ({ id, value }) => action("toggle_output", { id, value })
);

server.tool(
  "change_transition",
  "Change the transition used between slides (text) or backgrounds (media)",
  {
    id: z.enum(["text", "media"]).optional().describe('What to change (default "text")'),
    type: z.string().optional().describe('Transition type, e.g. "fade", "blur", "scale", "spin", "none" (default "fade")'),
    duration: z.number().optional().describe("Duration in ms (default 500)"),
    easing: z.string().optional().describe('Easing, e.g. "sine", "linear" (default "sine")'),
  },
  async ({ id, type, duration, easing }) => action("change_transition", { id, type, duration, easing })
);

// ─── AUDIO ────────────────────────────────────────────────────────────────────

server.tool(
  "play_audio",
  "Play an audio file",
  {
    path: z.string().describe("File path to audio"),
    index: z.number().optional().describe("Track index"),
  },
  async ({ path, index }) => action("play_audio", { path, index })
);

server.tool(
  "stop_audio",
  "Stop an audio file",
  { path: z.string().describe("File path of audio to stop") },
  async ({ path }) => action("stop_audio", { path })
);

server.tool(
  "pause_audio",
  "Pause (or resume) an audio file",
  { path: z.string().describe("File path of the audio") },
  async ({ path }) => action("pause_audio", { path })
);

server.tool(
  "mute",
  "Mute or unmute audio output",
  {
    id: z.string().optional().describe("Audio channel ID (omit for main)"),
    value: z.boolean().optional().describe("true = mute, false = unmute, omit = toggle"),
  },
  async ({ id, value }) => action("mute", { id, value })
);

server.tool(
  "change_volume",
  "Change master volume (0–100)",
  { volume: z.number().min(0).max(100).describe("Volume level 0-100") },
  async ({ volume }) => action("change_volume", { volume })
);

server.tool(
  "start_playlist",
  "Start a playlist by ID",
  { id: z.string().describe("Playlist ID") },
  async ({ id }) => action("start_playlist", { id })
);

server.tool(
  "start_playlist_by_name",
  "Start a playlist by name",
  { value: z.string().describe("Playlist name") },
  async ({ value }) => action("name_start_playlist", { value })
);

server.tool("playlist_next", "Skip to next track in playlist", {}, async () => action("playlist_next"));
server.tool("get_playlists", "Get all playlists", {}, async () => action("get_playlists"));

// ─── MEDIA ────────────────────────────────────────────────────────────────────

server.tool(
  "play_media",
  "Play a media file (video/image) as background",
  {
    path: z.string().describe("File path to media"),
    index: z.number().optional().describe("Media index"),
  },
  async ({ path, index }) => action("play_media", { path, index })
);

server.tool("toggle_playing_media", "Toggle play/pause of current media", {}, async () => action("toggle_playing_media"));

server.tool(
  "get_playing_video_time",
  "Get current playback time of playing video in seconds",
  {},
  async () => action("get_playing_video_time")
);

server.tool(
  "get_playing_video_duration",
  "Get total duration of playing video in seconds",
  {},
  async () => action("get_playing_video_duration")
);

server.tool(
  "video_seek_to",
  "Jump the playing video to a time",
  { seconds: z.number().min(0).describe("Time in seconds") },
  async ({ seconds }) => action("video_seekto", { seconds })
);

server.tool("toggle_media_loop", "Toggle looping of the playing video", {}, async () => action("toggle_media_loop"));
server.tool("toggle_media_mute", "Toggle mute of the playing video", {}, async () => action("toggle_media_mute"));

// ─── TIMERS ───────────────────────────────────────────────────────────────────

server.tool("get_timers", "Get all timers", {}, async () => action("get_timers"));
server.tool("pause_timers", "Pause all running timers", {}, async () => action("pause_timers"));
server.tool("stop_timers", "Stop all timers", {}, async () => action("stop_timers"));

server.tool(
  "start_timer_by_name",
  "Start a timer by name",
  { value: z.string().describe("Timer name") },
  async ({ value }) => action("name_start_timer", { value })
);

server.tool(
  "start_timer_by_id",
  "Start a timer by ID",
  { id: z.string().describe("Timer ID") },
  async ({ id }) => action("id_start_timer", { id })
);

server.tool(
  "stop_timer_by_id",
  "Stop a specific timer",
  { id: z.string().describe("Timer ID") },
  async ({ id }) => action("id_stop_timer", { id })
);

server.tool(
  "edit_timer",
  "Edit a timer property",
  {
    id: z.string().describe("Timer ID"),
    key: z.string().describe("Property key to edit"),
    value: z.unknown().describe("New value"),
  },
  async ({ id, key, value }) => action("edit_timer", { id, key, value })
);

// ─── SCRIPTURE ────────────────────────────────────────────────────────────────

server.tool(
  "start_scripture",
  "Display a scripture reference",
  {
    reference: z.string().describe('Scripture reference e.g. "John 3:16"'),
    id: z.string().optional().describe("Bible translation ID"),
  },
  async ({ reference, id }) => action("start_scripture", { reference, id })
);

server.tool("scripture_next", "Next verse/passage in current scripture", {}, async () => action("scripture_next"));
server.tool("scripture_previous", "Previous verse/passage in current scripture", {}, async () => action("scripture_previous"));

// ─── VARIABLES ────────────────────────────────────────────────────────────────

server.tool("get_variables", "Get all variables defined in FreeShow", {}, async () => action("get_variables"));

server.tool(
  "get_variable",
  "Get a single variable by ID or name",
  {
    id: z.string().optional().describe("Variable ID"),
    name: z.string().optional().describe("Variable name"),
  },
  async ({ id, name }) => action("get_variable", { id, name })
);

server.tool(
  "change_variable",
  "Change a variable value",
  {
    name: z.string().optional().describe("Variable name"),
    id: z.string().optional().describe("Variable ID"),
    value: z.unknown().optional().describe("New value"),
    variableAction: z.string().optional().describe("Action: increment, decrement, toggle, etc."),
  },
  async ({ name, id, value, variableAction }) =>
    action("change_variable", { name, id, value, variableAction })
);

// ─── ACTIONS / TRIGGERS ───────────────────────────────────────────────────────

server.tool(
  "run_action_by_name",
  "Run a FreeShow action by name",
  { value: z.string().describe("Action name") },
  async ({ value }) => action("name_run_action", { value })
);

server.tool(
  "run_action_by_id",
  "Run a FreeShow action by ID",
  { id: z.string().describe("Action ID") },
  async ({ id }) => action("run_action", { id })
);

server.tool(
  "start_trigger",
  "Fire a FreeShow trigger by ID",
  { id: z.string().describe("Trigger ID") },
  async ({ id }) => action("start_trigger", { id })
);

server.tool("get_actions", "List the actions set up in FreeShow (to run with run_action_by_id/name)", {}, async () =>
  action("get_actions")
);

server.tool(
  "toggle_action",
  "Enable or disable a FreeShow action's automatic trigger",
  {
    id: z.string().describe("Action ID"),
    value: z.boolean().optional().describe("true = enable, false = disable, omit = toggle"),
  },
  async ({ id, value }) => action("toggle_action", { id, value })
);

// ─── OVERLAYS ─────────────────────────────────────────────────────────────────

server.tool(
  "select_overlay_by_name",
  "Enable an overlay by name",
  { value: z.string().describe("Overlay name") },
  async ({ value }) => action("name_select_overlay", { value })
);

server.tool(
  "select_overlay_by_id",
  "Enable an overlay by ID",
  { id: z.string().describe("Overlay ID") },
  async ({ id }) => action("id_select_overlay", { id })
);

server.tool(
  "clear_overlay",
  "Clear a specific overlay by ID",
  { id: z.string().describe("Overlay ID") },
  async ({ id }) => action("clear_overlay", { id })
);

// ─── CREATE ───────────────────────────────────────────────────────────────────

const themeParams = {
  theme: z.string().optional().describe("Theme to style the new show with (see list_themes)"),
  style: z.string().optional().describe('Style within the theme, e.g. "lyrics", "announcement" (defaults to the theme\'s default style)'),
};

async function getShowList(): Promise<Record<string, { name?: string }>> {
  const res = (await callAction("get_shows")) as { data?: Record<string, { name?: string }> } | null;
  return res?.data ?? {};
}

async function getShowData(id: string): Promise<Record<string, any>> {
  const res = (await callAction("get_show", { id })) as { data?: Record<string, any> } | null;
  if (!res?.data) throw new Error(`Show ${id} not found`);
  return res.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Without "[Label]" lines FreeShow guesses song parts (Verse, Chorus, Bridge...) for every slide.
// For non-song shows, name each slide after its first line instead.
function labelSlides(text: string): string {
  const slides = text.split(/\n\s*\n/);
  if (slides.some((slide) => /^\s*\[[^\]]+\]\s*$/m.test(slide))) return text;
  return slides
    .map((slide) => {
      const first = slide.trim().split("\n")[0].trim();
      const label = first.length > 30 ? first.slice(0, 30).trimEnd() + "…" : first;
      return label ? `[${label.replace(/[[\]]/g, "")}]\n${slide.trim()}` : slide;
    })
    .join("\n\n");
}

// Images (add_image) and QR codes (add_qr_code), remembered by layout position so they survive text rewrites
type RememberedImage = {
  name: string;
  box: { top: number; left: number; width: number; height: number };
  src?: string;
  fit?: string;
  qr?: { text: string; color: string; background: string }; // FreeShow's built-in QR Code element
};
const IMAGE_ID_PREFIX = "mcp-image-";

function placeImages(show: Record<string, any>) {
  const images = (show.settings?.mcpImages ?? {}) as Record<string, RememberedImage[]>;
  for (const slide of Object.values<any>(show.slides ?? {})) {
    slide.items = (slide.items ?? []).filter((it: any) => !String(it.id ?? "").startsWith(IMAGE_ID_PREFIX));
  }
  const refs: { id: string }[] = show.layouts?.[show.settings?.activeLayout]?.slides ?? [];
  for (const [pos, list] of Object.entries(images)) {
    const slide = show.slides?.[refs[Number(pos) - 1]?.id ?? ""];
    if (!slide) continue;
    for (const img of list) {
      const { top, left, width, height } = img.box;
      const style = `top:${top}px;left:${left}px;width:${width}px;height:${height}px;`;
      const id = IMAGE_ID_PREFIX + img.name;
      if (img.qr) slide.items.push({ id, type: "qr_code", qr_code: img.qr, style });
      else slide.items.push({ id, type: "media", src: img.src, fit: img.fit, style });
    }
  }
}

// FreeShow's create_show doesn't return the new ID, so find it by diffing the show list.
async function createShowAndGetId(data: { text: string; name?: string; category?: string }): Promise<string | undefined> {
  const before = new Set(Object.keys(await getShowList()));
  await callAction("create_show", data);
  for (let i = 0; i < 20; i++) {
    const after = await getShowList();
    const added = Object.keys(after).filter((id) => !before.has(id));
    if (added.length) return added.find((id) => after[id]?.name === data.name) ?? added[0];
    await sleep(150);
  }
  return undefined;
}

// slideStyles maps 1-based layout positions to style names. Positions (not slide IDs) are stored
// because FreeShow gives slides new IDs whenever it rewrites a show's text.
type RememberedTheme = { theme: string; style: string; slideStyles?: Record<string, string> };

// Parent slide IDs at the given 1-based layout positions, plus their child slides
function slideIdsAt(show: Record<string, any>, positions: number[]): Set<string> {
  const refs: { id: string }[] = show.layouts?.[show.settings?.activeLayout]?.slides ?? [];
  const ids = new Set<string>();
  for (const n of positions) {
    const ref = refs[n - 1];
    if (!ref) throw new Error(`Slide ${n} doesn't exist (the layout has ${refs.length} slides)`);
    ids.add(ref.id);
    for (const child of show.slides?.[ref.id]?.children ?? []) ids.add(child);
  }
  return ids;
}

async function applyTheme(showId: string, themeName: string, styleName?: string, slides?: number[]) {
  const { theme, folder } = loadTheme(themeName);
  const { name, style } = resolveStyle(theme, styleName);
  const show = await getShowData(showId);
  const prev = show.settings?.mcpTheme as RememberedTheme | undefined;
  let remembered: RememberedTheme;

  if (slides?.length) {
    const ids = slideIdsAt(show, slides);
    applyStyleToShow(show, style, folder, ids);
    const slideStyles = { ...(prev?.theme === theme.name ? prev.slideStyles : {}) };
    for (const n of slides) slideStyles[n] = name;
    remembered = { theme: theme.name, style: prev?.theme === theme.name ? prev.style : name, slideStyles };
  } else {
    applyStyleToShow(show, style, folder);
    remembered = { theme: theme.name, style: name };
  }

  // Remember the look so it can be re-applied after FreeShow rewrites the text
  show.settings = { ...show.settings, mcpTheme: remembered };
  await callAction("set_show", { id: showId, value: JSON.stringify(show) });
  return { theme: theme.name, style: name, ...(slides?.length && { slides }) };
}

// Re-apply a remembered theme: the show-wide style, then any per-slide styles whose slides still exist
async function reapplyTheme(showId: string, remembered: RememberedTheme) {
  const { theme, folder } = loadTheme(remembered.theme);
  const show = await getShowData(showId);
  applyStyleToShow(show, resolveStyle(theme, remembered.style).style, folder);
  const slideCount = show.layouts?.[show.settings?.activeLayout]?.slides?.length ?? 0;
  const slideStyles: Record<string, string> = {};
  for (const [pos, styleName] of Object.entries(remembered.slideStyles ?? {})) {
    if (Number(pos) > slideCount || !theme.styles[styleName]) continue;
    applyStyleToShow(show, theme.styles[styleName], folder, slideIdsAt(show, [Number(pos)]));
    slideStyles[pos] = styleName;
  }
  show.settings = { ...show.settings, mcpTheme: { ...remembered, slideStyles } };
  placeImages(show);
  await callAction("set_show", { id: showId, value: JSON.stringify(show) });
  return { theme: remembered.theme, style: remembered.style };
}

server.tool(
  "create_show",
  "Create a new show from text and return its ID. FreeShow also adds it to the currently open project. " +
    "Separate slides with a BLANK LINE (double newline). " +
    'For non-song shows without labels, each slide is named after its first line (FreeShow would otherwise guess "Verse", "Chorus"…). ' +
    'Optionally start a slide with a section label in brackets — e.g. "[Verse 1]", "[Chorus]", ' +
    '"[Bridge]" — to create named, color-coded slide groups (great for songs). ' +
    "Pass theme (and optionally style) to brand it in one step.",
  {
    text: z
      .string()
      .describe(
        'Slide text. Blank line between slides. Optional "[Section]" label as the first line of a slide, e.g. "[Verse 1]\\nAmazing grace...\\n\\n[Chorus]\\nMy chains are gone..."'
      ),
    name: z.string().optional().describe("Show name"),
    category: z.string().optional().describe('Category name, e.g. "song" or "presentation"'),
    ...themeParams,
  },
  async ({ text, name, category, theme, style }) => {
    const isSong = (category ?? "").toLowerCase() === "song";
    const id = await createShowAndGetId({ text: isSong ? text : labelSlides(text), name, category });
    if (!id) return ok({ created: name, warning: "Show was sent to FreeShow but its ID could not be confirmed" });
    const themed = theme ? await applyTheme(id, theme, style) : undefined;
    return ok({ created: name, id, ...(themed && { themed }) });
  }
);

server.tool(
  "delete_shows",
  "Delete shows. FreeShow's API can't delete shows, so this saves and CLOSES FreeShow, removes the shows, " +
    "and reopens it (about 10–20 seconds). Never use during a service. Only works when FreeShow runs on this " +
    "computer. Deleted files are moved to an 'MCP Deleted Shows' folder in FreeShow's data folder so they can be recovered. " +
    "Ask the user before calling this.",
  {
    ids: z.array(z.string()).optional().describe("Show IDs to delete (from get_shows)"),
    names: z.array(z.string()).optional().describe("Exact show names to delete"),
    confirm: z.literal(true).describe("Must be true — confirms FreeShow may be restarted"),
  },
  async ({ ids, names }) => {
    const shows = await getShowList();
    const targets = new Set(ids ?? []);
    const unknown = [...targets].filter((id) => !shows[id]);
    for (const name of names ?? []) {
      const matches = Object.keys(shows).filter((id) => shows[id].name?.toLowerCase() === name.toLowerCase());
      if (matches.length) matches.forEach((id) => targets.add(id));
      else unknown.push(name);
    }
    if (unknown.length) return ok({ error: `Not found: ${unknown.join(", ")}. Nothing was deleted.` });
    if (!targets.size) return ok({ error: "No shows given. Nothing was deleted." });
    return ok(await deleteShows([...targets]));
  }
);

async function rememberSlideExtra(showId: string, slide: number, extra: RememberedImage) {
  const show = await getShowData(showId);
  const count = show.layouts?.[show.settings?.activeLayout]?.slides?.length ?? 0;
  if (slide > count) throw new Error(`Slide ${slide} doesn't exist (the layout has ${count} slides)`);
  const images = { ...(show.settings?.mcpImages ?? {}) } as Record<string, RememberedImage[]>;
  images[slide] = [...(images[slide] ?? []).filter((img) => img.name !== extra.name), extra];
  show.settings = { ...show.settings, mcpImages: images };
  placeImages(show);
  await callAction("set_show", { id: showId, value: JSON.stringify(show) });
}

const slugName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const boxParams = {
  top: z.number().describe("Top edge, px"),
  left: z.number().describe("Left edge, px"),
  width: z.number().describe("Width, px"),
  height: z.number().describe("Height, px"),
};

server.tool(
  "add_image",
  "Place an image (photo, logo) on a slide of a show. Positions are in px on a 1920x1080 slide. " +
    "Re-using a name replaces that image. The image is remembered, so it stays put through text edits and theme changes. " +
    "For QR codes use add_qr_code (FreeShow's built-in QR element).",
  {
    showId: z.string().describe("Show ID"),
    slide: z.number().int().min(1).describe("Slide number in the layout, starting at 1"),
    path: z.string().describe("Absolute path to the image file"),
    name: z.string().optional().describe('Name for this image, e.g. "logo" (defaults to the file name)'),
    ...boxParams,
    fit: z.enum(["contain", "cover", "fill"]).optional().describe('How the image fills its box (default "contain")'),
  },
  async ({ showId, slide, path: src, name, top, left, width, height, fit }) => {
    if (!fs.existsSync(src)) return ok({ error: `File not found: ${src}` });
    const imageName = slugName(name ?? path.basename(src, path.extname(src)));
    await rememberSlideExtra(showId, slide, { name: imageName, src, fit: fit ?? "contain", box: { top, left, width, height } });
    return ok({ showId, slide, image: imageName });
  }
);

server.tool(
  "add_qr_code",
  "Put a QR code on a slide using FreeShow's built-in QR Code element (generated live by FreeShow, no image file). " +
    "For web links it checks the site responds (an error page blocks it; many sites answer even for wrong paths, so still scan it with a phone). " +
    "Positions are in px on a 1920x1080 slide; keep width = height. " +
    "Re-using a name replaces that code; it stays put through text edits and theme changes.",
  {
    showId: z.string().describe("Show ID"),
    slide: z.number().int().min(1).describe("Slide number in the layout, starting at 1"),
    text: z.string().describe("What the code opens — usually a URL like https://example.org/forms/abc"),
    name: z.string().optional().describe('Name for this code (default "qr")'),
    ...boxParams,
    color: z.string().optional().describe("Code color (default #000000 — dark on light scans best)"),
    background: z.string().optional().describe('Background color (default #FFFFFF; "" for transparent)'),
  },
  async ({ showId, slide, text, name, top, left, width, height, color, background }) => {
    let linkCheck: string | undefined;
    if (/^https?:\/\//i.test(text)) {
      try {
        const res = await fetch(text, { redirect: "follow", signal: AbortSignal.timeout(10000) });
        if (!res.ok) return ok({ error: `The link returned HTTP ${res.status} — check it before putting it on screen: ${text}` });
        linkCheck = `site responded (HTTP ${res.status}) — scan it with a phone to confirm it opens the right page`;
      } catch (err) {
        linkCheck = `could not be checked (${(err as Error).message}) — scan it with a phone to confirm`;
      }
    }
    const qrName = slugName(name ?? "qr");
    await rememberSlideExtra(showId, slide, {
      name: qrName,
      qr: { text, color: color ?? "#000000", background: background ?? "#FFFFFF" },
      box: { top, left, width, height },
    });
    return ok({ showId, slide, qrCode: qrName, text, ...(linkCheck && { link: linkCheck }) });
  }
);

server.tool(
  "remove_image",
  "Remove an image or QR code added with add_image / add_qr_code",
  {
    showId: z.string().describe("Show ID"),
    slide: z.number().int().min(1).describe("Slide number, starting at 1"),
    name: z.string().describe("Name (as returned by add_image / add_qr_code)"),
  },
  async ({ showId, slide, name }) => {
    const show = await getShowData(showId);
    const images = { ...(show.settings?.mcpImages ?? {}) } as Record<string, RememberedImage[]>;
    const before = images[slide]?.length ?? 0;
    images[slide] = (images[slide] ?? []).filter((img) => img.name !== name);
    if (images[slide].length === before) return ok({ error: `No image "${name}" on slide ${slide}` });
    if (!images[slide].length) delete images[slide];
    show.settings = { ...show.settings, mcpImages: images };
    placeImages(show);
    await callAction("set_show", { id: showId, value: JSON.stringify(show) });
    return ok({ removed: name, slide });
  }
);

server.tool(
  "list_overlays",
  "List FreeShow's overlays (lower thirds, logos, clocks…) with their IDs, for select_overlay_by_id / clear_overlay",
  {},
  async () => ok(Object.entries(readOverlays()).map(([id, o]) => ({ id, name: o.name, category: o.category })))
);

server.tool(
  "create_lower_thirds",
  "Create branded lower-third overlays (name tags, scripture references, banners) from a theme's lowerThird design. " +
    "FreeShow's API can't create overlays, so this saves and CLOSES FreeShow, adds them, and reopens it (~10–20 s) — " +
    "batch several in one call, never use during a service, and ask the user first. Same title+subtitle replaces the existing one. " +
    "Show them with select_overlay_by_id and hide with clear_overlay.",
  {
    theme: z.string().describe("Theme with a lowerThird design (see list_themes)"),
    items: z
      .array(
        z.object({
          title: z.string().describe('Main line, e.g. "Evan Strickland" or "Ephesians 6:10–18"'),
          subtitle: z.string().optional().describe('Second line, e.g. "Evangelist" (omit for a one-line banner)'),
          duration: z.number().optional().describe("Seconds before it hides itself (0 = stays until cleared; default from theme)"),
        })
      )
      .min(1),
    confirm: z.literal(true).describe("Must be true — confirms FreeShow may be restarted"),
  },
  async ({ theme: themeName, items }) => {
    const { theme, folder } = loadTheme(themeName);
    const overlays: Record<string, ReturnType<typeof buildLowerThird>> = {};
    for (const item of items) {
      const overlay = buildLowerThird(theme, folder, item.title, item.subtitle, item.duration);
      overlays["mcp-lt-" + slugName(overlay.name)] = overlay;
    }
    const restart = await withFreeShowClosed("create_lower_thirds", () => writeOverlays(overlays));
    return ok({
      created: Object.entries(overlays).map(([id, o]) => ({ id, name: o.name })),
      freeShowRestarted: restart.freeShowRestarted,
      ...(restart.warning && { warning: restart.warning }),
    });
  }
);

server.tool(
  "apply_theme_to_project",
  "Restyle every show in a project at once — e.g. switch all of a service's songs between a branded and a plain lyrics style. " +
    "By default only shows in the \"song\" category are changed, so announcements and other slides keep their look.",
  {
    projectId: z.string().describe("Project ID (see get_projects)"),
    theme: z.string().describe("Theme id or name"),
    style: z.string().describe('Style to apply, e.g. "lyrics" or "lyrics-plain"'),
    category: z.string().optional().describe('Only restyle shows in this category (default "song"; "*" for every show)'),
  },
  async ({ projectId, theme, style, category }) => {
    const project = (await callAction("get_project", { id: projectId })) as { data?: { shows?: { id: string }[] } } | null;
    const items = project?.data?.shows;
    if (!items) return ok({ error: `Project ${projectId} not found` });
    const shows = await getShowList();
    const want = (category ?? "song").toLowerCase();
    const changed: string[] = [];
    const skipped: string[] = [];
    for (const { id } of items) {
      const info = shows[id] as { name?: string; category?: string } | undefined;
      if (!info) continue; // media, sections, etc.
      if (want !== "*" && (info.category ?? "").toLowerCase() !== want) {
        skipped.push(info.name ?? id);
        continue;
      }
      await applyTheme(id, theme, style);
      changed.push(info.name ?? id);
    }
    return ok({ style, changed, ...(skipped.length && { skipped }) });
  }
);

server.tool(
  "create_scripture_show",
  "Fetch Bible passages and build a scripture show: one slide per verse (long verses split), with the reference " +
    "on the last line of each slide so a theme's scripture style shows it under the text. Public-domain translations " +
    `only (${Object.keys(TRANSLATIONS).join(", ")}); for NIV/ESV/NKJV etc. paste the text into create_show instead. ` +
    "Optionally adds it to a project, placed before a given item (e.g. the invitation song).",
  {
    references: z.array(z.string()).min(1).describe('Passages in order, e.g. ["Ephesians 6:10-18", "John 3:16"]'),
    translation: z.string().optional().describe('Translation code (default "kjv")'),
    name: z.string().optional().describe('Show name (default "Scripture · <first reference>")'),
    theme: z.string().optional().describe("Theme to style it with"),
    style: z.string().optional().describe('Theme style (default "scripture")'),
    maxChars: z.number().optional().describe("Split verses longer than this many characters across slides (default 260)"),
    projectId: z.string().optional().describe("Project to add the show to"),
    before: z.string().optional().describe("Name of the project item it should go in front of (default: the end)"),
  },
  async ({ references, translation, name, theme, style, maxChars, projectId, before }) => {
    const code = (translation ?? "kjv").toLowerCase();
    const abbr = TRANSLATIONS[code];
    if (!abbr) return ok({ error: `"${translation}" isn't available. Use one of: ${Object.keys(TRANSLATIONS).join(", ")} — or paste copyrighted text into create_show.` });

    const passages = await Promise.all(references.map((ref) => fetchPassage(ref, code)));
    const slides: string[] = [];
    for (const passage of passages) {
      for (const verse of passage.verses) {
        const parts = splitLongText(verse.text, maxChars ?? 260);
        parts.forEach((part, i) => {
          // FreeShow drops ":" from slide group names, so "John 3:16" would show as "John 316"
          const ref = verse.reference.replace(":", ".");
          const label = parts.length > 1 ? `${ref} (${i + 1}/${parts.length})` : ref;
          slides.push(`[${label}]\n${part}\n${verse.reference} ${abbr}`);
        });
      }
    }

    const showName = name ?? `Scripture · ${passages[0].reference}`;
    const id = await createShowAndGetId({ name: showName, category: "scripture", text: slides.join("\n\n") });
    if (!id) return ok({ error: "FreeShow didn't confirm the new show" });
    const themed = theme ? await applyTheme(id, theme, style ?? "scripture") : undefined;

    let placement: string | undefined;
    if (projectId) {
      // FreeShow adds new shows to whichever project is open; take it out of every project, then place it
      const projects = ((await callAction("get_projects")) as { data?: Record<string, { shows?: { id: string }[] }> } | null)?.data ?? {};
      for (const [pid, project] of Object.entries(projects)) {
        const ids = (project.shows ?? []).map((s) => s.id);
        for (let i = ids.length - 1; i >= 0; i--) if (ids[i] === id) await callAction("remove_project_item", { id: pid, index: i + 1 });
      }
      const getItems = async () =>
        (((await callAction("get_project", { id: projectId })) as { data?: { shows?: { id: string }[] } } | null)?.data?.shows ?? []).map((s) => s.id);
      const items = await getItems();
      const names = await getShowList();
      const at = before ? items.findIndex((sid) => names[sid]?.name?.toLowerCase() === before.toLowerCase()) : -1;
      if (before && at < 0) placement = `"${before}" not found in the project; added at the end`;
      // add_to_project only appends, so take the later items off and put them back after the new show
      const tail = at >= 0 ? items.slice(at) : [];
      for (let i = items.length; i > items.length - tail.length; i--) await callAction("remove_project_item", { id: projectId, index: i });
      for (const sid of [id, ...tail]) await callAction("add_to_project", { projectId, id: sid });
      placement ??= at >= 0 ? `before "${before}"` : "at the end";
    }

    return ok({
      created: showName,
      id,
      translation: abbr,
      passages: passages.map((p) => `${p.reference} (${p.verses.length} verses)`),
      slides: slides.length,
      ...(themed && { themed }),
      ...(placement && { project: placement }),
    });
  }
);

// ─── THEMES ───────────────────────────────────────────────────────────────────

server.tool(
  "list_themes",
  "List available themes (branded looks: fonts, colors, backgrounds) and their styles. " +
    `Themes are folders with a theme.json, stored in ${userThemesDir()} (plus examples bundled with this server).`,
  {},
  async () => ok({ folder: userThemesDir(), themes: listThemes() })
);

server.tool(
  "get_theme",
  "Get a theme's full definition (to inspect it or copy and tweak it with save_theme)",
  { theme: z.string().describe("Theme id or name") },
  async ({ theme }) => {
    const t = loadTheme(theme);
    return ok({ folder: t.folder, ...t.theme });
  }
);

server.tool(
  "save_theme",
  "Create or update a theme. Each style controls the background (color or image) and text (font, size, color, " +
    "box position on a 1920x1080 slide). Image paths may be absolute or relative to the theme folder. " +
    "Saving with an existing name overwrites that theme.",
  { theme: ThemeSchema },
  async ({ theme }) => ok({ saved: theme.name, folder: saveTheme(theme) })
);

server.tool(
  "apply_theme",
  "Restyle an existing show with a theme style (fonts, colors, text box, background). " +
    "Safe to re-apply or switch themes — it replaces what a previous theme added. Slide text is not changed. " +
    'Pass slides to style only some slides (e.g. a "title" first slide in an announcements loop); ' +
    "apply the show-wide style first, then per-slide styles.",
  {
    showId: z.string().describe("Show ID"),
    theme: z.string().describe("Theme id or name (see list_themes)"),
    style: z.string().optional().describe("Style within the theme (defaults to the theme's default style)"),
    slides: z
      .array(z.number().int().min(1))
      .optional()
      .describe("Only restyle these slide numbers (1 = first slide in the layout). Omit to style the whole show."),
  },
  async ({ showId, theme, style, slides }) => ok({ showId, ...(await applyTheme(showId, theme, style, slides)) })
);

server.tool(
  "preview_slide",
  "Render a slide of a show as an image so you can see how it looks. Background-layer media is not included " +
    "(slide-embedded theme backgrounds are). If it comes back blank, FreeShow's output needs to have been shown once.",
  {
    showId: z.string().describe("Show ID"),
    slide: z.number().int().min(1).optional().describe("Slide number, starting at 1 (default 1)"),
    layoutId: z.string().optional().describe("Layout ID (defaults to the show's active layout)"),
  },
  async ({ showId, slide, layoutId }) => {
    const layout = layoutId ?? (await getShowData(showId)).settings?.activeLayout;
    const res = (await callAction("get_slide_thumbnail", { showId, layoutId: layout, index: slide ?? 1 })) as {
      data?: string;
    } | null;
    const match = /^data:(image\/\w+);base64,(.+)$/.exec(res?.data ?? "");
    if (!match) return ok({ error: "FreeShow returned no image. Show something on the output once, then retry." });
    const content: ({ type: "image"; mimeType: string; data: string } | { type: "text"; text: string })[] = [
      { type: "image", mimeType: match[1], data: match[2] },
    ];
    // FreeShow renders previews from the live output, so a running slide timer can leak into the capture
    const output = (await callAction("get_output")) as { data?: { transition?: unknown } } | null;
    if (output?.data?.transition) {
      content.push({
        type: "text",
        text: "Warning: a timed slideshow is playing on the output, so this preview may show a different slide or a transition in progress.",
      });
    }
    return { content };
  }
);

// ─── SONG SEARCH ──────────────────────────────────────────────────────────────

server.tool(
  "search_songs",
  "Search the web for a song by title/artist (same lyric sources FreeShow's built-in search uses). " +
    "Returns matching songs. Use import_song to create a show from a result. " +
    "Ensure your church holds the appropriate license (e.g. CCLI, PraiseCharts) for songs you import.",
  { query: z.string().describe('Song title and artist, e.g. "Goodness of God Bethel Music"') },
  async ({ query }) => ok(await searchSongs(query))
);

server.tool(
  "import_song",
  "Search for a song, fetch its lyrics, and create a FreeShow show from them in one step. " +
    "Uses the top search match. Slides are split on blank lines; [Verse]/[Chorus] markers become groups when present. " +
    "Pass theme to brand it immediately.",
  {
    query: z.string().describe('Song title and artist, e.g. "Living Hope Phil Wickham"'),
    name: z.string().optional().describe("Show name (defaults to the song title)"),
    category: z.string().optional().describe('Category name (defaults to "song")'),
    ...themeParams,
  },
  async ({ query, name, category, theme, style }) => {
    const song = await fetchLyrics(query);
    const showName = name ?? song.title;
    const id = await createShowAndGetId({ name: showName, category: category ?? "song", text: song.lyrics });
    const themed = id && theme ? await applyTheme(id, theme, style) : undefined;
    return ok({ created: showName, id, matched: `${song.title} — ${song.artist}`, ...(themed && { themed }) });
  }
);

// ─── RESTORE ──────────────────────────────────────────────────────────────────

server.tool("restore_output", "Restore output to the last active slide", {}, async () => action("restore_output"));

// ─── TRANSPORT ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
