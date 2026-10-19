# Changelog

## 0.14.0 — 2026-10-19

### Changed
- Scripture templates from `create_template_from_theme` use FreeShow's placeholders (`{scripture_text}`, `{scripture_reference}`), so FreeShow's newer scripture system fills them in. Previously FreeShow warned "template with no scripture values" and fell back to its old system.

### Added
- `create_template_from_theme` takes `category`, e.g. `"scripture"` to offer a template (like a plain black-and-white one) in FreeShow's Scripture template list without making it the default.

### Fixed
- `set_slide_transition` also sets the slides inside each group, which FreeShow stores under the parent slide.

## 0.13.0 — 2026-10-18

### Changed
- `create_scripture_show` combines consecutive verses onto a slide when they fit (about 300 characters), balanced so a passage splits evenly instead of leaving a lone short verse, with range references like "Luke 16:27–29". Use `oneVersePerSlide` for the old behavior.

### Added
- Theme text styles accept `fit: true` to shrink text that would overflow its box.

## 0.12.0 — 2026-10-18

### Added
- `set_slide_transition` — set a show's slide transition (`none`, `crossfade`, `fade`, `default`), including the slides inside each group, which FreeShow stores separately under the parent.
- `set_slide_timers` takes `transition` / `transitionMs`, e.g. a crossfade for announcement loops. FreeShow's default fade dips through black, which flashes when backgrounds are part of the slides.

## 0.11.1 — 2026-10-18

### Added
- Scripture references understand half verses: "Luke 2:41-44a" ends with the first half of verse 44 and "John 3:16b-18" starts halfway through 16. Verses are split at the sentence nearest the middle, and slides are labeled "Luke 2:44a".

## 0.11.0 — 2026-10-18

### Added
- Theme styles can have a `tertiary` text box, and `split: "firstAndLast"` turns one text box into heading / body / last line — e.g. an announcement with the website as a bold banner. It survives text edits and theme switches like the other splits.

## 0.10.1 — 2026-10-18

### Fixed
- Templates from `create_template_from_theme` now actually shrink long text to fit. FreeShow only carries `textFit` onto scripture slides when the template item is also marked `auto`, so a called-out range like Mark 1:1-10 overflowed. Tested live with 10 verses.

## 0.10.0 — 2026-10-18

### Added
- `create_template_from_theme` — converts a theme style into a FreeShow template (with shrink-to-fit text and the style's background). With `useForScripture`, FreeShow's scripture output — Scripture panel, `start_scripture`, Auto Scripture — uses it. Tested live.
- `toggle_auto_scripture` — starts/stops FreeShow's Smart listening (wraps `smart_toggle_stt`). Not yet tested with a live microphone.

### Fixed
- Restarting FreeShow (`delete_shows`, `create_lower_thirds`, templates) now waits for the FreeShow process to actually exit before editing its files. Previously edits could be lost because FreeShow keeps saving for a moment after its API stops.
- Scripture template IDs avoid the word "scripture": FreeShow treats such IDs as built-in defaults and swaps them back to its own template whenever the Scripture tab is open.

## 0.9.0 — 2026-10-18

### Changed
- `create_scripture_show` now uses ChurchApps' Bible service, the same source as FreeShow's online Bibles (API.Bible + YouVersion), so licensed translations like **NIV**, NIrV, NASB and AMP work alongside KJV, BSB, WEB and others. References can be written naturally ("Psalm 23", "Rom 8:28, 31", "John 3:16-18; Eph 2:8-9", "Gen 1:31-2:2"). Text is cleaned of paragraph marks and split small caps ("L ord" → "LORD").

### Added
- `list_bible_translations` — the available translations, filtered by language (default English).

## 0.8.0 — 2026-10-18

### Added
- `create_scripture_show` — fetches passages (KJV, WEB, ASV, BBE, Darby, YLT via bible-api.com), makes one slide per verse with the reference on the last line (long verses split at sentence breaks), applies a theme style, and places the show in a project before a named item. It also removes the copy FreeShow auto-adds to whichever project is open. Copyrighted translations (NIV, ESV, NKJV…) are refused with a pointer to paste the text into `create_show`.

## 0.7.0 — 2026-10-18

### Added
- `apply_theme_to_project` — restyle every song in a project at once, e.g. to switch a whole service between branded and plain lyrics. Only `song` shows change by default. Tested live.
- `create_lower_thirds` and `list_overlays` — themes can define a `lowerThird` design, and `create_lower_thirds` builds name tags, scripture references and banners as FreeShow overlays. FreeShow's API can't create overlays, so this uses the same save → close → edit → reopen routine as `delete_shows`. **Not yet tested against a live FreeShow** (the overlay builder output was checked offline against FreeShow's overlay format).

### Changed
- `delete_shows`' close/reopen steps moved into a shared `withFreeShowClosed` helper (behavior unchanged; not yet re-run live since the move).

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
