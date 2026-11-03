import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Review } from "../src/review/Review";
import { Progress } from "../src/ui/Progress";
import { sampleGroups } from "./fixtures";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup() {
  const approved: string[][] = [];
  let quit = 0;
  const app = render(<Review groups={sampleGroups} onApprove={(uris) => approved.push(uris)} onQuit={() => quit++} />);
  return { app, approved, quits: () => quit };
}

test("header counts groups, songs to unlike and unchecked items", () => {
  const { app } = setup();
  expect(app.lastFrame()).toContain("3 groups · 4 to unlike · 0 unchecked");
});

test("keeper row shows keep and its date added", () => {
  const { app } = setup();
  expect(app.lastFrame()).toContain("keep");
  expect(app.lastFrame()).toContain("2017-05-01");
});

test("flags groups with unusual keepers", () => {
  const frame = setup().app.lastFrame();
  expect(frame).toContain("no playable version");
  expect(frame).toContain("oldest version unplayable");
});

test("space unchecks the group and updates the header", async () => {
  const { app } = setup();
  app.stdin.write(" ");
  await tick();
  expect(app.lastFrame()).toContain("3 groups · 2 to unlike · 2 unchecked");
});

test("a asks for confirmation mentioning the date caveat, y approves", async () => {
  const { app, approved } = setup();
  app.stdin.write("a");
  await tick();
  expect(app.lastFrame()).toContain("undo can't restore date added");
  app.stdin.write("y");
  await tick();
  expect(approved).toEqual([["o1a", "o1b", "o2", "o3"]]);
});

test("n cancels the confirmation", async () => {
  const { app, approved } = setup();
  app.stdin.write("a");
  await tick();
  app.stdin.write("n");
  await tick();
  expect(approved).toEqual([]);
  expect(app.lastFrame()).not.toContain("undo can't restore date added");
});

test("q quits", async () => {
  const { app, quits } = setup();
  app.stdin.write("q");
  await tick();
  expect(quits()).toBe(1);
});

test("typing a filter narrows the list", async () => {
  const { app } = setup();
  app.stdin.write("/");
  await tick();
  app.stdin.write("adele");
  await tick();
  const frame = app.lastFrame()!;
  expect(frame).toContain("Hello");
  expect(frame).not.toContain("Yellow");
});

test("progress shows label and counts", () => {
  const frame = render(<Progress label="unliking" done={40} total={90} />).lastFrame();
  expect(frame).toContain("unliking");
  expect(frame).toContain("40/90");
});

test("renders only the rows that fit the terminal for large libraries", async () => {
  const { group, track } = await import("./fixtures");
  const many = Array.from({ length: 500 }, (_, i) => group(track(`k${i}`), [track(`o${i}`)]));
  const frame = render(<Review groups={many} onApprove={() => {}} onQuit={() => {}} />).lastFrame()!;
  expect(frame.split("\n").length).toBeLessThanOrEqual(24);
  expect(frame).toContain("500 groups");
});
