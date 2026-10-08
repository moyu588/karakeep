import { z } from "zod";

/**
 * Response schema for the tagging prompts.
 *
 * IMPORTANT: never make a field `.optional()` on its own here. The OpenAI
 * inference client eagerly converts this schema into a strict JSON schema, and
 * strict mode rejects bare optionals ("uses `.optional()` without
 * `.nullable()`"), which makes every tagging job fail before the request is
 * even sent. `.nullish()` is accepted by the converter (it yields
 * `anyOf: [array, null]` with the key still required) and additionally keeps
 * local parsing tolerant when the response format is json/plain.
 */
export const taggingResponseSchema = z.object({
  tags: z.array(z.string()),
  new_tags: z.array(z.string()).nullish(),
});

export type TaggingResponse = z.infer<typeof taggingResponseSchema>;
