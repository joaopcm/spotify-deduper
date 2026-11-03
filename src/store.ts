import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ScanResult, Selection } from "./types";

export type Token = { accessToken: string; refreshToken: string; expiresAt: number };

const UNDO_DONE_SUFFIX = ".done";

export function stateDir(): string {
  const dir = process.env.SPOTIFY_DEDUPER_HOME ?? join(homedir(), ".config", "spotify-deduper");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`could not read ${path}: ${(error as Error).message}`);
  }
}

function writeJson(path: string, value: unknown, mode = 0o644): void {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode });
}

function fileStamp(at: Date): string {
  return at.toISOString().replaceAll(":", "-");
}

function uniquePath(dir: string, base: string, extension: string): string {
  let path = join(dir, `${base}${extension}`);
  for (let n = 1; existsSync(path); n++) path = join(dir, `${base}-${n}${extension}`);
  return path;
}

export function readToken(dir: string): Token | null {
  return readJson<Token>(join(dir, "token.json"));
}

export function writeToken(dir: string, token: Token): void {
  writeJson(join(dir, "token.json"), token, 0o600);
}

export function writeBackup(dir: string, raw: unknown[], at: Date): string {
  const backups = join(dir, "backups");
  mkdirSync(backups, { recursive: true });
  const path = uniquePath(backups, fileStamp(at), ".json");
  writeJson(path, raw);
  return path;
}

export function readScan(dir: string): ScanResult | null {
  return readJson<ScanResult>(join(dir, "scan.json"));
}

export function writeScan(dir: string, scan: ScanResult): void {
  writeJson(join(dir, "scan.json"), scan);
}

export function readSelection(dir: string): Selection | null {
  return readJson<Selection>(join(dir, "selection.json"));
}

export function writeSelection(dir: string, selection: Selection): void {
  writeJson(join(dir, "selection.json"), selection);
}

export function startUndoLog(dir: string, at: Date): string {
  const undoDir = join(dir, "undo");
  mkdirSync(undoDir, { recursive: true });
  const path = uniquePath(undoDir, fileStamp(at), ".log");
  writeFileSync(path, "");
  return path;
}

export function appendUndo(path: string, uris: string[]): void {
  appendFileSync(path, uris.map((uri) => `${uri}\n`).join(""));
  const fd = openSync(path, "r");
  fsyncSync(fd);
  closeSync(fd);
}

export function latestUndo(dir: string): { path: string; uris: string[] } | null {
  const undoDir = join(dir, "undo");
  if (!existsSync(undoDir)) return null;
  const newest = readdirSync(undoDir)
    .filter((name) => name.endsWith(".log"))
    .sort()
    .at(-1);
  if (!newest) return null;
  const path = join(undoDir, newest);
  const uris = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return { path, uris };
}

export function markUndone(path: string): void {
  renameSync(path, `${path}${UNDO_DONE_SUFFIX}`);
}
