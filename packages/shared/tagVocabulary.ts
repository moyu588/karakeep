/**
 * Canonical tag vocabulary: the set of existing user tags the tagging model is
 * allowed to reuse verbatim. It is built from globally high-usage tags plus the
 * tags found on similar bookmarks, then trimmed to a tag-count and a character
 * budget so the prompt cannot starve the bookmark content.
 *
 * Pure logic only (unit-testable). DB access lives in the worker.
 */

export interface TagUsage {
  name: string;
  usage: number;
}

export interface VocabularyOptions {
  /** Maximum number of tags to include. */
  maxTags: number;
  /** Character budget for the joined tag list. */
  maxChars: number;
  /** Only tags with at least this many uses are eligible. */
  minUsage: number;
  /** Predicate to exclude undesired names (e.g. URL-like tags). */
  isExcluded?: (name: string) => boolean;
}

/**
 * Normalizes a tag name for vocabulary de-duplication. Must stay in sync with
 * the normalizedName uniqueness used by bookmarkTags so the vocabulary never
 * carries two spellings of the same tag.
 */
export function normalizeVocabularyName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase()
    .replace(/[ \-_]+/g, "");
}

/**
 * Builds the canonical vocabulary. Global high-usage tags rank first (so the
 * most reusable concepts always make the budget), then tags from similar
 * bookmarks fill the remaining room.
 */
export function buildCanonicalVocabulary(
  globalTags: TagUsage[],
  neighborTags: string[],
  options: VocabularyOptions,
): string[] {
  const { maxTags, maxChars, minUsage, isExcluded } = options;
  const excluded = (name: string) => isExcluded?.(name) ?? false;

  const rankedGlobal = globalTags
    .filter((t) => t.usage >= minUsage && !excluded(t.name))
    .sort(
      (a, b) =>
        b.usage - a.usage ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    )
    .map((t) => t.name);

  const ordered = [
    ...rankedGlobal,
    ...neighborTags.filter((n) => !excluded(n)),
  ];

  const vocabulary: string[] = [];
  const seen = new Set<string>();
  let usedChars = 0;

  for (const raw of ordered) {
    if (vocabulary.length >= maxTags) {
      break;
    }
    const name = raw.trim();
    const key = normalizeVocabularyName(name);
    if (!key || seen.has(key)) {
      continue;
    }
    const separatorLen = vocabulary.length > 0 ? 2 : 0;
    if (usedChars + separatorLen + name.length > maxChars) {
      // Skip this one but keep scanning: a shorter later tag may still fit.
      continue;
    }
    seen.add(key);
    vocabulary.push(name);
    usedChars += separatorLen + name.length;
  }

  return vocabulary;
}
