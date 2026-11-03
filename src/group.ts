import { hasVersionTag, normalizeArtist, normalizeTitle } from "./normalize";
import type { DuplicateGroup, KeeperReason, LikedTrack } from "./types";

function byKeeperPreference(a: LikedTrack, b: LikedTrack): number {
  return (
    a.addedAt.localeCompare(b.addedAt) ||
    Number(hasVersionTag(a.name)) - Number(hasVersionTag(b.name)) ||
    a.uri.localeCompare(b.uri)
  );
}

export function pickKeeper(tracks: LikedTrack[]): { keeper: LikedTrack; reason: KeeperReason } {
  const ordered = [...tracks].sort(byKeeperPreference);
  const oldest = ordered[0]!;
  const oldestPlayable = ordered.find((t) => t.isPlayable);
  if (!oldestPlayable) return { keeper: oldest, reason: "no-playable" };
  return {
    keeper: oldestPlayable,
    reason: oldestPlayable === oldest ? "oldest" : "oldest-playable",
  };
}

function looksLikeDifferentSongs(group: LikedTrack[]): boolean {
  const untagged = group.filter((t) => !hasVersionTag(t.name));
  return new Set(untagged.map((t) => t.isrc ?? t.uri)).size > 1;
}

function createUnionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  return { find, union };
}

function linkByKey(tracks: LikedTrack[], keyOf: (t: LikedTrack) => string | null, union: (a: number, b: number) => void) {
  const firstIndexByKey = new Map<string, number>();
  tracks.forEach((t, i) => {
    const key = keyOf(t);
    if (key === null) return;
    const first = firstIndexByKey.get(key);
    if (first === undefined) firstIndexByKey.set(key, i);
    else union(first, i);
  });
}

export function findDuplicateGroups(tracks: LikedTrack[]): DuplicateGroup[] {
  const { find, union } = createUnionFind(tracks.length);
  linkByKey(tracks, (t) => t.isrc, union);
  linkByKey(
    tracks,
    (t) => (t.artists[0] ? `${normalizeArtist(t.artists[0])}\u0000${normalizeTitle(t.name)}` : null),
    union,
  );

  const members = new Map<number, LikedTrack[]>();
  tracks.forEach((t, i) => {
    const root = find(i);
    members.set(root, [...(members.get(root) ?? []), t]);
  });

  return [...members.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const { keeper, reason } = pickKeeper(group);
      return {
        id: keeper.uri,
        keeper,
        others: group.filter((t) => t !== keeper).sort(byKeeperPreference),
        reason,
        suspect: looksLikeDifferentSongs(group),
      };
    })
    .sort(
      (a, b) =>
        normalizeArtist(a.keeper.artists[0] ?? "").localeCompare(normalizeArtist(b.keeper.artists[0] ?? "")) ||
        normalizeTitle(a.keeper.name).localeCompare(normalizeTitle(b.keeper.name)),
    );
}
