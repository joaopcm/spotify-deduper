import { applySelection, undoLast } from "./apply";
import { findDuplicateGroups } from "./group";
import type { SpotifyClient } from "./spotify";
import { readScan, writeBackup, writeScan, writeSelection } from "./store";
import type { DuplicateGroup } from "./types";

export type CommandDeps = {
  dir: string;
  client: SpotifyClient;
  now: () => Date;
  ensureLogin: () => Promise<void>;
  review: (groups: DuplicateGroup[]) => Promise<string[] | null>;
  progress: (label: string, done: number, total: number) => void;
  log: (line: string) => void;
};

export const USAGE = `usage: spotify-deduper <command>

  scan    fetch liked songs, back them up, find duplicates
  review  browse every duplicate group, approve, and apply
  apply   apply the last approved selection
  undo    re-like everything removed by the last apply`;

async function scan(deps: CommandDeps): Promise<void> {
  await deps.ensureLogin();
  const { tracks, raw } = await deps.client.fetchLikedTracks((done, total) => deps.progress("fetching liked songs", done, total));
  const scannedAt = deps.now();
  const backupPath = writeBackup(deps.dir, raw, scannedAt);
  const groups = findDuplicateGroups(tracks);
  const isrcAvailable = tracks.some((t) => t.isrc !== null);
  writeScan(deps.dir, { version: 1, scannedAt: scannedAt.toISOString(), trackCount: tracks.length, isrcAvailable, groups });

  const toUnlike = groups.reduce((sum, g) => sum + g.others.length, 0);
  deps.log(`backup: ${backupPath}`);
  if (!isrcAvailable && tracks.length > 0) deps.log("ISRC missing from API: matching on artist + title only");
  deps.log(`${tracks.length} tracks, ${groups.length} groups, ${toUnlike} to unlike`);
  if (groups.length > 0) deps.log("next: spotify-deduper review");
}

async function apply(deps: CommandDeps): Promise<void> {
  const { removed, undoPath } = await applySelection({
    client: deps.client,
    dir: deps.dir,
    now: deps.now(),
    onProgress: (done, total) => deps.progress("unliking", done, total),
  });
  deps.log(`unliked ${removed} songs. undo log: ${undoPath}`);
  deps.log("changed your mind? spotify-deduper undo");
}

async function review(deps: CommandDeps): Promise<void> {
  const scanResult = readScan(deps.dir);
  if (!scanResult) throw new Error("no scan: run spotify-deduper scan");
  if (scanResult.groups.length === 0) {
    deps.log("no duplicates found");
    return;
  }
  const uris = await deps.review(scanResult.groups);
  if (uris === null) {
    deps.log("quit without changes");
    return;
  }
  writeSelection(deps.dir, { scannedAt: scanResult.scannedAt, createdAt: deps.now().toISOString(), uris, appliedAt: null });
  await apply(deps);
}

async function undo(deps: CommandDeps): Promise<void> {
  const { restored } = await undoLast({
    client: deps.client,
    dir: deps.dir,
    onProgress: (done, total) => deps.progress("re-liking", done, total),
  });
  deps.log(`re-liked ${restored} songs (date added is now today for these)`);
}

const COMMANDS: Record<string, (deps: CommandDeps) => Promise<void>> = { scan, review, apply, undo };

export async function runCommand(cmd: string | undefined, deps: CommandDeps): Promise<number> {
  const command = cmd ? COMMANDS[cmd] : undefined;
  if (!command) {
    deps.log(USAGE);
    return 1;
  }
  try {
    await command(deps);
    return 0;
  } catch (error) {
    deps.log(`error: ${(error as Error).message}`);
    return 1;
  }
}
