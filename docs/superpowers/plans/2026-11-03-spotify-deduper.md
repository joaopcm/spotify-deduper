# spotify-deduper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal tool that finds duplicate versions of the same song in Spotify Liked Songs, shows every group in a TUI, and unlikes approved duplicates with a full backup and one-command undo.

**Architecture:** Pure core (normalize → group → pick keeper) with no I/O, a thin Spotify client with injectable `fetch`, a file store for token/backup/scan/selection/undo, and Ink components on top. Commands: `scan`, `review`, `apply`, `undo`.

**Tech Stack:** Bun (runtime, test runner), TypeScript, Ink 6 + React 19, `ink-testing-library`.

**Spec:** `docs/superpowers/specs/2026-11-03-spotify-deduper-design.md`

## Global Constraints

- Runs on `jopcmelo-server` (Linux, over SSH), repo at `/srv/repositories/spotify-deduper`.
- Auth: Authorization Code + PKCE, no client secret. Scopes `user-library-read user-library-modify`. Client id from env `SPOTIFY_CLIENT_ID`; redirect `SPOTIFY_REDIRECT_URI`, default `http://127.0.0.1:8888/callback`.
- Read: `GET /v1/me/tracks?limit=50&market=from_token`. Receipt: reference page, max `limit` 50.
- Unlike: `DELETE /v1/me/library?uris=<comma-separated>`. Re-like: `PUT /v1/me/library?uris=...`. Receipt: reference page, max 40 URIs per request. Verify `PUT` limit on its reference page in Task 4; if different, use its documented value.
- State dir: `$SPOTIFY_DEDUPER_HOME` or `~/.config/spotify-deduper/`, created mode 700; `token.json` mode 600.
- Keeper: oldest `added_at` among playable; none playable → oldest, flagged. Ties: playable, then no version tag, then URI ascending.
- Same title, different primary artist is never a match.
- Every error names what failed, the limit, and the actual value. No silent catches.
- Commit messages: conventional, lowercase, no agent credit (no `Co-Authored-By`).

## Review Focus

1. Access token expires mid-scan of ~4,000 tracks (80 pages): expect transparent refresh on `401`, scan continues. Test in Task 4.
2. Process dies mid-apply: undo log already holds every URI of the batch in flight, `undo` re-likes them (`PUT` of an already-liked track is harmless). Test in Task 6.
3. Liked Songs changed since scan (he liked/unliked on his phone): `apply` refuses a scan older than 24h (guess, a tripwire; error names age and limit). Test in Task 6.
4. `apply` run twice on the same selection: second run refuses, error says it was applied at `<time>`. Test in Task 6.
5. Wrong URL pasted at login (`error=access_denied`, state mismatch, no `code`): clear error naming which. Test in Task 5.

---

## File Structure

```
package.json, tsconfig.json, README.md
src/types.ts        shared types
src/normalize.ts    title/artist normalization
src/group.ts        duplicate grouping + keeper
src/store.ts        state dir files
src/spotify.ts      API client
src/auth.ts         PKCE login, token refresh
src/apply.ts        apply + undo
src/review/state.ts review reducer (pure)
src/review/Review.tsx Ink screen
src/ui/Progress.tsx progress bar
src/cli.tsx         command dispatch
test/*.test.ts(x)   one per src file
```

### Task 1: Scaffold, types, normalization

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`, `src/normalize.ts`, `test/normalize.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):
```ts
export type LikedTrack = { uri: string; name: string; artists: string[]; album: string; isrc: string | null; addedAt: string; isPlayable: boolean; durationMs: number };
export type KeeperReason = "oldest" | "oldest-playable" | "no-playable";
export type DuplicateGroup = { id: string; keeper: LikedTrack; others: LikedTrack[]; reason: KeeperReason };
export type ScanResult = { version: 1; scannedAt: string; trackCount: number; isrcAvailable: boolean; groups: DuplicateGroup[] };
export type Selection = { scannedAt: string; createdAt: string; uris: string[]; appliedAt: string | null };
```
- Produces (`src/normalize.ts`): `normalizeTitle(title: string): string`, `normalizeArtist(name: string): string`, `hasVersionTag(title: string): boolean`

