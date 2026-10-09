/**
 * Explicit tag equivalence: the only folding the tagging pipeline is allowed to
 * do on its own.
 *
 * The v2 tag-precision rules invert the default: nothing folds unless the two
 * names are *explicitly* equivalent (case / punctuation / spacing / English
 * plural, or an entry in `tagAliases`). Vector similarity is deliberately not
 * used here - it cannot tell "the same concept" from "a neighbouring concept",
 * so grey-zone candidates are left as separate tags until stage 3 judges them.
 *
 * Pure logic only (unit-testable).
 */

import { normalizeTagForAbsorption } from "./tagAbsorption";
import { normalizeVocabularyName } from "./tagVocabulary";

/** Reserved state tags: written by the system, never by the model, never folded. */
export const PENDING_READ_TAG = "待读";
export const RESERVED_TAG_NAMES = [PENDING_READ_TAG, "已读", "待整理"] as const;

/** Normalizes a reserved-name lookup ("待读" vs " 待读 "). */
export function normalizeReservedName(name: string): string {
  return name.trim();
}

export function isReservedTag(name: string): boolean {
  return RESERVED_TAG_NAMES.includes(
    normalizeReservedName(name) as (typeof RESERVED_TAG_NAMES)[number],
  );
}

/**
 * Namespaced tags (e.g. `harness:codex`) are user-managed buckets: they must
 * never be folded into a plain tag or the other way around.
 */
export function isNamespaceTag(name: string): boolean {
  return name.includes(":");
}

/** Tags that must never take part in folding, as source or as target. */
export function isFoldExemptTag(name: string): boolean {
  return isReservedTag(name) || isNamespaceTag(name);
}

/**
 * English plural folding: `skills` -> `skill`, `queries` -> `query`,
 * `boxes` -> `box`. Only applied to the last word of the normalized name and
 * only when the stem is long enough to avoid mangling short words.
 */
function foldEnglishPlural(token: string): string {
  if (token.length < 4) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (/(ses|xes|zes|ches|shes)$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * The key under which two names are considered "the same tag".
 *
 * It uses the same normalization as `bookmarkTags.normalizedName` (lowercase,
 * separators removed) so the folding decision matches what the tag writer
 * would treat as one row, plus a trailing English plural fold.
 */
export function explicitEquivalenceKey(name: string): string {
  const normalized = normalizeVocabularyName(name);
  if (!normalized) {
    return "";
  }
  return foldEnglishPlural(normalized);
}

export interface EquivalenceCandidate {
  name: string;
}

export interface EquivalenceMatch {
  input: string;
  matched: string;
  reason: "normalized" | "plural";
}

/**
 * Finds the existing tag (if any) that `input` is explicitly equivalent to.
 * Candidates are matched by key, so punctuation/case/plural variants all land
 * on the same key. Fold-exempt names are skipped on both sides.
 */
export function matchExplicitEquivalent(
  input: string,
  candidates: EquivalenceCandidate[],
): EquivalenceMatch | null {
  if (isFoldExemptTag(input)) {
    return null;
  }
  const key = explicitEquivalenceKey(input);
  if (!key) {
    return null;
  }
  for (const candidate of candidates) {
    if (isFoldExemptTag(candidate.name)) {
      continue;
    }
    if (explicitEquivalenceKey(candidate.name) !== key) {
      continue;
    }
    const sameNormalized =
      normalizeTagForAbsorption(candidate.name) ===
      normalizeTagForAbsorption(input);
    return {
      input,
      matched: candidate.name,
      reason: sameNormalized ? "normalized" : "plural",
    };
  }
  return null;
}

export interface ExplicitFoldingResult {
  folded: EquivalenceMatch[];
  kept: string[];
}

/**
 * Splits the suggested new tags into "explicitly equivalent to an existing
 * tag" (fold) and "genuinely new" (keep). Inputs are de-duplicated by key so a
 * single bookmark can never request two spellings of the same tag.
 */
export function foldExplicitEquivalents(
  inputs: string[],
  candidates: EquivalenceCandidate[],
): ExplicitFoldingResult {
  const folded: EquivalenceMatch[] = [];
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const name = input.trim();
    if (!name || isFoldExemptTag(name)) {
      continue;
    }
    const key = explicitEquivalenceKey(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const match = matchExplicitEquivalent(name, candidates);
    if (match) {
      folded.push(match);
    } else {
      kept.push(name);
    }
  }

  return { folded, kept };
}
