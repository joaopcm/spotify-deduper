import { describe, expect, test } from "bun:test";
import { createSpotifyClient } from "../src/spotify";

type Call = { method: string; url: string; auth: string | null };

function apiItem(i: number, overrides: Record<string, unknown> = {}) {
  return {
    added_at: `2020-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    track: {
      uri: `spotify:track:${i}`,
      name: `Song ${i}`,
      artists: [{ name: "Artist" }],
      album: { name: "Album" },
      external_ids: { isrc: `ISRC${i}` },
      is_playable: true,
      duration_ms: 1000,
      ...overrides,
    },
  };
}

function fakeApi(handler: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { calls, sleeps, fetchFn, sleep: async (ms: number) => void sleeps.push(ms) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(api: ReturnType<typeof fakeApi>, refreshToken = async () => "fresh") {
  return createSpotifyClient({ getToken: async () => "tok", refreshToken, fetch: api.fetchFn, sleep: api.sleep });
}

describe("fetchLikedTracks", () => {
  test("paginates until next is null and reports progress", async () => {
    const items = Array.from({ length: 120 }, (_, i) => apiItem(i));
    const api = fakeApi((call) => {
      const offset = Number(new URL(call.url).searchParams.get("offset") ?? 0);
      const next = offset + 50 < 120 ? `https://api.spotify.com/v1/me/tracks?offset=${offset + 50}&limit=50&market=from_token` : null;
      return json({ items: items.slice(offset, offset + 50), total: 120, next });
    });
    const progress: Array<[number, number]> = [];
    const { tracks, raw } = await client(api).fetchLikedTracks((loaded, total) => progress.push([loaded, total]));
    expect(api.calls).toHaveLength(3);
    expect(api.calls[0]!.url).toContain("limit=50");
    expect(api.calls[0]!.url).toContain("market=from_token");
    expect(progress).toEqual([[50, 120], [100, 120], [120, 120]]);
    expect(tracks).toHaveLength(120);
    expect(raw).toHaveLength(120);
  });

  test("maps fields, defaults and skips null tracks", async () => {
    const noIsrc = apiItem(1, { external_ids: {}, is_playable: undefined });
    const api = fakeApi(() => json({ items: [noIsrc, { added_at: "x", track: null }, apiItem(2)], total: 3, next: null }));
    const { tracks } = await client(api).fetchLikedTracks(() => {});
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toEqual({
      uri: "spotify:track:1",
      name: "Song 1",
      artists: ["Artist"],
      album: "Album",
      isrc: null,
      addedAt: "2020-01-01T00:00:01Z",
      isPlayable: true,
      durationMs: 1000,
    });
    expect(tracks[1]!.isrc).toBe("ISRC2");
  });

  test("waits Retry-After on 429 then retries", async () => {
    const api = fakeApi((_, n) => (n === 1 ? json({}, 429, { "retry-after": "3" }) : json({ items: [], total: 0, next: null })));
    await client(api).fetchLikedTracks(() => {});
    expect(api.sleeps).toEqual([3000]);
    expect(api.calls).toHaveLength(2);
  });

  test("gives up after 10 consecutive 429s with a named error", async () => {
    const api = fakeApi(() => json({}, 429, { "retry-after": "3" }));
    await expect(client(api).fetchLikedTracks(() => {})).rejects.toThrow(
      "spotify rate limit: 10 retries exhausted on GET /me/tracks, last Retry-After=3s",
    );
  });

  test("refreshes the token once on 401 and continues", async () => {
    const api = fakeApi((_, n) => (n === 1 ? json({}, 401) : json({ items: [], total: 0, next: null })));
    await client(api).fetchLikedTracks(() => {});
    expect(api.calls.map((c) => c.auth)).toEqual(["Bearer tok", "Bearer fresh"]);
  });

  test("other errors name method, path, status and body", async () => {
    const api = fakeApi(() => new Response("nope", { status: 500 }));
    await expect(client(api).fetchLikedTracks(() => {})).rejects.toThrow("spotify GET /me/tracks failed: 500 nope");
  });
});

describe("library writes", () => {
  test("removeFromLibrary sends DELETE /me/library with comma-joined uris", async () => {
    const api = fakeApi(() => new Response(null, { status: 200 }));
    await client(api).removeFromLibrary(["spotify:track:1", "spotify:track:2"]);
    expect(api.calls[0]!.method).toBe("DELETE");
    const url = new URL(api.calls[0]!.url);
    expect(url.pathname).toBe("/v1/me/library");
    expect(url.searchParams.get("uris")).toBe("spotify:track:1,spotify:track:2");
  });

  test("saveToLibrary sends PUT /me/library", async () => {
    const api = fakeApi(() => new Response(null, { status: 200 }));
    await client(api).saveToLibrary(["spotify:track:1"]);
    expect(api.calls[0]!.method).toBe("PUT");
  });

  test("rejects more than 40 uris per call", async () => {
    const api = fakeApi(() => new Response(null, { status: 200 }));
    const uris = Array.from({ length: 41 }, (_, i) => `spotify:track:${i}`);
    await expect(client(api).removeFromLibrary(uris)).rejects.toThrow("LIBRARY_BATCH=40, got 41");
    expect(api.calls).toHaveLength(0);
  });
});
