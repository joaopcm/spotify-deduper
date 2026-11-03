import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySelection, undoLast } from "../src/apply";
import type { SpotifyClient } from "../src/spotify";
import { latestUndo, readSelection, writeScan, writeSelection } from "../src/store";
import type { DuplicateGroup, LikedTrack, ScanResult } from "../src/types";

const SCANNED_AT = "2026-11-03T10:00:00.000Z";
const NOW = new Date("2026-11-03T11:00:00.000Z");

function track(uri: string): LikedTrack {
  return { uri, name: uri, artists: ["A"], album: "", isrc: null, addedAt: SCANNED_AT, isPlayable: true, durationMs: 0 };
}

function fakeClient(failOnRemoveCall?: number) {
  const removed: string[][] = [];
  const saved: string[][] = [];
  const client: SpotifyClient = {
    fetchLikedTracks: async () => ({ tracks: [], raw: [] }),
    removeFromLibrary: async (uris) => {
      removed.push(uris);
      if (removed.length === failOnRemoveCall) throw new Error("boom");
    },
    saveToLibrary: async (uris) => void saved.push(uris),
  };
  return { client, removed, saved };
}

let dir: string;
const others = Array.from({ length: 90 }, (_, i) => track(`spotify:track:dup${i}`));
const group: DuplicateGroup = { id: "spotify:track:keep", keeper: track("spotify:track:keep"), others, reason: "oldest", suspect: false };

function setup(overrides: { scannedAt?: string; uris?: string[]; appliedAt?: string | null } = {}) {
  const scan: ScanResult = { version: 1, scannedAt: overrides.scannedAt ?? SCANNED_AT, trackCount: 91, isrcAvailable: true, groups: [group] };
  writeScan(dir, scan);
  writeSelection(dir, {
    scannedAt: SCANNED_AT,
    createdAt: SCANNED_AT,
    uris: overrides.uris ?? others.map((t) => t.uri),
    appliedAt: overrides.appliedAt ?? null,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deduper-"));
});

describe("applySelection guards", () => {
  test("refuses without a selection", async () => {
    const { client } = fakeClient();
    await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow(
      "no approved selection: run spotify-deduper review first",
    );
  });

  test("refuses a selection made from a different scan", async () => {
    setup({ scannedAt: "2026-11-03T09:00:00.000Z" });
    const { client } = fakeClient();
    await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow(
      `selection was made from scan ${SCANNED_AT} but scan.json is from 2026-11-03T09:00:00.000Z: run spotify-deduper review again`,
    );
  });

  test("refuses a scan older than 24h", async () => {
    setup();
    const { client } = fakeClient();
    const later = new Date(new Date(SCANNED_AT).getTime() + 25 * 3_600_000);
    await expect(applySelection({ client, dir, now: later, onProgress: () => {} })).rejects.toThrow(
      "scan is 25h old, MAX_SCAN_AGE=24h: run spotify-deduper scan again",
    );
  });

  test("refuses to unlike a keeper", async () => {
    setup({ uris: ["spotify:track:keep"] });
    const { client, removed } = fakeClient();
    await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow(
      "selection includes spotify:track:keep, which is not a duplicate in scan.json",
    );
    expect(removed).toHaveLength(0);
  });

  test("refuses a selection that was already applied", async () => {
    setup({ appliedAt: "2026-11-03T10:30:00.000Z" });
    const { client } = fakeClient();
    await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow(
      "selection already applied at 2026-11-03T10:30:00.000Z",
    );
  });
});

describe("applySelection", () => {
  test("removes in batches of 40, logs every uri, marks applied", async () => {
    setup();
    const { client, removed } = fakeClient();
    const progress: Array<[number, number]> = [];
    const result = await applySelection({ client, dir, now: NOW, onProgress: (d, t) => progress.push([d, t]) });
    expect(removed.map((b) => b.length)).toEqual([40, 40, 10]);
    expect(result.removed).toBe(90);
    expect(latestUndo(dir)?.uris).toEqual(others.map((t) => t.uri));
    expect(readSelection(dir)?.appliedAt).toBe(NOW.toISOString());
    expect(progress.at(-1)).toEqual([90, 90]);
  });

  test("crash mid-apply leaves the in-flight batch in the undo log", async () => {
    setup();
    const { client } = fakeClient(2);
    await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow("boom");
    expect(latestUndo(dir)?.uris).toHaveLength(80);
    expect(readSelection(dir)?.appliedAt).toBeNull();
  });
});

describe("undoLast", () => {
  test("re-saves the last applied uris and retires the log", async () => {
    setup();
    const { client, saved } = fakeClient();
    await applySelection({ client, dir, now: NOW, onProgress: () => {} });
    const result = await undoLast({ client, dir, onProgress: () => {} });
    expect(saved.map((b) => b.length)).toEqual([40, 40, 10]);
    expect(saved.flat()).toEqual(others.map((t) => t.uri));
    expect(result.restored).toBe(90);
    expect(latestUndo(dir)).toBeNull();
  });

  test("nothing to undo is a named error", async () => {
    const { client } = fakeClient();
    await expect(undoLast({ client, dir, onProgress: () => {} })).rejects.toThrow("nothing to undo");
  });
});

test("an empty selection is refused and creates no undo log", async () => {
  setup({ uris: [] });
  const { client } = fakeClient();
  await expect(applySelection({ client, dir, now: NOW, onProgress: () => {} })).rejects.toThrow("selection is empty: nothing to unlike");
  expect(latestUndo(dir)).toBeNull();
});
