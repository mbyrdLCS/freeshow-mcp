#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callAction } from "./freeshow.js";

const server = new McpServer({
  name: "freeshow-mcp",
  version: "0.1.0",
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
  "Select a slide by its index in the current layout",
  {
    index: z.number().describe("Zero-based slide index"),
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

// ─── PROJECTS ─────────────────────────────────────────────────────────────────

server.tool("get_projects", "Get list of all projects", {}, async () => action("get_projects"));

server.tool(
  "select_project_by_name",
  "Select a project by name",
  { value: z.string().describe("Project name") },
  async ({ value }) => action("name_select_project", { value })
);

server.tool("next_project_item", "Move to the next item in the project", {}, async () => action("next_project_item"));
server.tool("previous_project_item", "Move to the previous item in the project", {}, async () => action("previous_project_item"));

server.tool(
  "select_project_item_by_index",
  "Select a project item by index",
  { index: z.number().describe("Zero-based item index") },
  async ({ index }) => action("index_select_project_item", { index })
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

// ─── OVERLAYS ─────────────────────────────────────────────────────────────────

server.tool(
  "select_overlay_by_name",
  "Enable an overlay by name",
  { value: z.string().describe("Overlay name") },
  async ({ value }) => action("name_select_overlay", { value })
);

server.tool(
  "clear_overlay",
  "Clear a specific overlay by ID",
  { id: z.string().describe("Overlay ID") },
  async ({ id }) => action("clear_overlay", { id })
);

// ─── CREATE ───────────────────────────────────────────────────────────────────

server.tool(
  "create_show",
  "Create a new show from text",
  {
    text: z.string().describe("Slide text content (use newlines for multiple slides)"),
    name: z.string().optional().describe("Show name"),
    category: z.string().optional().describe("Category name"),
  },
  async ({ text, name, category }) => action("create_show", { text, name, category })
);

// ─── RESTORE ──────────────────────────────────────────────────────────────────

server.tool("restore_output", "Restore output to the last active slide", {}, async () => action("restore_output"));

// ─── TRANSPORT ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
