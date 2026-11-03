import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand, type CommandDeps } from "../src/commands";
import type { SpotifyClient } from "../src/spotify";
import { readScan, readSelection } from "../src/store";
import type { LikedTrack } from "../src/types";
import { track } from "./fixtures";

const library: LikedTrack[] = [
  track("spotify:track:faded", { name: "Faded", artists: ["Alan Walker"], addedAt: "2017-01-01T00:00:00Z", isrc: "A" }),
  track("spotify:track:faded-remix", { name: "Faded - Remix", artists: ["Alan Walker"], addedAt: "2026-02-01T00:00:00Z", isrc: "B" }),
  track("spotify:track:faded-live", { name: "Faded (Live)", artists: ["Alan Walker"], addedAt: "2026-02-01T00:00:01Z", isrc: "C" }),
  track("spotify:track:hello", { name: "Hello", artists: ["Adele"], addedAt: "2016-01-01T00:00:00Z", isrc: "D" }),
  track("spotify:track:hello-edit", { name: "Hello - Radio Edit", artists: ["Adele"], addedAt: "2026-02-01T00:00:00Z", isrc: "E" }),
  ...["one", "two", "three", "four", "five"].map((n, i) => track(`spotify:track:${n}`, { name: n, isrc: `U${i}` })),
];

let dir: string;
let calls: { removed: string[][]; saved: string[][] };
let output: string[];
let loggedIn: number;

function deps(review: CommandDeps["review"] = async (groups) => groups.flatMap((g) => g.others.map((t) => t.uri))): CommandDeps {
  const client: SpotifyClient = {
    fetchLikedTracks: async (onProgress) => {
      onProgress(library.length, library.length);
      return { tracks: library, raw: library };
    },
    removeFromLibrary: async (uris) => void calls.removed.push(uris),
    saveToLibrary: async (uris) => void calls.saved.push(uris),
  };
  return {
    dir,
    client,
    now: () => new Date("2026-11-03T12:00:00Z"),
    ensureLogin: async () => void loggedIn++,
    review,
    progress: () => {},
    log: (line) => void output.push(line),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deduper-"));
  calls = { removed: [], saved: [] };
  output = [];
  loggedIn = 0;
});

test("scan → review → apply → undo round trip", async () => {
  expect(await runCommand("scan", deps())).toBe(0);
  expect(loggedIn).toBe(1);
  expect(readdirSync(join(dir, "backups"))).toHaveLength(1);
  expect(readScan(dir)?.groups).toHaveLength(2);
  expect(output.join("\n")).toContain("10 tracks, 2 groups, 3 to unlike");

  expect(await runCommand("review", deps())).toBe(0);
  expect(readSelection(dir)?.uris.sort()).toEqual([
    "spotify:track:faded-live",
    "spotify:track:faded-remix",
    "spotify:track:hello-edit",
  ]);
  expect(calls.removed.flat()).toHaveLength(3);

  expect(await runCommand("undo", deps())).toBe(0);
  expect(calls.saved.flat().sort()).toEqual(calls.removed.flat().sort());
});

test("quitting review changes nothing", async () => {
  await runCommand("scan", deps());
  expect(await runCommand("review", deps(async () => null))).toBe(0);
  expect(readSelection(dir)).toBeNull();
  expect(calls.removed).toHaveLength(0);
});

test("standalone apply uses the saved selection", async () => {
  await runCommand("scan", deps());
  await runCommand("review", deps());
  expect(await runCommand("apply", deps())).toBe(1);
  expect(output.at(-1)).toContain("selection already applied at");
});

test("scan warns loudly when ISRC is missing", async () => {
  const noIsrc = deps();
  const original = noIsrc.client.fetchLikedTracks;
  noIsrc.client.fetchLikedTracks = async (p) => {
    const result = await original(p);
    return { ...result, tracks: result.tracks.map((t) => ({ ...t, isrc: null })) };
  };
  await runCommand("scan", noIsrc);
  expect(output.join("\n")).toContain("ISRC missing from API: matching on artist + title only");
  expect(readScan(dir)?.isrcAvailable).toBe(false);
});

test("review without a scan is a named error", async () => {
  expect(await runCommand("review", deps())).toBe(1);
  expect(output.at(-1)).toBe("error: no scan: run spotify-deduper scan");
});

test("unknown command prints usage", async () => {
  expect(await runCommand("nope", deps())).toBe(1);
  const text = output.join("\n");
  for (const cmd of ["scan", "review", "apply", "undo"]) expect(text).toContain(cmd);
});