- [ ] **Step 1:** Install Bun on the server if missing (`curl -fsSL https://bun.sh/install | bash`), `bun init`, add `ink`, `react`, dev `@types/react`, `ink-testing-library`. `package.json` `bin: { "spotify-deduper": "src/cli.tsx" }`, script `test: bun test`. `.gitignore`: `node_modules`.
- [ ] **Step 2: Write failing tests** in `test/normalize.test.ts`:
```ts
expect(normalizeTitle("Faded")).toBe("faded");
expect(normalizeTitle("Faded - Remix")).toBe("faded");
expect(normalizeTitle("Faded (Live)")).toBe("faded");
expect(normalizeTitle("Faded - Radio Edit")).toBe("faded");
expect(normalizeTitle("Faded (Restrung)")).toBe("faded");
expect(normalizeTitle("Faded [feat. Iselin Solheim]")).toBe("faded");
expect(normalizeTitle("Faded - Remastered 2019")).toBe("faded");
expect(normalizeTitle("Faded - Alan Walker Remix")).toBe("faded");
expect(normalizeTitle("Déjà Vu")).toBe("deja vu");
expect(normalizeTitle("Live Forever")).toBe("live forever");      // tag word as real title stays
expect(normalizeTitle("Mr. Brightside")).toBe("mr brightside");
expect(normalizeArtist("Beyoncé")).toBe("beyonce");
expect(hasVersionTag("Faded - Remix")).toBe(true);
expect(hasVersionTag("Faded")).toBe(false);
```
- [ ] **Step 3:** Run `bun test test/normalize.test.ts`, expect FAIL (module missing).
- [ ] **Step 4: Implement.** One exported `VERSION_TAGS` regex list in `normalize.ts`. Strip any `( … )`/`[ … ]` segment or ` - …` suffix whose text contains a version word: remix, mix, edit, live, acoustic, remaster, remastered, version, mono, stereo, extended, original, explicit, clean, restrung, feat, ft, with, demo, instrumental, unplugged, session. Then NFD + strip diacritics, lowercase, drop punctuation, collapse whitespace. Bare title words are never stripped.
- [ ] **Step 5:** `bun test`, expect PASS.
- [ ] **Step 6:** `git commit -m "feat: add title and artist normalization"`

### Task 2: Grouping and keeper

**Files:** Create `src/group.ts`, `test/group.test.ts`

**Interfaces:**
- Consumes: Task 1 types and normalize.
- Produces: `findDuplicateGroups(tracks: LikedTrack[]): DuplicateGroup[]`, `pickKeeper(tracks: LikedTrack[]): { keeper: LikedTrack; reason: KeeperReason }`

- [ ] **Step 1: Write failing tests** with a `track(overrides)` factory:
  - `faded` (2017, Alan Walker) + `faded - remix` (2026, Alan Walker) → one group, keeper the 2017 one, reason `"oldest"`.
  - Same ISRC, different titles → one group.
  - `faded` by Alan Walker + `faded` by ZHU → zero groups.
  - A~B by ISRC and B~C by title → one group of three (transitive).
  - Oldest unplayable, newer playable → keeper is the playable one, reason `"oldest-playable"`.
  - All unplayable → keeper oldest, reason `"no-playable"`.
  - Same `addedAt`: playable beats unplayable; then no version tag beats tagged; then lower URI.
  - Singletons produce no group; `group.id === group.keeper.uri`; groups sorted by keeper artist then normalized title.
- [ ] **Step 2:** `bun test test/group.test.ts`, expect FAIL.
- [ ] **Step 3: Implement.** Union-find over indexes. Union on equal non-null `isrc`, and on equal key `normalizeArtist(artists[0]) + "\u0000" + normalizeTitle(name)`. Tracks with no artists only union by ISRC.
- [ ] **Step 4:** `bun test`, expect PASS.
- [ ] **Step 5:** `git commit -m "feat: group duplicate tracks and pick keeper"`

