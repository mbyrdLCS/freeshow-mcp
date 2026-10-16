# freeshow-mcp

> Control [FreeShow](https://freeshow.app) with Claude AI via the [Model Context Protocol](https://modelcontextprotocol.io/).

Exposes 90+ tools that let Claude (or any MCP client) control FreeShow presentations: navigate slides, build and **brand** shows, import songs, manage service projects, control audio/video, start timers, display scripture, and more.

**Highlights**

- **Themes** — define your church's look once (fonts, colors, backgrounds, logo) and apply it to any show. New songs and announcements come out branded automatically, and lyric edits keep the look. See [Themes](#themes).
- **Slide previews** — Claude can render a slide as an image to check how it looks.
- **Song import** — search for a song and create a show from its lyrics in one step.
- **Service building** — create projects, add shows, set up looping announcement slideshows.

> This is a maintained fork of [restonauta/freeshow-mcp](https://github.com/restonauta/freeshow-mcp), with the API fixes and new tools listed in [CHANGELOG.md](CHANGELOG.md). Issues and pull requests are welcome.

---

## Requirements

- [Node.js](https://nodejs.org) 18 or later
- [FreeShow](https://freeshow.app) 1.x with REST API enabled
- [Claude Code](https://claude.ai/code) or any MCP-compatible client

---

## Quick Start

### 1. Enable FreeShow API

Open FreeShow → **Settings** → **Connections** → enable **API**.

Default port: `5506`. Note the IP address shown — you'll need it if FreeShow runs on a different machine.

> If every tool fails with `fetch failed`, the API is turned off (or on a different port).

### 2. Install freeshow-mcp

**Option A — clone and build (recommended)**

```bash
git clone https://github.com/mbyrdLCS/freeshow-mcp.git
cd freeshow-mcp
npm install
npm run build
```

**Option B — npx (once published to npm)**

```bash
npx freeshow-mcp
```

### 3. Configure your MCP client

> **Note:** Claude Code and the Claude Desktop app are configured **differently**. Claude Code does *not* read MCP servers from `settings.json` — use the `claude mcp add` command (or a project `.mcp.json`). Claude Desktop uses its own `claude_desktop_config.json` file.

#### Claude Code (CLI)

Run this one-liner (registers the server for your user account):

```bash
claude mcp add freeshow --env FREESHOW_HOST=localhost --env FREESHOW_PORT=5506 -- node /absolute/path/to/freeshow-mcp/dist/index.js
```

Or, to share the config with a team via the repo, create a `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "freeshow": {
      "command": "node",
      "args": ["/absolute/path/to/freeshow-mcp/dist/index.js"],
      "env": {
        "FREESHOW_HOST": "localhost",
        "FREESHOW_PORT": "5506"
      }
    }
  }
}
```

Verify with `claude mcp list` — you should see `freeshow` listed and connected.

#### Claude Desktop App

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "freeshow": {
      "command": "node",
      "args": ["C:\\path\\to\\freeshow-mcp\\dist\\index.js"],
      "env": {
        "FREESHOW_HOST": "localhost",
        "FREESHOW_PORT": "5506"
      }
    }
  }
}
```

#### FreeShow on a different machine (LAN)

Set `FREESHOW_HOST` to the IP address of the computer running FreeShow:

```json
"env": {
  "FREESHOW_HOST": "192.168.1.50",
  "FREESHOW_PORT": "5506"
}
```

---

## Network Topology

```
┌─────────────────────────┐         ┌─────────────────────┐
│  Your computer          │   LAN   │  Presentation PC    │
│                         │ ──────► │                     │
│  Claude Code            │ HTTP    │  FreeShow           │
│  freeshow-mcp server    │ :5506   │  (REST API enabled) │
└─────────────────────────┘         └─────────────────────┘
```

Both machines can also be the same computer.

---

## Available Tools

### Slides

| Tool | Description |
|------|-------------|
| `next_slide` | Go to the next slide |
| `previous_slide` | Go to the previous slide |
| `random_slide` | Jump to a random slide |
| `select_slide_by_index` | Select slide by number (1 = first slide) |
| `select_slide_by_name` | Jump to slide by text/name |

### Shows

| Tool | Description |
|------|-------------|
| `select_show_by_name` | Select and present a show by name |
| `start_show` | Start a show by ID |
| `select_show_by_id` | Open a show by ID without presenting it |
| `get_shows` | List all available shows |
| `get_show` | Get details of a specific show |
| `get_show_layout` | Get the slide order of a show |
| `change_layout` | Switch a show to a different layout |
| `get_plain_text` | Read a show's content as plain text (with `[Group]` labels) |
| `set_plain_text` | Rewrite a show's content from plain text (re-applies its theme) |
| `get_groups` | Get a show's slide groups (Verse, Chorus, …) |
| `select_group_by_id` | Jump straight to a slide group (e.g. the chorus) |
| `set_template` | Apply a FreeShow template to the active show |
| `set_slide_timers` | Auto-advance every slide (e.g. a looping announcements loop) |
| `disable_slide` | Hide/unhide a slide in the layout |
| `set_show` | Advanced: replace a show's full data |
| `delete_shows` | Delete shows by ID or name (briefly restarts FreeShow — not during a service) |
| `get_output_slide_text` | Get text of the currently displayed slide |
| `get_output_group_name` | Get the group name of the displayed slide |

### Projects

| Tool | Description |
|------|-------------|
| `get_projects` | List all projects |
| `get_project` | Get details of a specific project |
| `create_project` | Create a new project (service plan) |
| `add_to_project` | Add a show to a project |
| `rename_project` | Rename a project |
| `remove_project_item` | Remove an item from a project |
| `select_project_by_name` | Open a project by name |
| `select_project_by_id` | Open a project by ID |
| `start_project_item_by_name` | Present a project item by name |
| `delete_project` | Delete a project (its shows are kept) |
| `next_project_item` | Move to next item in project |
| `previous_project_item` | Move to previous item in project |
| `select_project_item_by_index` | Jump to project item by number (1 = first) |

### Clear / Output

| Tool | Description |
|------|-------------|
| `clear_all` | Clear everything (slide, background, audio, overlays) |
| `clear_slide` | Clear slide content only |
| `clear_background` | Clear background only |
| `clear_audio` | Stop all audio |
| `clear_overlays` | Clear all overlays |
| `clear_overlay` | Clear a specific overlay by ID |
| `lock_output` | Freeze/unfreeze the output |
| `get_output` | Get current output state |
| `get_cleared` | See which output layers are cleared |
| `restore_output` | Restore last active slide |
| `toggle_output_windows` | Show/hide the output windows |
| `toggle_output` | Turn a specific output on/off |
| `change_transition` | Change slide or media transition |

### Audio

| Tool | Description |
|------|-------------|
| `play_audio` | Play an audio file |
| `stop_audio` | Stop an audio file |
| `pause_audio` | Pause/resume an audio file |
| `mute` | Mute/unmute audio |
| `change_volume` | Set master volume (0–100) |
| `start_playlist` | Start a playlist by ID |
| `start_playlist_by_name` | Start a playlist by name |
| `playlist_next` | Skip to next track |
| `get_playlists` | List all playlists |

### Media

| Tool | Description |
|------|-------------|
| `play_media` | Play a video/image as background |
| `toggle_playing_media` | Pause/resume current media |
| `get_playing_video_time` | Get current video playback position |
| `get_playing_video_duration` | Get total video duration |
| `video_seek_to` | Jump the playing video to a time |
| `toggle_media_loop` | Toggle video looping |
| `toggle_media_mute` | Toggle video mute |

### Timers

| Tool | Description |
|------|-------------|
| `get_timers` | List all timers |
| `start_timer_by_name` | Start a timer by name |
| `start_timer_by_id` | Start a timer by ID |
| `pause_timers` | Pause all timers |
| `stop_timers` | Stop all timers |
| `edit_timer` | Edit a timer property |
| `stop_timer_by_id` | Stop a specific timer |

### Scripture

| Tool | Description |
|------|-------------|
| `start_scripture` | Display a scripture reference (e.g. "John 3:16") |
| `scripture_next` | Next verse/passage |
| `scripture_previous` | Previous verse/passage |

### Variables & Actions

| Tool | Description |
|------|-------------|
| `get_variables` | List all variables |
| `get_variable` | Get one variable by ID or name |
| `change_variable` | Change a variable value |
| `run_action_by_name` | Run a saved action by name |
| `run_action_by_id` | Run a saved action by ID |
| `start_trigger` | Fire a trigger by ID |
| `get_actions` | List saved actions |
| `toggle_action` | Enable/disable an action's trigger |

### Overlays

| Tool | Description |
|------|-------------|
| `select_overlay_by_name` | Enable an overlay by name |
| `select_overlay_by_id` | Enable an overlay by ID |

### Create

| Tool | Description |
|------|-------------|
| `create_show` | Create a show from text and return its ID — blank line = new slide, `[Verse 1]` / `[Chorus]` labels create named slide groups; optional `theme` |
| `search_songs` | Search the web for a song by title/artist (same sources as FreeShow's built-in search) |
| `import_song` | Search, fetch lyrics, and create a show in one step; optional `theme` (ensure you're licensed, e.g. CCLI/PraiseCharts) |

### Themes & Preview

| Tool | Description |
|------|-------------|
| `list_themes` | List themes and their styles |
| `get_theme` | Read a theme's full definition |
| `save_theme` | Create or update a theme |
| `apply_theme` | Restyle a show (or just some slides) with a theme style |
| `preview_slide` | Render a slide as an image |
| `add_qr_code` | Put a QR code on a slide using FreeShow's built-in QR Code element (no image file needed) |
| `add_image` | Place an image (photo, logo) on a slide — survives text edits and theme changes |
| `remove_image` | Remove an image or QR code added with the tools above |

---

## Themes

A theme is your church's look, saved as a folder with a `theme.json` and any images it uses:

```
~/Documents/FreeShow/MCP Themes/
  my-church/
    theme.json
    backgrounds/lyrics.png
```

Each theme has named **styles** — for example `lyrics`, `scripture`, `announcement`, `heading` — and each style sets:

- `background` — a solid `color` and/or an `image` (embedded in the slide so it shows in previews; set `"layer": true` to use FreeShow's background layer instead)
- `text` — font, size, color, weight, alignment, shadow and the text box position (on a 1920×1080 slide)
- `secondary` — style for a second text box (a subtitle, or a scripture reference)
- `split` — `"firstLine"` or `"lastLine"` to move a heading or reference into that second box automatically
- `logo` — an optional image placed on every slide

Start from the bundled example in [`themes/classic-dark`](themes/classic-dark/theme.json), or just ask Claude: *"Make a theme for our church using navy #1B2A41 and gold, with Georgia headings."*

Different slides in one show can use different styles — e.g. an announcements loop whose first slide uses `title`: apply the show-wide style, then `apply_theme` again with `slides: [1]`.

Applying a theme is safe to repeat or switch — it replaces what the previous theme added and never changes slide text. The show remembers its theme, so `set_plain_text` edits stay branded. If you add slides by hand in FreeShow, run `apply_theme` again.

> Fonts must be installed on the computer running FreeShow. List fallbacks (e.g. `"Montserrat, Arial, sans-serif"`) so slides still look right elsewhere.

---

## Example Prompts

Once configured, you can talk to Claude naturally:

```
"Import 'Living Hope' by Phil Wickham with our church theme"
"Make an announcements slideshow that loops every 8 seconds"
"Add a QR code to slide 4 that opens our prayer partner form"
"Show me a preview of slide 2"
"Next slide"
"Go back to the previous slide"
"Show the song 'Amazing Grace'"
"Clear everything on screen"
"Start the countdown timer"
"Display John 3:16"
"What slide is currently showing?"
"Set volume to 70"
"Play the background video at /videos/worship.mp4"
"Create a show with these announcements: ..."
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FREESHOW_HOST` | `localhost` | IP or hostname of the FreeShow machine |
| `FREESHOW_PORT` | `5506` | REST API port |
| `FREESHOW_MCP_THEMES_DIR` | `~/Documents/FreeShow/MCP Themes` | Where your themes are stored |
| `FREESHOW_APP_PATH` | *(auto)* | FreeShow app location, if `delete_shows` can't reopen it (unusual install folder) |

---

## Good to Know

- **Save in FreeShow.** Changes made through the API live in FreeShow's memory until it saves. If autosave is off, press Cmd/Ctrl+S.
- **Deleting shows** isn't part of FreeShow's API, so `delete_shows` asks FreeShow to save and close, removes the shows, and reopens it (~10 seconds). It refuses while a slide is on screen and only works when FreeShow runs on the same computer. Deleted files go to `MCP Deleted Shows/` in FreeShow's data folder, so they can be recovered.
- **Numbers start at 1.** Slide and project-item numbers in tools are 1-based, matching FreeShow's API.
- **Previews** are built from the live output, so while a timed slideshow is playing they can show the wrong slide (the tool warns you). They render the slide (including theme backgrounds) but not media playing on the background layer. If a preview comes back blank, show something on the output once.

---

## Development

```bash
npm run dev    # watch mode (auto-recompile on changes)
npm run build  # production build
npm start      # run compiled server
```

---

## Publishing to npm

```bash
# login first
npm login

# publish
npm publish --access public
```

After publishing, users can run it without cloning:

```json
{
  "mcpServers": {
    "freeshow": {
      "command": "npx",
      "args": ["freeshow-mcp"],
      "env": { "FREESHOW_HOST": "localhost" }
    }
  }
}
```

---

## Related

- [FreeShow](https://freeshow.app) — free and open-source presentation software
- [FreeShow API docs](https://freeshow.app/api)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

## License

MIT
