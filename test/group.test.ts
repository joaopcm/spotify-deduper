import { describe, expect, test } from "bun:test";
import { findDuplicateGroups, pickKeeper } from "../src/group";
import type { LikedTrack } from "../src/types";

let counter = 0;
function track(overrides: Partial<LikedTrack> = {}): LikedTrack {
  counter += 1;
  return {
    uri: `spotify:track:${String(counter).padStart(4, "0")}`,
    name: "Faded",
    artists: ["Alan Walker"],
    album: "Different World",
    isrc: null,
    addedAt: "2020-01-01T00:00:00Z",
    isPlayable: true,
    durationMs: 200_000,
    ...overrides,
  };
}

describe("findDuplicateGroups", () => {
  test("original and remix by same artist form one group, oldest kept", () => {
    const original = track({ addedAt: "2017-05-01T00:00:00Z" });
    const remix = track({ name: "Faded - Remix", addedAt: "2026-02-01T00:00:00Z" });
    const groups = findDuplicateGroups([remix, original]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keeper.uri).toBe(original.uri);
    expect(groups[0]!.others.map((t) => t.uri)).toEqual([remix.uri]);
    expect(groups[0]!.reason).toBe("oldest");
    expect(groups[0]!.id).toBe(original.uri);
  });

  test("same ISRC with different titles is one group", () => {
    const a = track({ name: "Song A", isrc: "USX1" });
    const b = track({ name: "Totally Different", isrc: "USX1" });
    expect(findDuplicateGroups([a, b])).toHaveLength(1);
  });

  test("same title by different artists is never a group", () => {
    const a = track({ artists: ["Alan Walker"] });
    const b = track({ artists: ["ZHU"] });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  test("grouping is transitive across ISRC and title links", () => {
    const a = track({ name: "Faded", isrc: "ISRC1" });
    const b = track({ name: "Faded Other Name", artists: ["Someone"], isrc: "ISRC1" });
    const c = track({ name: "Faded Other Name (Live)", artists: ["Someone"] });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.others).toHaveLength(2);
  });

  test("singletons produce no group", () => {
    expect(findDuplicateGroups([track({ name: "One" }), track({ name: "Two" })])).toEqual([]);
  });

  test("tracks without artists only match by ISRC", () => {
    const a = track({ artists: [] });
    const b = track({ artists: [] });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  test("groups are sorted by keeper artist then title", () => {
    const groups = findDuplicateGroups([
      track({ artists: ["Zed"], name: "B" }),
      track({ artists: ["Zed"], name: "B (Live)" }),
      track({ artists: ["Abba"], name: "Waterloo" }),
      track({ artists: ["Abba"], name: "Waterloo - Remix" }),
      track({ artists: ["Zed"], name: "A" }),
      track({ artists: ["Zed"], name: "A - Edit" }),
    ]);
    expect(groups.map((g) => `${g.keeper.artists[0]}/${g.keeper.name}`)).toEqual([
      "Abba/Waterloo",
      "Zed/A",
      "Zed/B",
    ]);
  });
});

describe("pickKeeper", () => {
  test("skips an unplayable oldest version", () => {
    const old = track({ addedAt: "2015-01-01T00:00:00Z", isPlayable: false });
    const playable = track({ name: "Faded - Remix", addedAt: "2026-01-01T00:00:00Z" });
    const result = pickKeeper([old, playable]);
    expect(result.keeper.uri).toBe(playable.uri);
    expect(result.reason).toBe("oldest-playable");
  });

  test("keeps oldest and flags when nothing is playable", () => {
    const old = track({ addedAt: "2015-01-01T00:00:00Z", isPlayable: false });
    const newer = track({ addedAt: "2026-01-01T00:00:00Z", isPlayable: false });
    const result = pickKeeper([newer, old]);
    expect(result.keeper.uri).toBe(old.uri);
    expect(result.reason).toBe("no-playable");
  });

  test("tie on addedAt prefers untagged title, then lower uri", () => {
    const at = "2020-01-01T00:00:00Z";
    const tagged = track({ name: "Faded - Remix", addedAt: at, uri: "spotify:track:a" });
    const plain = track({ name: "Faded", addedAt: at, uri: "spotify:track:b" });
    expect(pickKeeper([tagged, plain]).keeper.uri).toBe(plain.uri);

    const x = track({ addedAt: at, uri: "spotify:track:y" });
    const y = track({ addedAt: at, uri: "spotify:track:x" });
    expect(pickKeeper([x, y]).keeper.uri).toBe("spotify:track:x");
  });
});

describe("suspect groups", () => {
  test("two untagged titles with different ISRCs are flagged as possibly different songs", () => {
    const a = track({ name: "Intro", isrc: "X1", album: "First" });
    const b = track({ name: "Intro", isrc: "X2", album: "Second" });
    expect(findDuplicateGroups([a, b])[0]!.suspect).toBe(true);
  });

  test("original plus tagged version is not suspect", () => {
    const a = track({ name: "Faded", isrc: "X1" });
    const b = track({ name: "Faded - Remix", isrc: "X2" });
    expect(findDuplicateGroups([a, b])[0]!.suspect).toBe(false);
  });

  test("same ISRC is never suspect", () => {
    const a = track({ name: "Intro", isrc: "X1" });
    const b = track({ name: "Intro", isrc: "X1" });
    expect(findDuplicateGroups([a, b])[0]!.suspect).toBe(false);
  });
});
