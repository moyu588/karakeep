/**
 * Splits the tagging model's dual-channel output into the reuse channel and
 * the per-axis "new tag" channels, validates reuse against the canonical
 * vocabulary, and applies the per-axis creation quotas.
 *
 * Tag axes (v2 tag-precision rules):
 *  - concept: at most `conceptMax` new tags per bookmark;
 *  - entity:  at most `entityMax` new tags per bookmark;
 *  - event:   never created - the bookmark falls back to the reserved 待读 tag.
 *
 * Pure logic only (unit-testable). The worker wires it into the tagging
 * pipeline before any tag is written to the database.
 */

import { normalizeVocabularyName } from "./tagVocabulary";
import { isReservedTag } from "./tagEquivalence";
import type { TagKind } from "./taggingSchema";

export interface TaggingModelOutput {
  tags?: string[];
  new_tags?: {
    name: string;
    kind?: TagKind | null;
    definition?: string | null;
  }[];
}

export interface PartitionOptions {
  /** Per-bookmark quota for `kind = "concept"`. */
  conceptMax: number;
  /** Per-bookmark quota for `kind = "entity"`. */
  entityMax: number;
}

export interface PartitionResult {
  /** Vocabulary tags, in the vocabulary's own spelling. Safe to reuse as-is. */
  canonicalTags: string[];
  /** Newly created tags (concepts followed by entities), within quota. */
  newTags: string[];
  newConceptTags: string[];
  newEntityTags: string[];
  /** One-line definitions to remember for entities that are being created. */
  entityDefinitions: { name: string; definition: string }[];
  /** `kind = "event"` suggestions: never created, the bookmark gets 待读. */
  droppedEventTags: string[];
  /** New tags rejected because their axis quota was exhausted. */
  droppedTags: string[];
  /** "tags" entries that were not in the vocabulary and got demoted. */
  demotedTags: string[];
  /** System tags the model tried to emit (待读 / 已读 / 待整理). */
  reservedTags: string[];
}

interface ClassifiedEntry {
  name: string;
  kind: TagKind;
  definition?: string;
}

function emptyResult(): PartitionResult {
  return {
    canonicalTags: [],
    newTags: [],
    newConceptTags: [],
    newEntityTags: [],
    entityDefinitions: [],
    droppedEventTags: [],
    droppedTags: [],
    demotedTags: [],
    reservedTags: [],
  };
}

/**
 * The model is not supposed to declare state tags, and a missing `kind` is
 * treated as a concept: concepts have the tighter quota, so an undeclared
 * entity stays conservative instead of silently bypassing the gate.
 */
function classifyEntry(raw: {
  name: string;
  kind?: TagKind | null;
  definition?: string | null;
}): ClassifiedEntry {
  return {
    name: raw.name.trim(),
    kind: raw.kind ?? "concept",
    ...(raw.definition?.trim() ? { definition: raw.definition.trim() } : {}),
  };
}

/**
 * Applies the per-axis quotas to the ordered candidate list, preserving model
 * order inside each axis. Concepts and entities do not compete for quota.
 */
function applyPerAxisQuotas(
  candidates: ClassifiedEntry[],
  options: PartitionOptions,
): PartitionResult {
  const result = emptyResult();
  const conceptQuota = Math.max(0, options.conceptMax);
  const entityQuota = Math.max(0, options.entityMax);

  for (const candidate of candidates) {
    if (candidate.kind === "event") {
      result.droppedEventTags.push(candidate.name);
      continue;
    }
    if (candidate.kind === "entity") {
      if (result.newEntityTags.length >= entityQuota) {
        result.droppedTags.push(candidate.name);
        continue;
      }
      result.newEntityTags.push(candidate.name);
      if (candidate.definition) {
        result.entityDefinitions.push({
          name: candidate.name,
          definition: candidate.definition,
        });
      }
      continue;
    }
    if (result.newConceptTags.length >= conceptQuota) {
      result.droppedTags.push(candidate.name);
      continue;
    }
    result.newConceptTags.push(candidate.name);
  }

  result.newTags = [...result.newConceptTags, ...result.newEntityTags];
  return result;
}

