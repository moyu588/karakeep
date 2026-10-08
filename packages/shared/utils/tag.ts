import type { ZTagStyle } from "../types/users";

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
export function getCanonicalTagsPrompt(canonicalTags?: string[]): string {
  if (canonicalTags && canonicalTags.length > 0) {
    return `- CANONICAL_TAGS is the user's existing tag vocabulary, ordered by how often each tag is used.
- HARD RULE for "tags": every entry MUST be copied verbatim from CANONICAL_TAGS. Never invent, translate, re-case, re-pluralize or re-punctuate a concept that already exists there. If none of them fit, return an empty "tags" array.
- Only when a core concept is genuinely absent from CANONICAL_TAGS may it be proposed as a new tag (see the output rules below).
- CANONICAL_TAGS: [${canonicalTags.join(", ")}]`;
  }
  return "";
}

/**
 * Renders the required response shape. When a canonical vocabulary is present
 * the model must split its answer into a reuse channel ("tags") and a
 * new-tag channel ("new_tags"), so the server can gate tag creation.
 */
export function getTagOutputContractPrompt(hasCanonicalTags: boolean): string {
  if (hasCanonicalTags) {
    return `You must respond in valid JSON with exactly two keys:
- "tags": an array of strings. Every entry MUST be copied verbatim from CANONICAL_TAGS. Do not invent, translate, re-case or re-punctuate entries. Use an empty array if nothing fits.
- "new_tags": an array of strings, at most 2, only for concepts genuinely not covered by CANONICAL_TAGS. Prefer an empty array; a new tag is a last resort.
Always include both keys. Do not wrap the response in markdown.`;
  }
  return `You must respond in valid JSON with exactly two keys:
- "tags": an array of string tags.
- "new_tags": leave this as an empty array.
Always include both keys. Do not wrap the response in markdown.`;
}
