/**
 * Tag absorption: decide which newly suggested tags should be folded into
 * existing user tags instead of becoming brand-new tags.
 *
 * Pure logic only (unit-testable). Embedding HTTP calls live in the worker.
 */

/** Cosine similarity between two vectors of equal length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Normalize a tag name for absorption lookups: lowercase, trim, collapse
 * whitespace/hyphen/underscore runs to single spaces, drop punctuation.
 */
export function normalizeTagForAbsorption(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

export interface AbsorptionCandidate {
  name: string;
  embedding: number[];
}

export interface AbsorptionInput {
  name: string;
  embedding: number[];
}

export interface AbsorptionMatch {
  input: string;
  matched: string;
  similarity: number;
}

export interface AbsorptionResult {
  absorbed: AbsorptionMatch[];
  fresh: string[];
}

/**
 * Match suggested tags to existing tags by embedding similarity.
 *
 * Exact (normalized) matches absorb first and claim their candidate.
 * Remaining inputs are scored against unclaimed candidates; the highest
 * similarity claims first, and a suggestion only stays fresh when nothing
 * reaches the threshold (so junky one-off tags never merge away).
 */
export function matchTagsForAbsorption(
  inputs: AbsorptionInput[],
  candidates: AbsorptionCandidate[],
  threshold: number,
): AbsorptionResult {
  const absorbed: AbsorptionMatch[] = [];
  const fresh: string[] = [];
  const claimed = new Set<string>();

  const byName = new Map<string, AbsorptionCandidate>();
  for (const c of candidates) {
    const key = normalizeTagForAbsorption(c.name);
    if (key && !byName.has(key)) {
      byName.set(key, c);
    }
  }

  const remaining: AbsorptionInput[] = [];
  for (const input of inputs) {
    const exact = byName.get(normalizeTagForAbsorption(input.name));
    if (exact) {
      absorbed.push({ input: input.name, matched: exact.name, similarity: 1 });
      claimed.add(exact.name);
    } else {
      remaining.push(input);
    }
  }

  const scored = remaining
    .map((input) => {
      let best: AbsorptionCandidate | undefined;
      let bestSim = 0;
      for (const cand of candidates) {
        if (claimed.has(cand.name)) {
          continue;
        }
        const sim = cosineSimilarity(input.embedding, cand.embedding);
        if (sim > bestSim) {
          bestSim = sim;
          best = cand;
        }
      }
      return { input, best, bestSim };
    })
    .sort((a, b) => b.bestSim - a.bestSim);

  for (const { input, best, bestSim } of scored) {
    if (best && bestSim >= threshold && !claimed.has(best.name)) {
      absorbed.push({
        input: input.name,
        matched: best.name,
        similarity: Math.round(bestSim * 1000) / 1000,
      });
      claimed.add(best.name);
    } else {
      fresh.push(input.name);
    }
  }

  return { absorbed, fresh };
}
