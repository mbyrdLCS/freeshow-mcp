# freeshow-mcp

> Control [FreeShow](https://freeshow.app) with Claude AI via the [Model Context Protocol](https://modelcontextprotocol.io/).

Exposes 40+ tools that let Claude (or any MCP client) control FreeShow presentations: navigate slides, manage shows and projects, control audio/video, start timers, display scripture, change variables, and more.

---

## Requirements

- [Node.js](https://nodejs.org) 18 or later
- [FreeShow](https://freeshow.app) 1.x with REST API enabled
- [Claude Code](https://claude.ai/code) or any MCP-compatible client

---

## Quick Start

### 1. Enable FreeShow API

Open FreeShow → **Settings** → **Connections** → enable **WebSocket/REST API**.

Default port: `5506`. Note the IP address shown — you'll need it if FreeShow runs on a different machine.

### 2. Install freeshow-mcp

**Option A — clone and build (recommended)**

```bash
git clone https://github.com/YOUR_USERNAME/freeshow-mcp.git
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
| `select_slide_by_index` | Select slide by index number |
| `select_slide_by_name` | Jump to slide by text/name |

### Shows

| Tool | Description |
|------|-------------|
| `select_show_by_name` | Select and present a show by name |
| `start_show` | Start a show by ID |
| `get_shows` | List all available shows |
| `get_show` | Get details of a specific show |
| `get_show_layout` | Get the slide order of a show |
| `change_layout` | Switch a show to a different layout |
| `get_plain_text` | Read a show's content as plain text (with `[Group]` labels) |
| `set_plain_text` | Rewrite a show's content from plain text |
| `get_groups` | Get a show's slide groups (Verse, Chorus, …) |
| `select_group_by_id` | Jump straight to a slide group (e.g. the chorus) |
| `set_template` | Apply a template to the active show |
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
| `next_project_item` | Move to next item in project |
| `previous_project_item` | Move to previous item in project |
| `select_project_item_by_index` | Jump to project item by index |

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

### Audio

| Tool | Description |
|------|-------------|
| `play_audio` | Play an audio file |
| `stop_audio` | Stop an audio file |
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

### Timers

| Tool | Description |
|------|-------------|
| `get_timers` | List all timers |
| `start_timer_by_name` | Start a timer by name |
| `start_timer_by_id` | Start a timer by ID |
| `pause_timers` | Pause all timers |
| `stop_timers` | Stop all timers |
| `edit_timer` | Edit a timer property |

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
| `change_variable` | Change a variable value |
| `run_action_by_name` | Run a saved action by name |
| `run_action_by_id` | Run a saved action by ID |
| `start_trigger` | Fire a trigger by ID |

### Overlays

| Tool | Description |
|------|-------------|
| `select_overlay_by_name` | Enable an overlay by name |

### Create

| Tool | Description |
|------|-------------|
| `create_show` | Create a new show from text — blank line = new slide, `[Verse 1]` / `[Chorus]` labels create named slide groups |
| `search_songs` | Search the web for a song by title/artist (same sources as FreeShow's built-in search) |
| `import_song` | Search, fetch lyrics, and create a show in one step (ensure you're licensed, e.g. CCLI/PraiseCharts) |

---

## Example Prompts

Once configured, you can talk to Claude naturally:

```
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
