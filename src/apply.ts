import { LIBRARY_BATCH, type SpotifyClient } from "./spotify";
import { appendUndo, latestUndo, markUndone, readScan, readSelection, startUndoLog, writeSelection } from "./store";

// Tripwire, not measured: likes change on his phone; a day-old scan is too stale to trust.
export const MAX_SCAN_AGE_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export async function applySelection(o: {
  client: SpotifyClient;
  dir: string;
  now: Date;
  onProgress: (done: number, total: number) => void;
}): Promise<{ removed: number; undoPath: string }> {
  const selection = readSelection(o.dir);
  if (!selection) throw new Error("no approved selection: run spotify-deduper review first");
  if (selection.appliedAt) throw new Error(`selection already applied at ${selection.appliedAt}`);

  const scan = readScan(o.dir);
  if (!scan) throw new Error("no scan: run spotify-deduper scan");
  if (scan.scannedAt !== selection.scannedAt) {
    throw new Error(
      `selection was made from scan ${selection.scannedAt} but scan.json is from ${scan.scannedAt}: run spotify-deduper review again`,
    );
  }
  const ageMs = o.now.getTime() - new Date(scan.scannedAt).getTime();
  if (ageMs > MAX_SCAN_AGE_MS) {
    throw new Error(
      `scan is ${Math.floor(ageMs / HOUR_MS)}h old, MAX_SCAN_AGE=${MAX_SCAN_AGE_MS / HOUR_MS}h: run spotify-deduper scan again`,
    );
  }

  const duplicates = new Set(scan.groups.flatMap((g) => g.others.map((t) => t.uri)));
  const notDuplicate = selection.uris.find((uri) => !duplicates.has(uri));
  if (notDuplicate) throw new Error(`selection includes ${notDuplicate}, which is not a duplicate in scan.json`);

  const undoPath = startUndoLog(o.dir, o.now);
  let done = 0;
  for (const batch of chunk(selection.uris, LIBRARY_BATCH)) {
    appendUndo(undoPath, batch);
    await o.client.removeFromLibrary(batch);
    done += batch.length;
    o.onProgress(done, selection.uris.length);
  }
  writeSelection(o.dir, { ...selection, appliedAt: o.now.toISOString() });
  return { removed: done, undoPath };
}

export async function undoLast(o: {
  client: SpotifyClient;
  dir: string;
  onProgress: (done: number, total: number) => void;
}): Promise<{ restored: number }> {
  const undo = latestUndo(o.dir);
  if (!undo) throw new Error("nothing to undo");
  let done = 0;
  for (const batch of chunk(undo.uris, LIBRARY_BATCH)) {
    await o.client.saveToLibrary(batch);
    done += batch.length;
    o.onProgress(done, undo.uris.length);
  }
  markUndone(undo.path);
  return { restored: done };
}
