import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendUndo,
  latestUndo,
  markUndone,
  readScan,
  readSelection,
  readToken,
  startUndoLog,
  writeBackup,
  writeScan,
  writeSelection,
  writeToken,
} from "../src/store";
import type { ScanResult, Selection } from "../src/types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deduper-"));
});

test("token round-trips with mode 600", () => {
  expect(readToken(dir)).toBeNull();
  const token = { accessToken: "a", refreshToken: "r", expiresAt: 123 };
  writeToken(dir, token);
  expect(readToken(dir)).toEqual(token);
  expect(statSync(join(dir, "token.json")).mode & 0o777).toBe(0o600);
});

test("scan and selection round-trip", () => {
  const scan: ScanResult = { version: 1, scannedAt: "2026-11-03T00:00:00Z", trackCount: 0, isrcAvailable: true, groups: [] };
  const selection: Selection = { scannedAt: scan.scannedAt, createdAt: scan.scannedAt, uris: ["u1"], appliedAt: null };
  expect(readScan(dir)).toBeNull();
  writeScan(dir, scan);
  writeSelection(dir, selection);
  expect(readScan(dir)).toEqual(scan);
  expect(readSelection(dir)).toEqual(selection);
});

test("corrupt scan file throws naming the path", () => {
  writeFileSync(join(dir, "scan.json"), "{not json");
  expect(() => readScan(dir)).toThrow(join(dir, "scan.json"));
});

test("backups never overwrite each other", () => {
  const at = new Date("2026-11-03T12:00:00Z");
  const first = writeBackup(dir, [{ a: 1 }], at);
  const second = writeBackup(dir, [{ a: 2 }], at);
  expect(first).not.toBe(second);
  expect(readdirSync(join(dir, "backups"))).toHaveLength(2);
});

test("undo log appends in order and is retired by markUndone", () => {
  const path = startUndoLog(dir, new Date("2026-11-03T12:00:00Z"));
  appendUndo(path, ["u1", "u2"]);
  appendUndo(path, ["u3"]);
  expect(latestUndo(dir)).toEqual({ path, uris: ["u1", "u2", "u3"] });
  markUndone(path);
  expect(latestUndo(dir)).toBeNull();
});

test("latestUndo picks the newest log", () => {
  const older = startUndoLog(dir, new Date("2026-11-01T00:00:00Z"));
  appendUndo(older, ["old"]);
  const newer = startUndoLog(dir, new Date("2026-11-02T00:00:00Z"));
  appendUndo(newer, ["new"]);
  expect(latestUndo(dir)?.uris).toEqual(["new"]);
});
