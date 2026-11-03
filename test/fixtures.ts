import type { DuplicateGroup, KeeperReason, LikedTrack } from "../src/types";

export function track(uri: string, overrides: Partial<LikedTrack> = {}): LikedTrack {
  return {
    uri,
    name: uri,
    artists: ["Artist"],
    album: "Album",
    isrc: null,
    addedAt: "2020-01-01T00:00:00Z",
    isPlayable: true,
    durationMs: 0,
    ...overrides,
  };
}

export function group(keeper: LikedTrack, others: LikedTrack[], reason: KeeperReason = "oldest"): DuplicateGroup {
  return { id: keeper.uri, keeper, others, reason };
}

export const sampleGroups: DuplicateGroup[] = [
  group(track("k1", { name: "Faded", artists: ["Alan Walker"], addedAt: "2017-05-01T00:00:00Z" }), [
    track("o1a", { name: "Faded - Remix", artists: ["Alan Walker"] }),
    track("o1b", { name: "Faded (Live)", artists: ["Alan Walker"] }),
  ]),
  group(
    track("k2", { name: "Hello", artists: ["Adele"], isPlayable: false }),
    [track("o2", { name: "Hello - Live", artists: ["Adele"], isPlayable: false })],
    "no-playable",
  ),
  group(
    track("k3", { name: "Yellow - Live", artists: ["Coldplay"] }),
    [track("o3", { name: "Yellow", artists: ["Coldplay"], isPlayable: false })],
    "oldest-playable",
  ),
];
