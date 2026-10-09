import { z } from "zod";

/**
 * The three tag axes introduced by the tag-precision plan. Each axis has its
 * own creation quota and its own folding rules:
 *  - concept: reusable topic/technology tags (reuse first, explicit equivalence folds)
 *  - entity:  concrete product/tool/vendor names (same product may merge, cross product must stay apart)
 *  - event:   one-off descriptions (never created; the bookmark falls back to 待读)
 */
export const TAG_KINDS = ["concept", "entity", "event"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

/**
 * A single entry of the "new_tags" channel. `kind` drives the per-axis quota
 * and the folding rules; `definition` is only meaningful for entities, which
 * are injected into the canonical vocabulary as "<name>（实体：<definition>）".
 */
export const newTagSuggestionSchema = z.object({
  name: z.string(),
  kind: z.enum(TAG_KINDS).nullish(),
  definition: z.string().nullish(),
});
export type NewTagSuggestion = {
  name: string;
  kind?: TagKind | null;
  definition?: string | null;
};

/**
 * Response schema for the tagging prompts.
 *
 * This is the schema handed to the inference client, so it must stay
 * convertible to a strict JSON schema.
 *
 * IMPORTANT: never make a field `.optional()` on its own here. The OpenAI
 * inference client eagerly converts this schema into a strict JSON schema, and
 * strict mode rejects bare optionals ("uses `.optional()` without
 * `.nullable()`"), which makes every tagging job fail before the request is
 * even sent. `.nullish()` is accepted by the converter (it yields
 * `anyOf: [array, null]` with the key still required) and additionally keeps
 * local parsing tolerant when the response format is json/plain.
 *
 * Never add `z.union` to *this* schema either: unions are only exercised by
 * `taggingResponseParseSchema` below, which is never converted.
 */
export const taggingResponseSchema = z.object({
  tags: z.array(z.string()),
  new_tags: z.array(newTagSuggestionSchema).nullish(),
});

export type TaggingResponse = z.infer<typeof taggingResponseSchema>;

/**
 * Tolerant parser used for the *local* parsing of the model response only.
 *
 * It also accepts the legacy plain-string form of `new_tags`, so a
 * prompt/code rollout mismatch (old prompt + new code, or the reverse) can
 * never fail a tagging job the way the 2026-10-08 `.optional()` incident did.
 */
export const taggingResponseParseSchema = z.object({
  tags: z.array(z.string()),
  new_tags: z.array(z.union([z.string(), newTagSuggestionSchema])).nullish(),
});

export interface ParsedTaggingResponse {
  tags: string[];
  newTags: NewTagSuggestion[];
}

/**
 * Parses a raw model response into normalized suggestions. String entries are
 * promoted to suggestions without a declared kind (the worker treats a missing
 * kind as `concept`).
 */
export function parseTaggingResponse(raw: unknown): ParsedTaggingResponse {
  const parsed = taggingResponseParseSchema.parse(raw);
  const newTags: NewTagSuggestion[] = [];
  for (const entry of parsed.new_tags ?? []) {
    if (typeof entry === "string") {
      newTags.push({ name: entry, kind: null, definition: null });
    } else {
      newTags.push(entry);
    }
  }
  return { tags: parsed.tags, newTags };
}
