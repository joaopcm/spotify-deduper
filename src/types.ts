export type LikedTrack = {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  isrc: string | null;
  addedAt: string;
  isPlayable: boolean;
  durationMs: number;
};

export type KeeperReason = "oldest" | "oldest-playable" | "no-playable";

export type DuplicateGroup = {
  id: string;
  keeper: LikedTrack;
  others: LikedTrack[];
  reason: KeeperReason;
  suspect: boolean;
};

export type ScanResult = {
  version: 1;
  scannedAt: string;
  trackCount: number;
  isrcAvailable: boolean;
  groups: DuplicateGroup[];
};

export type Selection = {
  scannedAt: string;
  createdAt: string;
  uris: string[];
  appliedAt: string | null;
};
