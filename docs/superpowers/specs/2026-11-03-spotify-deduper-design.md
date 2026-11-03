# spotify-deduper: design

## Why

João has ~4,000 Liked Songs on Spotify. He moved Spotify → Apple Music → Spotify with a migration app. On the way back, the app couldn't find exact matches for many songs and liked a nearby version instead: a remix, live take, or radio edit. Result: the same song is liked two or more times in different versions. Shuffle plays the same song over and over.

He wants the duplicates gone, and he cares a lot about safety: he must not lose a song he liked.

## Goals

- Find every group of liked tracks that are versions of the same song.
- Keep one version per group (see "Picking the keeper"). Unlike the rest.
- Show **every** duplicate group (no sampling) in one scrollable terminal view, and let him approve all of it with one action. He skims, he doesn't approve pair by pair.
- Full backup before any change. One command to undo the last apply.
- Runs entirely in the terminal, over SSH, with a good TUI.

## Non-goals

- Playlists. Liked Songs only.
- Picking the "best" or "studio" version. The rule is oldest playable like.
- Publishing as a multi-user app. Personal tool, single Spotify account.
- Any web UI or hosted service.

## Anti-goals (failure even if it works)

- Any track unliked that he didn't see and approve in the review screen.
- A song ending up with zero liked versions, or with only an unplayable one when a playable one existed.
- Two different songs merged because they share a title (e.g. two artists' "Faded").
- Partial apply with no record of what was removed.

## Constraints

- **Runs on `jopcmelo-server`** (headless Linux, used over SSH). Repo: `github.com/joaopcm/spotify-deduper`, cloned at `/srv/repositories/spotify-deduper`. Bun is not installed there yet.
- **Spotify Web API, development mode.** App owner needs Premium; dev-mode apps are capped at 5 users. Fine for one person. README walks through creating the app and adding his account as a user. Feb 2026 migration guide: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- **Endpoints (post Feb 2026):** read with `GET /me/tracks` (paged, pass `market=from_token` so tracks carry `is_playable`). Unlike with `DELETE /me/library`, re-like with `PUT /me/library`; both take Spotify URIs, not ids. Verify batch sizes and scopes against current docs before coding.
- **Auth:** Authorization Code with PKCE (no client secret on disk). Scopes: whatever the library read/modify endpoints require today (was `user-library-read`, `user-library-modify`). Server has no browser, so: print the authorize URL, he opens it on his laptop, the redirect to `http://127.0.0.1:<port>/callback` fails to load there, and he pastes that final URL back into the terminal. Refresh token cached at `~/.config/spotify-deduper/` (mode 600).
- **Undo can't restore `added_at`.** Spotify sets it to "now" on re-like. Undo restores the like, not its place in date order. Say so in the UI before apply.
- **Rate limits:** respect `429` + `Retry-After`. Keep call count low.

## How (decided)

- TypeScript on Bun. TUI with Ink (React for terminals).
- One binary, four commands (`spotify-deduper <cmd>`):
  1. `scan`: login if needed, fetch all liked tracks with progress, write a timestamped backup (every track: uri, name, artists, album, ISRC, `added_at`, `is_playable`, raw API object), compute duplicate groups, write the scan result.
  2. `review`: full-screen list of every group. Keeper on top labelled "keep" with its date added (and why, if it isn't the oldest); versions to unlike below. Everything checked by default. `space` toggles a whole group; `enter` steps into a group so a single track can be unchecked (it then stays liked). `j`/`k`/arrows scroll, `/` filters by artist or title. Header: groups, songs to unlike, items unchecked. `a` saves the approved selection to disk and applies, after one final `y` confirm. Also warns that undo can't restore dates.
  3. `apply`: requires a selection file saved by `review`; refuses without one. Unlikes approved tracks in batches with progress. Before each batch, append its URIs to an undo log on disk so a crash mid-apply still leaves a full record.
  4. `undo`: re-like everything in the most recent undo log.

## Matching (decided)

Two tracks are in the same group when **either**:
- Same ISRC (same recording, different release), or
- Same primary-artist set (normalized) **and** same normalized title.

ISRC (`external_ids.isrc`) was briefly removed from dev-mode responses in Feb 2026 and restored in March. Check a live response first; if it's missing, match on artist + title only, and print that loudly in `scan` output.

Title normalization strips version tags in `( )`, `[ ]`, or after ` - `: remix, mix, edit, radio edit, live, acoustic, remaster(ed) (+ year), version, mono/stereo, extended, original, explicit, clean, feat./ft./with … Also lowercase, strip accents and punctuation, collapse whitespace.

Same title by different artists is never a match. Groups are transitive (union-find).

## Picking the keeper (decided)

1. Oldest `added_at` among tracks where `is_playable` is true.
2. If none in the group is playable, keep the oldest and flag the group in review ("no playable version").
3. Ties on `added_at`: prefer playable, then the one without version tags in its title, then stable by URI.

## Left to the builder

- Exact tag list and regexes (one table, with tests covering the "Faded" cases: Remix, Live, Radio Edit, Restrung, feat.).
- How "primary artist" compares when the importer picked a version with extra featured artists (likely: first-listed artist matches and the rest is a subset).
- Stale-scan guard for `apply` (e.g. refuse if scan is older than N hours, or re-check that keepers are still liked).
- File layout, state dir, project structure, tests (unit tests for normalization, grouping, keeper picking are a must; API is mocked).
- Extra detail in the TUI (album, duration, playable badge).
