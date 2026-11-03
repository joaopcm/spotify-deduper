import { expect, test } from "bun:test";
import { initReview, reviewReducer, selectedUris, visibleGroups, type ReviewAction, type ReviewState } from "../src/review/state";
import { sampleGroups } from "./fixtures";

function run(state: ReviewState, ...actions: ReviewAction[]): ReviewState {
  return actions.reduce(reviewReducer, state);
}

test("everything is selected initially", () => {
  expect(selectedUris(initReview(sampleGroups))).toEqual(["o1a", "o1b", "o2", "o3"]);
});

test("toggle on a group unchecks all its duplicates, toggle again rechecks", () => {
  const once = run(initReview(sampleGroups), { type: "toggle" });
  expect(selectedUris(once)).toEqual(["o2", "o3"]);
  expect(selectedUris(run(once, { type: "toggle" }))).toEqual(["o1a", "o1b", "o2", "o3"]);
});

test("toggle on a partly unchecked group rechecks all of it", () => {
  const partial = run(initReview(sampleGroups), { type: "enter" }, { type: "toggle" }, { type: "back" }, { type: "toggle" });
  expect(selectedUris(partial)).toEqual(["o1a", "o1b", "o2", "o3"]);
});

test("inside a group, toggle unchecks a single track", () => {
  const state = run(initReview(sampleGroups), { type: "enter" }, { type: "down" }, { type: "toggle" });
  expect(selectedUris(state)).toEqual(["o1a", "o2", "o3"]);
});

test("track cursor never lands on the keeper and clamps", () => {
  const state = run(initReview(sampleGroups), { type: "enter" }, { type: "up" }, { type: "up" });
  expect(state.trackCursor).toBe(0);
  const end = run(state, { type: "down" }, { type: "down" }, { type: "down" });
  expect(end.trackCursor).toBe(1);
});

test("group cursor clamps at both ends", () => {
  const top = run(initReview(sampleGroups), { type: "up" });
  expect(top.cursor).toBe(0);
  const bottom = run(top, { type: "down" }, { type: "down" }, { type: "down" }, { type: "down" });
  expect(bottom.cursor).toBe(2);
});

test("filter matches artist or title and clamps the cursor", () => {
  const moved = run(initReview(sampleGroups), { type: "down" }, { type: "down" });
  const filtered = run(moved, { type: "startFilter" }, { type: "filterInput", text: "walker" }, { type: "endFilter" });
  expect(visibleGroups(filtered).map((g) => g.id)).toEqual(["k1"]);
  expect(filtered.cursor).toBe(0);
  expect(filtered.filtering).toBe(false);
  const byTitle = run(initReview(sampleGroups), { type: "filterInput", text: "YELLOW" });
  expect(visibleGroups(byTitle).map((g) => g.id)).toEqual(["k3"]);
});

test("toggle acts on the group under the cursor in the filtered list", () => {
  const state = run(initReview(sampleGroups), { type: "filterInput", text: "coldplay" }, { type: "toggle" });
  expect(selectedUris(state)).toEqual(["o1a", "o1b", "o2"]);
});
