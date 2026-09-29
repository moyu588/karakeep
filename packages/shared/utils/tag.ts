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

export function getPotentialRelevantTagsPrompt(
  potentialRelevantTags?: string[],
): string {
  if (potentialRelevantTags && potentialRelevantTags.length > 0) {
    return `- CANONICAL_TAGS contains the user's existing tags. Prefer these exact tags when they cover a concept, and copy their spelling exactly. Do NOT create synonyms, translated duplicates, spelling variants, or punctuation variants of these tags. Create a new tag only when no existing tag covers the concept.\n- CANONICAL_TAGS: [${potentialRelevantTags.join(", ")}]`;
  }
  return "";
}
