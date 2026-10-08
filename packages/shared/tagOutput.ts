/**
 * Splits the tagging model's dual-channel output into "reuse" and "new tag"
 * buckets, validates the reuse bucket against the canonical vocabulary, and
 * applies the new-tag policy.
 *
 * Pure logic only (unit-testable). The worker wires it into the tagging
 * pipeline before any tag is written to the database.
 */

import { normalizeVocabularyName } from "./tagVocabulary";

export type NewTagPolicy = "allow" | "cap" | "fold_only";

export interface TaggingModelOutput {
  tags?: string[];
  new_tags?: string[];
}

export interface PartitionOptions {
  policy: NewTagPolicy;
  /** Used when policy is "cap". */
  maxNewTags: number;
}

export interface PartitionResult {
  /** Vocabulary tags, in the vocabulary's own spelling. Safe to reuse as-is. */
  canonicalTags: string[];
  /** New tags still allowed to be created after the policy gate. */
  newTags: string[];
  /** Proposed new tags that the policy dropped. */
  droppedTags: string[];
  /** "tags" entries that were not in the vocabulary and got demoted. */
  demotedTags: string[];
}

/**
 * Partitions a model response. Anything in "tags" that is not in the
 * vocabulary is demoted to a new tag, so a model that ignores the prompt still
 * cannot create near-duplicate rows. "new_tags" entries that actually exist in
 * the vocabulary are promoted back into the reuse bucket.
 */
export function partitionTagSuggestions(
  output: TaggingModelOutput,
  vocabulary: string[],
  options: PartitionOptions,
): PartitionResult {
  const canonicalByKey = new Map<string, string>();
  for (const name of vocabulary) {
    const key = normalizeVocabularyName(name);
    if (key && !canonicalByKey.has(key)) {
      canonicalByKey.set(key, name.trim());
    }
  }

  const canonicalTags: string[] = [];
  const seenCanonical = new Set<string>();
  const addCanonical = (name: string): boolean => {
    const key = normalizeVocabularyName(name);
    const canonical = canonicalByKey.get(key);
    if (!canonical || seenCanonical.has(key)) {
      return false;
    }
    seenCanonical.add(key);
    canonicalTags.push(canonical);
    return true;
  };

  const demotedTags: string[] = [];
  for (const raw of output.tags ?? []) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    if (!addCanonical(name)) {
      demotedTags.push(name);
    }
  }

  const proposed: string[] = [];
  const seenProposed = new Set<string>();
  for (const raw of [...(output.new_tags ?? []), ...demotedTags]) {
    const name = raw.trim();
    const key = normalizeVocabularyName(name);
    if (!key) {
      continue;
    }
    if (addCanonical(name)) {
      continue;
    }
    if (seenProposed.has(key)) {
      continue;
    }
    seenProposed.add(key);
    proposed.push(name);
  }

  const maxNewTags = Math.max(0, options.maxNewTags);
  let newTags: string[];
  const droppedTags: string[] = [];
  if (options.policy === "fold_only") {
    newTags = [];
    droppedTags.push(...proposed);
  } else if (options.policy === "cap") {
    newTags = proposed.slice(0, maxNewTags);
    droppedTags.push(...proposed.slice(newTags.length));
  } else {
    newTags = [...proposed];
  }

  return { canonicalTags, newTags, droppedTags, demotedTags };
}