### Task 3: File store

**Files:** Create `src/store.ts`, `test/store.test.ts`

**Interfaces:**
- Produces:
```ts
export type Token = { accessToken: string; refreshToken: string; expiresAt: number };
export function stateDir(): string; // $SPOTIFY_DEDUPER_HOME ?? ~/.config/spotify-deduper, mkdir 700
export function readToken(dir: string): Token | null;
export function writeToken(dir: string, t: Token): void;              // mode 600
export function writeBackup(dir: string, raw: unknown[], at: Date): string; // backups/<iso>.json, returns path
export function writeScan(dir: string, s: ScanResult): void;           // scan.json
export function readScan(dir: string): ScanResult | null;
export function writeSelection(dir: string, s: Selection): void;       // selection.json
export function readSelection(dir: string): Selection | null;
export function startUndoLog(dir: string, at: Date): string;           // undo/<iso>.log, returns path
export function appendUndo(path: string, uris: string[]): void;        // one uri per line, fsync
export function latestUndo(dir: string): { path: string; uris: string[] } | null; // skips logs ending in ".done"
export function markUndone(path: string): void;                        // rename to <path>.done
```

- [ ] **Step 1: Write failing tests** against a `mkdtemp` dir: round-trip token (file mode `0o600`), scan, selection; `appendUndo` twice then `latestUndo` returns all URIs in order; `markUndone` then `latestUndo` returns `null`; two backups don't overwrite each other; corrupt `scan.json` throws an error naming the path.
- [ ] **Step 2:** run, expect FAIL. **Step 3:** implement with `node:fs` sync APIs. **Step 4:** run, expect PASS.
- [ ] **Step 5:** `git commit -m "feat: add state store"`

### Task 4: Spotify client

**Files:** Create `src/spotify.ts`, `test/spotify.test.ts`

**Interfaces:**
- Consumes: `LikedTrack`.
- Produces:
```ts
export const PAGE_LIMIT = 50;      // GET /me/tracks max limit, reference page
export const LIBRARY_BATCH = 40;   // DELETE/PUT /me/library max uris, reference page
export const MAX_429_RETRIES = 10; // tripwire, guess
export type SpotifyClient = {
  fetchLikedTracks(onProgress: (loaded: number, total: number) => void): Promise<{ tracks: LikedTrack[]; raw: unknown[] }>;
  removeFromLibrary(uris: string[]): Promise<void>; // throws if uris.length > LIBRARY_BATCH
  saveToLibrary(uris: string[]): Promise<void>;
};
export function createSpotifyClient(opts: { getToken: () => Promise<string>; refreshToken: () => Promise<string>; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): SpotifyClient;
```

- [ ] **Step 0:** Check `save-library-items` reference page for its max URIs; update `LIBRARY_BATCH` use if it differs (separate constant).
- [ ] **Step 1: Write failing tests** with a fake `fetch`:
  - Paginates via `next` until null; 120 items → 3 calls, progress `(50,120),(100,120),(120,120)`; first URL has `limit=50&market=from_token`.
  - Maps `external_ids.isrc` → `isrc` (missing → `null`), `is_playable` missing → `true`, `added_at` → `addedAt`, items with `track: null` skipped.
  - `429` with `Retry-After: 3` → sleeps 3000ms then retries; after 10 consecutive 429s throws `"spotify rate limit: 10 retries exhausted on GET /me/tracks, last Retry-After=3s"`.
  - `401` once → calls `refreshToken`, retries with new bearer, succeeds (Review Focus 1).
  - `removeFromLibrary` sends `DELETE /v1/me/library?uris=` comma-joined; 41 URIs throws `"LIBRARY_BATCH=40, got 41"`.
  - Non-2xx other than 401/429 throws with method, path, status, body.
