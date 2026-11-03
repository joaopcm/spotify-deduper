import type { DuplicateGroup } from "../types";

export type ReviewState = {
  groups: DuplicateGroup[];
  unchecked: Set<string>;
  cursor: number;
  expanded: string | null;
  trackCursor: number;
  filter: string;
  filtering: boolean;
};

export type ReviewAction =
  | { type: "down" | "up" | "toggle" | "enter" | "back" | "startFilter" | "endFilter" }
  | { type: "filterInput"; text: string };

export function initReview(groups: DuplicateGroup[]): ReviewState {
  return { groups, unchecked: new Set(), cursor: 0, expanded: null, trackCursor: 0, filter: "", filtering: false };
}

export function visibleGroups(s: ReviewState): DuplicateGroup[] {
  const needle = s.filter.trim().toLowerCase();
  if (!needle) return s.groups;
  return s.groups.filter((g) =>
    [g.keeper, ...g.others].some(
      (t) => t.name.toLowerCase().includes(needle) || t.artists.some((a) => a.toLowerCase().includes(needle)),
    ),
  );
}

export function selectedUris(s: ReviewState): string[] {
  return s.groups.flatMap((g) => g.others.map((t) => t.uri)).filter((uri) => !s.unchecked.has(uri));
}

export function currentGroup(s: ReviewState): DuplicateGroup | undefined {
  return visibleGroups(s)[s.cursor];
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

function toggleGroup(s: ReviewState, group: DuplicateGroup): Set<string> {
  const unchecked = new Set(s.unchecked);
  const uris = group.others.map((t) => t.uri);
  const allChecked = uris.every((uri) => !unchecked.has(uri));
  for (const uri of uris) {
    if (allChecked) unchecked.add(uri);
    else unchecked.delete(uri);
  }
  return unchecked;
}

function toggleTrack(s: ReviewState, uri: string): Set<string> {
  const unchecked = new Set(s.unchecked);
  if (unchecked.has(uri)) unchecked.delete(uri);
  else unchecked.add(uri);
  return unchecked;
}

export function reviewReducer(s: ReviewState, a: ReviewAction): ReviewState {
  const group = currentGroup(s);
  const lastGroup = visibleGroups(s).length - 1;
  const lastTrack = (group?.others.length ?? 1) - 1;
  const step = a.type === "down" ? 1 : -1;

  switch (a.type) {
    case "down":
    case "up":
      return s.expanded
        ? { ...s, trackCursor: clamp(s.trackCursor + step, lastTrack) }
        : { ...s, cursor: clamp(s.cursor + step, lastGroup) };
    case "toggle":
      if (!group) return s;
      if (s.expanded) {
        const target = group.others[s.trackCursor];
        return target ? { ...s, unchecked: toggleTrack(s, target.uri) } : s;
      }
      return { ...s, unchecked: toggleGroup(s, group) };
    case "enter":
      return group ? { ...s, expanded: group.id, trackCursor: 0 } : s;
    case "back":
      return { ...s, expanded: null };
    case "startFilter":
      return { ...s, filtering: true, expanded: null };
    case "endFilter":
      return { ...s, filtering: false };
    case "filterInput": {
      const next = { ...s, filter: a.text };
      return { ...next, cursor: clamp(s.cursor, visibleGroups(next).length - 1) };
    }
  }
}
