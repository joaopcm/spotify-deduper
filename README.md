# spotify-deduper

finds songs in your Spotify Liked Songs that are liked more than once in different versions (remix, live, radio edit, same recording on another album), shows every group in a terminal UI, and unlikes the extras after you approve.

it keeps the version you liked first. if that one can't be played anymore, it keeps the oldest one you can play.

## setup

1. create an app at https://developer.spotify.com/dashboard. the app owner needs Spotify Premium (development mode rule since Feb 2026).
2. in the app settings:
   - redirect URI: `http://127.0.0.1:8888/callback`
   - APIs used: Web API
   - User Management: add the email of the Spotify account you want to clean
3. copy the client id, then:

```sh
bun install
export SPOTIFY_CLIENT_ID=<client id>
```

no client secret is needed (PKCE).

## usage

```sh
bun src/cli.tsx scan     # login on first run, back up every liked song, find duplicates
bun src/cli.tsx review   # browse all groups, approve, apply
bun src/cli.tsx undo     # re-like everything the last apply removed
```

`bun link` makes it available as `spotify-deduper`.

### login on a machine without a browser

`scan` prints a URL. open it on any device, approve, and the browser lands on `http://127.0.0.1:8888/callback?code=...` with an error page. that's expected: copy that URL from the address bar and paste it into the terminal.

### review keys

| key | does |
| --- | --- |
| `j` `k` / arrows | move |
| `space` | toggle a whole group, or one track inside an open group |
| `enter` / `esc` | open / close a group |
| `/` | filter by artist or title |
| `a` | apply (asks `y`/`n` first) |
| `q` | quit without changes |

groups in yellow need a look: the oldest version can't be played, nothing in the group can be played, or two plain titles have different recordings (`maybe different songs, check`, e.g. two different "Intro" tracks by one artist).

## safety

- `scan` writes a full backup of every liked song to `backups/` before anything else.
- `apply` only runs on a selection you approved in `review`, refuses a scan older than 24h, refuses to run twice, and never unlikes the version marked `keep`.
- every unliked song is written to `undo/` before the call that removes it, so `undo` works even if apply crashes halfway.
- undo can't restore the original date added. re-liked songs show up at the top of Liked Songs.

state lives in `~/.config/spotify-deduper/` (override with `SPOTIFY_DEDUPER_HOME`).

## how duplicates are matched

two liked tracks are the same song when they share an ISRC (same recording), or when they have the same first artist and the same title after dropping version tags like `- Remix`, `(Live)`, `[feat. ...]`, `- Remastered 2019`. same title by a different artist is never a match.

## development

```sh
bun test
bun run typecheck
```