- [ ] **Step 2:** run, expect FAIL. **Step 3:** implement; one internal `request(method, url)` handles auth, 401, 429. **Step 4:** run, expect PASS.
- [ ] **Step 5:** `git commit -m "feat: add spotify client"`

### Task 5: Auth (PKCE, paste-back)

**Files:** Create `src/auth.ts`, `test/auth.test.ts`

**Interfaces:**
- Consumes: `Token`, `readToken`, `writeToken`.
- Produces:
```ts
export function createPkcePair(): { verifier: string; challenge: string }; // S256, verifier 64 chars
export function buildAuthorizeUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string;
export function parseCallbackUrl(pasted: string, expectedState: string): string; // returns code
export function exchangeCode(o: { clientId: string; redirectUri: string; code: string; verifier: string; fetch?: typeof fetch; now?: () => number }): Promise<Token>;
export function refresh(o: { clientId: string; token: Token; fetch?: typeof fetch; now?: () => number }): Promise<Token>; // keeps old refreshToken if none returned
export function tokenProvider(o: { dir: string; clientId: string; fetch?: typeof fetch; now?: () => number }): { getToken(): Promise<string>; refreshToken(): Promise<string> }; // refreshes when expiresAt - 60_000 < now, persists
```

- [ ] **Step 1: Write failing tests:** challenge is base64url SHA-256 of verifier; authorize URL contains `response_type=code`, `code_challenge_method=S256`, both scopes, state; `parseCallbackUrl` returns code, throws `"login denied: access_denied"`, `"state mismatch: expected <a>, got <b>"`, `"no code in pasted URL"` (Review Focus 5); `exchangeCode` posts form body with `grant_type=authorization_code` and `code_verifier`, sets `expiresAt = now + expires_in*1000`; `tokenProvider` refreshes an expired token and writes it.
- [ ] **Step 2:** run, expect FAIL. **Step 3:** implement with Web Crypto. **Step 4:** run, expect PASS.
- [ ] **Step 5:** `git commit -m "feat: add PKCE login with paste-back"`

### Task 6: Apply and undo

**Files:** Create `src/apply.ts`, `test/apply.test.ts`

**Interfaces:**
- Consumes: `SpotifyClient`, store functions, `LIBRARY_BATCH`.
- Produces:
```ts
export const MAX_SCAN_AGE_MS = 24 * 60 * 60 * 1000; // tripwire, guess
export function applySelection(o: { client: SpotifyClient; dir: string; now: Date; onProgress: (done: number, total: number) => void }): Promise<{ removed: number; undoPath: string }>;
export function undoLast(o: { client: SpotifyClient; dir: string; onProgress: (done: number, total: number) => void }): Promise<{ restored: number }>;
```

- [ ] **Step 1: Write failing tests** with a fake client recording calls:
  - No `selection.json` → throws `"no approved selection: run spotify-deduper review first"`.
  - Selection whose `scannedAt` differs from `scan.json` → throws naming both.
  - Scan 25h old → throws `"scan is 25h old, MAX_SCAN_AGE=24h: run spotify-deduper scan again"` (Review Focus 3).
  - Selection containing a keeper URI → throws naming the URI (never unlike a keeper).
  - 90 URIs → 3 remove calls (40, 40, 10); undo log holds all 90; `selection.appliedAt` set.
  - Second apply → throws `"selection already applied at <iso>"` (Review Focus 4).
  - Client throws on batch 2 → undo log holds batches 1 and 2 (80 URIs), error propagates (Review Focus 2).
  - `undoLast` re-saves undo log URIs in batches of 40, then `latestUndo` is `null`; nothing to undo → throws `"nothing to undo"`.
- [ ] **Step 2:** run, expect FAIL. **Step 3:** implement; append to undo log *before* each remove call. **Step 4:** run, expect PASS.
- [ ] **Step 5:** `git commit -m "feat: apply selection and undo"`

### Task 7: Review screen

**Files:** Create `src/review/state.ts`, `src/review/Review.tsx`, `src/ui/Progress.tsx`, `test/review-state.test.ts`, `test/review.test.tsx`

