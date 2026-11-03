import type { LikedTrack } from "./types";

// https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks (max limit)
export const PAGE_LIMIT = 50;
// https://developer.spotify.com/documentation/web-api/reference/remove-library-items and save-library-items (max uris)
export const LIBRARY_BATCH = 40;
// Tripwire, not measured: consecutive 429s before giving up on one request.
export const MAX_429_RETRIES = 10;

const API = "https://api.spotify.com/v1";

export type SpotifyClient = {
  fetchLikedTracks(onProgress: (loaded: number, total: number) => void): Promise<{ tracks: LikedTrack[]; raw: unknown[] }>;
  removeFromLibrary(uris: string[]): Promise<void>;
  saveToLibrary(uris: string[]): Promise<void>;
};

type SavedTrackItem = {
  added_at: string;
  track: {
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
    external_ids?: { isrc?: string };
    is_playable?: boolean;
    duration_ms: number;
    linked_from?: { uri: string };
  } | null;
};

type SavedTracksPage = { items: SavedTrackItem[]; total: number; next: string | null };

function toLikedTrack(item: SavedTrackItem & { track: NonNullable<SavedTrackItem["track"]> }): LikedTrack {
  const t = item.track;
  return {
    uri: t.linked_from?.uri ?? t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    isrc: t.external_ids?.isrc ?? null,
    addedAt: item.added_at,
    isPlayable: t.is_playable ?? true,
    durationMs: t.duration_ms,
  };
}

export function createSpotifyClient(opts: {
  getToken: () => Promise<string>;
  refreshToken: () => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): SpotifyClient {
  const fetchFn = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));

  async function request(method: string, url: string): Promise<Response> {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    let token = await opts.getToken();
    let refreshed = false;
    let rateLimited = 0;
    while (true) {
      const response = await fetchFn(url, { method, headers: { authorization: `Bearer ${token}` } });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await opts.refreshToken();
        continue;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 1);
        rateLimited += 1;
        if (rateLimited >= MAX_429_RETRIES) {
          throw new Error(
            `spotify rate limit: ${MAX_429_RETRIES} retries exhausted on ${method} ${path}, last Retry-After=${retryAfter}s`,
          );
        }
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`spotify ${method} ${path} failed: ${response.status} ${await response.text()}`);
      }
      return response;
    }
  }

  async function writeLibrary(method: "PUT" | "DELETE", uris: string[]): Promise<void> {
    if (uris.length > LIBRARY_BATCH) throw new Error(`LIBRARY_BATCH=${LIBRARY_BATCH}, got ${uris.length}`);
    const url = new URL(`${API}/me/library`);
    url.searchParams.set("uris", uris.join(","));
    await request(method, url.toString());
  }

  return {
    async fetchLikedTracks(onProgress) {
      const tracks: LikedTrack[] = [];
      const raw: unknown[] = [];
      let next: string | null = `${API}/me/tracks?limit=${PAGE_LIMIT}&market=from_token`;
      while (next) {
        const page = (await (await request("GET", next)).json()) as SavedTracksPage;
        for (const item of page.items) {
          raw.push(item);
          if (item.track) tracks.push(toLikedTrack(item as Parameters<typeof toLikedTrack>[0]));
        }
        onProgress(raw.length, page.total);
        next = page.next;
      }
      return { tracks, raw };
    },
    removeFromLibrary: (uris) => writeLibrary("DELETE", uris),
    saveToLibrary: (uris) => writeLibrary("PUT", uris),
  };
}
