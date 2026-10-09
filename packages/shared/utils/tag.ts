import type { ZTagStyle } from "../types/users";
import { RESERVED_TAG_NAMES } from "../tagEquivalence";
import type { TagKind } from "../taggingSchema";

/** A vocabulary entry as rendered into the prompt. */
export interface CanonicalTagEntry {
  name: string;
  kind?: TagKind;
  /** One-line definition, rendered next to entities only. */
  definition?: string;
}

function normalizeCanonicalEntry(
  entry: string | CanonicalTagEntry,
): CanonicalTagEntry {
  return typeof entry === "string" ? { name: entry } : entry;
}

/**
 * Ensures exactly ONE leading #
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, ""); // strip every leading #
}

export type TagStyle = ZTagStyle;

export function getTagStylePrompt(style: TagStyle): string {
  switch (style) {
    case "lowercase-hyphens":
      return "- Use lowercase letters with hyphens between words (e.g., 'machine-learning', 'web-development')";
    case "lowercase-spaces":
      return "- Use lowercase letters with spaces between words (e.g., 'machine learning', 'web development')";
    case "lowercase-underscores":
      return "- Use lowercase letters with underscores between words (e.g., 'machine_learning', 'web_development')";
    case "titlecase-spaces":
      return "- Use title case with spaces between words (e.g., 'Machine Learning', 'Web Development')";
    case "titlecase-hyphens":
      return "- Use title case with hyphens between words (e.g., 'Machine-Learning', 'Web-Development')";
    case "camelCase":
      return "- Use camelCase format (e.g., 'machineLearning', 'webDevelopment')";
    case "as-generated":
    default:
      return "";
  }
}

export function getCuratedTagsPrompt(curatedTags?: string[]): string {
  if (curatedTags && curatedTags.length > 0) {
    return `- ONLY use tags from this predefined list: [${curatedTags.join(", ")}]. Do not create any new tags outside this list. If no tags fit, don't emit any.`;
  }
  return "";
}

/**
 * Renders the canonical tag vocabulary. This is a HARD constraint: entries of
 * the "tags" output channel must be copied verbatim from this list, so that the
 * model reuses existing tags instead of minting near-duplicates.
 */
export function getCanonicalTagsPrompt(
  canonicalTags?: (string | CanonicalTagEntry)[],
): string {
  if (canonicalTags && canonicalTags.length > 0) {
    const rendered = canonicalTags.map((raw) => {
      const entry = normalizeCanonicalEntry(raw);
      const definition = entry.definition?.trim();
      return entry.kind === "entity" && definition
        ? `${entry.name}（实体：${definition}）`
        : entry.name;
    });
    return `- CANONICAL_TAGS is the user's existing tag vocabulary, ordered by how often each tag is used.
- Entries marked 实体 are concrete product/tool names: reuse them verbatim for the same product, and keep different products apart.
- HARD RULE for "tags": every entry MUST be copied verbatim from CANONICAL_TAGS. Never invent, translate, re-case, re-pluralize or re-punctuate a concept that already exists there. If none of them fit, return an empty "tags" array.
- Only when a core concept is genuinely absent from CANONICAL_TAGS may it be proposed as a new tag (see the output rules below).
- CANONICAL_TAGS: [${rendered.join(", ")}]`;
  }
  return "";
}

export interface TagOutputContractOptions {
  hasCanonicalTags: boolean;
  /** Per-bookmark quota for new concept tags. */
  conceptMax: number;
  /** Per-bookmark quota for new entity tags. */
  entityMax: number;
}

/**
 * Renders the required response shape and the per-axis quotas. When a
 * canonical vocabulary is present the model must split its answer into a reuse
 * channel ("tags") and a new-tag channel ("new_tags"), where every entry
 * declares its axis so the server can gate tag creation per axis.
 */
export function getTagOutputContractPrompt(
  options: TagOutputContractOptions,
): string {
  const { hasCanonicalTags, conceptMax, entityMax } = options;
  const reserved = RESERVED_TAG_NAMES.join("、");
  const axes = `Each "new_tags" entry MUST be an object with:
- "name": the tag text;
- "kind": one of "concept" (reusable topic/technology, at most ${conceptMax} per bookmark), "entity" (concrete product/tool/vendor name, at most ${entityMax} per bookmark) or "event" (a one-off description with a year, version or incident name - do NOT propose those, they are never created);
- "definition": for "kind": "entity" only, a one-line definition of the product in the bookmark's language.
Never emit the reserved state tags ${reserved}; the system manages them.`;

  if (hasCanonicalTags) {
    return `You must respond in valid JSON with exactly two keys:
- "tags": an array of strings. Every entry MUST be copied verbatim from CANONICAL_TAGS. Do not invent, translate, re-case or re-punctuate entries. Use an empty array if nothing fits.
- "new_tags": an array of objects, only for tags genuinely not covered by CANONICAL_TAGS. Prefer an empty array; a new tag is a last resort.
${axes}
Always include both keys. Do not wrap the response in markdown.`;
  }
  return `You must respond in valid JSON with exactly two keys:
- "tags": an array of string tags.
- "new_tags": an array of objects (may be empty).
${axes}
Always include both keys. Do not wrap the response in markdown.`;
}
