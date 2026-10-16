# Changelog

## 0.6.0 — 2026-10-16

### Added
- `add_qr_code` — places FreeShow's built-in **QR Code** slide element (generated live by FreeShow, no image file), with color/background options. It checks that the site responds first, and the code is remembered by slide position like `add_image`, so it survives text edits and theme changes. `remove_image` removes QR codes too.

## 0.5.0 — 2026-10-16

### Added
- `add_image` / `remove_image` — put a QR code, photo or logo on a specific slide. Images are remembered by slide position and re-placed after `set_plain_text` and theme changes (FreeShow would otherwise duplicate or drop them).
- `preview_slide` warns when a timed slideshow is playing, because FreeShow's capture uses the live output and can show the wrong slide.

## 0.4.2 — 2026-10-16

### Fixed
- `set_plain_text` on a themed show could pour all the text into the first box: FreeShow applies the text a moment after the API call returns, and the theme was re-applied before that. It now waits for the edit to land and settle.
- `create_show` on non-song shows without `[Label]` lines names each slide after its first line. FreeShow otherwise guesses song parts, so an announcements loop showed "Verse", "Chorus", "Bridge".

## 0.4.1 — 2026-10-16

### Fixed
- Themes were wiped after FreeShow restarted: FreeShow re-applies a show's template (usually "Default") to its slides when it loads the show. Applying a theme now clears the show and slide template, the same way FreeShow's own "remove template" does. Re-run `apply_theme` on shows themed with an earlier version.

## 0.4.0 — 2026-10-16

### Added
- `apply_theme` takes `slides` to style only some slides, so one show can mix styles (e.g. a title slide at the start of an announcements loop). Per-slide styles are remembered by position and survive `set_plain_text` edits.

### Fixed
- `import_song` / `search_songs` lyrics no longer start with the lyrics site's "7 ContributorsSong Title Lyrics" header.
- `delete_shows` also removes the deleted shows from any project that contains them.
- `create_show` notes that FreeShow adds new shows to the currently open project.
- Re-applying a split style after FreeShow rewrites a slide's text keeps the heading/body pair linked, so switching styles later merges them back correctly.

## 0.3.0 — 2026-10-16

### Added
- `delete_shows` — delete shows by ID or name. FreeShow's API has no delete action, so it saves and closes FreeShow, moves the show files to `MCP Deleted Shows/` (recoverable), and reopens FreeShow. Requires `confirm: true`, refuses while a slide is on screen, and only runs when FreeShow is on the same computer.

## 0.2.0 — 2026-10-16

### Added
- **Themes**: `list_themes`, `get_theme`, `save_theme`, `apply_theme`. A theme is a portable folder (`theme.json` + images) with named styles (lyrics, scripture, announcement…). Bundled example: `classic-dark`.
- `create_show` and `import_song` take an optional `theme`/`style` and now return the new show's ID.
- `set_plain_text` re-applies the show's theme after rewriting text (FreeShow resets styling on text rewrites).
- `preview_slide` returns a rendered slide image.
- `set_slide_timers` for auto-advancing/looping slideshows.
- New FreeShow actions: `select_show_by_id`, `set_show`, `disable_slide`, `select_project_by_id`, `start_project_item_by_name`, `delete_project`, `toggle_output_windows`, `toggle_output`, `change_transition`, `pause_audio`, `mute`, `video_seek_to`, `toggle_media_loop`, `toggle_media_mute`, `stop_timer_by_id`, `get_variable`, `get_actions`, `toggle_action`, `select_overlay_by_id`.

### Fixed
- `select_slide_by_index`, `select_project_item_by_index` and `remove_project_item` were documented as zero-based, but FreeShow's API is 1-based — they hit the wrong item. They now take 1-based numbers.

## 0.1.x

- Song search and import (`search_songs`, `import_song`).
- Show editing and project tools (`get_plain_text`, `set_plain_text`, `get_groups`, `create_project`, `add_to_project`, …).
- Fixed: actions are sent as a JSON POST with parameters at the top level (previously every parameterized tool silently failed).
- Setup docs: Claude Code uses `claude mcp add` / `.mcp.json`, not `settings.json`.
