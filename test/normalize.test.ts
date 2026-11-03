import { describe, expect, test } from "bun:test";
import { hasVersionTag, normalizeArtist, normalizeTitle } from "../src/normalize";

describe("normalizeTitle", () => {
  test.each([
    ["Faded", "faded"],
    ["Faded - Remix", "faded"],
    ["Faded (Live)", "faded"],
    ["Faded - Radio Edit", "faded"],
    ["Faded (Restrung)", "faded"],
    ["Faded [feat. Iselin Solheim]", "faded"],
    ["Faded - Remastered 2019", "faded"],
    ["Faded - Alan Walker Remix", "faded"],
    ["Déjà Vu", "deja vu"],
    ["Live Forever", "live forever"],
    ["Mr. Brightside", "mr brightside"],
  ])("%p -> %p", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  test("keeps a parenthetical that is part of the title", () => {
    expect(normalizeTitle("(I Can't Get No) Satisfaction")).toBe("i cant get no satisfaction");
  });
});

test("normalizeArtist strips accents and case", () => {
  expect(normalizeArtist("Beyoncé")).toBe("beyonce");
});

test("hasVersionTag", () => {
  expect(hasVersionTag("Faded - Remix")).toBe(true);
  expect(hasVersionTag("Faded")).toBe(false);
  expect(hasVersionTag("Live Forever")).toBe(false);
});
