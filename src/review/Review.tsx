import { Box, Text, useInput } from "ink";
import { useReducer, useState } from "react";
import type { DuplicateGroup, LikedTrack } from "../types";
import { initReview, reviewReducer, selectedUris, visibleGroups, type ReviewState } from "./state";

const DEFAULT_ROWS = 24;
const CHROME_ROWS = 4;

type Line = { key: string; text: string; color?: string; dim?: boolean; focused: boolean };

const REASON_FLAG: Record<DuplicateGroup["reason"], string> = {
  oldest: "",
  "oldest-playable": "  oldest version unplayable",
  "no-playable": "  no playable version",
};

const SUSPECT_FLAG = "  maybe different songs, check";

function describe(track: LikedTrack): string {
  const unplayable = track.isPlayable ? "" : " · unplayable";
  return `${track.name} · ${track.album} · added ${track.addedAt.slice(0, 10)}${unplayable}`;
}

function buildLines(s: ReviewState): Line[] {
  return visibleGroups(s).flatMap((group, index) => {
    const isCurrent = index === s.cursor;
    const isExpanded = s.expanded === group.id;
    const allUnchecked = group.others.every((t) => s.unchecked.has(t.uri));
    const someUnchecked = group.others.some((t) => s.unchecked.has(t.uri));
    const box = allUnchecked ? "[ ]" : someUnchecked ? "[~]" : "[x]";
    return [
      {
        key: group.id,
        text: `${isCurrent && !isExpanded ? "›" : " "} ${box} ${group.keeper.artists.join(", ")} · ${group.keeper.name}${REASON_FLAG[group.reason]}${group.suspect ? SUSPECT_FLAG : ""}`,
        color: group.reason === "oldest" && !group.suspect ? undefined : "yellow",
        focused: isCurrent && !isExpanded,
      },
      { key: `${group.id}:keep`, text: `      keep  ${describe(group.keeper)}`, color: "green", focused: false },
      ...group.others.map((t, i) => {
        const focused = isExpanded && i === s.trackCursor;
        return {
          key: `${group.id}:${t.uri}`,
          text: `    ${focused ? "›" : " "} ${s.unchecked.has(t.uri) ? "[ ]" : "[x]"} ${describe(t)}`,
          dim: s.unchecked.has(t.uri),
          focused,
        };
      }),
    ];
  });
}

function windowAround(lines: Line[], height: number): Line[] {
  const focusIndex = Math.max(0, lines.findIndex((l) => l.focused));
  const start = Math.max(0, Math.min(focusIndex - Math.floor(height / 3), lines.length - height));
  return lines.slice(start, start + height);
}

export function Review(p: { groups: DuplicateGroup[]; onApprove: (uris: string[]) => void; onQuit: () => void }) {
  const [state, dispatch] = useReducer(reviewReducer, p.groups, initReview);
  const [confirming, setConfirming] = useState(false);
  const height = Math.max(1, (process.stdout.rows ?? DEFAULT_ROWS) - CHROME_ROWS);
  const selected = selectedUris(state);

  useInput((input, key) => {
    if (confirming) {
      if (input === "y") p.onApprove(selected);
      else if (input === "n" || key.escape) setConfirming(false);
      return;
    }
    if (state.filtering) {
      if (key.return || key.escape) dispatch({ type: "endFilter" });
      else if (key.backspace || key.delete) dispatch({ type: "filterInput", text: state.filter.slice(0, -1) });
      else if (input && !key.ctrl && !key.meta) dispatch({ type: "filterInput", text: state.filter + input });
      return;
    }
    if (input === "j" || key.downArrow) dispatch({ type: "down" });
    else if (input === "k" || key.upArrow) dispatch({ type: "up" });
    else if (input === " ") dispatch({ type: "toggle" });
    else if (key.return) dispatch({ type: "enter" });
    else if (key.escape) dispatch({ type: "back" });
    else if (input === "/") dispatch({ type: "startFilter" });
    else if (input === "a") setConfirming(true);
    else if (input === "q") p.onQuit();
  });

  const lines = windowAround(buildLines(state), height);

  return (
    <Box flexDirection="column">
      <Text bold>
        {state.groups.length} groups · {selected.length} to unlike · {state.unchecked.size} unchecked
        {state.filter ? <Text dimColor>  filter: {state.filter}</Text> : null}
      </Text>
      {lines.map((line) => (
        <Text key={line.key} wrap="truncate-end" color={line.color} dimColor={line.dim} inverse={line.focused}>
          {line.text}
        </Text>
      ))}
      {confirming ? (
        <Text color="red">
          unlike {selected.length} songs? undo can't restore date added, re-liked songs move to the top. y/n
        </Text>
      ) : state.filtering ? (
        <Text>/{state.filter}</Text>
      ) : (
        <Text dimColor>j/k move · space toggle · enter open group · esc close · / filter · a apply · q quit</Text>
      )}
    </Box>
  );
}