/**
 * Full gate, used when the canonical vocabulary is available: anything in the
 * `tags` channel that is not in the vocabulary is demoted to a new-tag
 * candidate, so a model that ignores the prompt still cannot mint
 * near-duplicates, and `new_tags` entries that exist in the vocabulary are
 * promoted back into the reuse channel.
 */
export function partitionTagSuggestions(
  output: TaggingModelOutput,
  vocabulary: string[],
  options: PartitionOptions,
): PartitionResult {
  const canonicalByKey = new Map<string, string>();
  for (const name of vocabulary) {
    if (isReservedTag(name)) {
      continue;
    }
    const key = normalizeVocabularyName(name);
    if (key && !canonicalByKey.has(key)) {
      canonicalByKey.set(key, name.trim());
    }
  }

  const result = emptyResult();
  const seenCanonical = new Set<string>();
  const addCanonical = (name: string): boolean => {
    const key = normalizeVocabularyName(name);
    const canonical = canonicalByKey.get(key);
    if (!canonical || seenCanonical.has(key)) {
      return false;
    }
    seenCanonical.add(key);
    result.canonicalTags.push(canonical);
    return true;
  };

  for (const raw of output.tags ?? []) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    if (isReservedTag(name)) {
      result.reservedTags.push(name);
      continue;
    }
    if (!addCanonical(name)) {
      result.demotedTags.push(name);
    }
  }

  const seen = new Set<string>();
  const candidates: ClassifiedEntry[] = [];
  const collect = (name: string, entry: Partial<ClassifiedEntry>) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (isReservedTag(trimmed)) {
      result.reservedTags.push(trimmed);
      return;
    }
    const key = normalizeVocabularyName(trimmed);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    if (addCanonical(trimmed)) {
      return;
    }
    candidates.push({
      name: trimmed,
      kind: entry.kind ?? "concept",
      ...(entry.definition ? { definition: entry.definition } : {}),
    });
  };

  for (const raw of output.new_tags ?? []) {
    collect(raw.name, classifyEntry(raw));
  }
  for (const name of result.demotedTags) {
    collect(name, {});
  }

  const quotas = applyPerAxisQuotas(candidates, options);
  result.newTags = quotas.newTags;
  result.newConceptTags = quotas.newConceptTags;
  result.newEntityTags = quotas.newEntityTags;
  result.entityDefinitions = quotas.entityDefinitions;
  result.droppedEventTags = quotas.droppedEventTags;
  result.droppedTags = quotas.droppedTags;
  return result;
}

/**
 * Degraded-path gate used when no canonical vocabulary is available (the
 * vocabulary build failed, or the user has no reusable tags yet).
 *
 * The reuse channel cannot be validated without a vocabulary, so it passes
 * through untouched. The per-axis quotas still apply, so a vocabulary outage
 * cannot silently let long-tail tags back in.
 */
export function classifyWithoutVocabulary(
  output: TaggingModelOutput,
  options: PartitionOptions,
): PartitionResult {
  const result = emptyResult();
  const seenCanonical = new Set<string>();

  for (const raw of output.tags ?? []) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    if (isReservedTag(name)) {
      result.reservedTags.push(name);
      continue;
    }
    const key = normalizeVocabularyName(name);
    if (!key || seenCanonical.has(key)) {
      continue;
    }
    seenCanonical.add(key);
    result.canonicalTags.push(name);
  }

  const seen = new Set<string>();
  const candidates: ClassifiedEntry[] = [];
  for (const raw of output.new_tags ?? []) {
    const name = raw.name.trim();
    if (!name) {
      continue;
    }
    if (isReservedTag(name)) {
      result.reservedTags.push(name);
      continue;
    }
    const key = normalizeVocabularyName(name);
    if (!key || seen.has(key) || seenCanonical.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(classifyEntry(raw));
  }

  const quotas = applyPerAxisQuotas(candidates, options);
  result.newTags = quotas.newTags;
  result.newConceptTags = quotas.newConceptTags;
  result.newEntityTags = quotas.newEntityTags;
  result.entityDefinitions = quotas.entityDefinitions;
  result.droppedEventTags = quotas.droppedEventTags;
  result.droppedTags = quotas.droppedTags;
  return result;
}