**Interfaces:**
- Consumes: `DuplicateGroup`.
- Produces:
```ts
export type ReviewState = { groups: DuplicateGroup[]; unchecked: Set<string>; cursor: number; expanded: string | null; trackCursor: number; filter: string; filtering: boolean };
export type ReviewAction = { type: "down" | "up" | "toggle" | "enter" | "back" | "startFilter" | "endFilter" } | { type: "filterInput"; text: string };
export function initReview(groups: DuplicateGroup[]): ReviewState;
export function reviewReducer(s: ReviewState, a: ReviewAction): ReviewState;
export function visibleGroups(s: ReviewState): DuplicateGroup[];   // filter on artist or title, case-insensitive
export function selectedUris(s: ReviewState): string[];            // all others minus unchecked
export function Review(p: { groups: DuplicateGroup[]; onApprove: (uris: string[]) => void; onQuit: () => void }): JSX.Element;
export function Progress(p: { label: string; done: number; total: number }): JSX.Element;
```

- [ ] **Step 1: Write failing reducer tests:** init → all others selected; `toggle` on a group unchecks all its others, again rechecks; `enter` then `down` then `toggle` unchecks one track only; keeper can't be unchecked (`trackCursor` skips it); `filterInput "walker"` limits `visibleGroups`; cursor clamps at both ends and after filtering.
- [ ] **Step 2: Write failing render test** (`ink-testing-library`): header shows `3 groups · 4 to unlike · 0 unchecked`; keeper row shows `keep` and its date; `no-playable` group shows `no playable version`; `oldest-playable` keeper shows `oldest version unplayable`; pressing `a` shows confirm text containing `undo can't restore date added`; `y` calls `onApprove` with `selectedUris`; `q` calls `onQuit`.
- [ ] **Step 3:** run, expect FAIL. **Step 4:** implement. Keys: `j`/`k`/arrows, `space`, `enter`/`esc`, `/`, `a`, `y`/`n`, `q`. Render only the rows that fit `stdout.rows` around the cursor (500+ groups must stay responsive).
- [ ] **Step 5:** run, expect PASS. **Step 6:** `git commit -m "feat: add review screen"`

### Task 8: CLI wiring, README, end-to-end

**Files:** Create `src/cli.tsx`, `README.md`, `test/e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `runCommand(cmd: string, deps: { dir: string; client: SpotifyClient; now: () => Date; prompt: (q: string) => Promise<string> }): Promise<number>` (exit code), plus `#!/usr/bin/env bun` entry calling it with real deps.

- [ ] **Step 1: Write failing e2e test** with fake client (10 tracks, 2 duplicate groups) and temp dir: `scan` writes backup + scan.json; write a selection like `review` would; `apply` removes 3 URIs; `undo` re-saves the same 3. Unknown command → exit 1 and usage text listing the four commands.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: Implement.** `scan`: login if no token (print authorize URL, `prompt("paste the URL you landed on: ")`), fetch with `Progress`, write backup, group, write scan, print `<n> tracks, <g> groups, <u> to unlike`; if no track had an ISRC print `ISRC missing from API: matching on artist + title only`. `review`: needs scan.json, renders `Review`, on approve writes selection then runs apply. `apply`/`undo`: render `Progress`, print result and undo path. Missing `SPOTIFY_CLIENT_ID` → exit 1 naming the variable.
- [ ] **Step 4:** run all tests, expect PASS. `bunx tsc --noEmit` clean.
- [ ] **Step 5: README:** create a Spotify app (owner needs Premium), add redirect `http://127.0.0.1:8888/callback`, add own account under users, `export SPOTIFY_CLIENT_ID=...`, then `scan` → `review` → `undo` if needed, with the date-added caveat.
- [ ] **Step 6: Manual check with the real account** (João runs it): `scan`, confirm ISRC present and group count looks sane, `review` and quit without applying.
- [ ] **Step 7:** `git commit -m "feat: wire cli commands and document setup"`
