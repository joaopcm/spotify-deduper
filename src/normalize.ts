export const VERSION_WORDS = [
  "remix",
  "mix",
  "edit",
  "live",
  "acoustic",
  "remaster",
  "remastered",
  "version",
  "mono",
  "stereo",
  "extended",
  "original",
  "explicit",
  "clean",
  "restrung",
  "feat",
  "ft",
  "with",
  "demo",
  "instrumental",
  "unplugged",
  "session",
];

const versionWord = new RegExp(`\\b(${VERSION_WORDS.join("|")})\\b`, "i");
const bracketed = /\s*[(\[]([^)\]]*)[)\]]/g;
const dashSuffix = /\s+-\s+(.*)$/;

function stripVersionTags(title: string): string {
  let result = title.replace(bracketed, (segment, inner: string) =>
    versionWord.test(inner) ? "" : segment,
  );
  const suffix = result.match(dashSuffix);
  if (suffix?.[1] && versionWord.test(suffix[1])) {
    result = result.slice(0, suffix.index);
  }
  return result;
}

function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  return simplify(stripVersionTags(title));
}

export function normalizeArtist(name: string): string {
  return simplify(name);
}

export function hasVersionTag(title: string): boolean {
  return stripVersionTags(title).trim() !== title.trim();
}
