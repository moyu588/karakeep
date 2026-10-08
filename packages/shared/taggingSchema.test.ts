import { zodResponseFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";

import { taggingResponseSchema } from "./taggingSchema";

/**
 * Regression guard: the inference client converts this schema into a strict
 * JSON schema for every tagging call, including when the configured output
 * format is json/plain (the conversion happens eagerly). A bare `.optional()`
 * throws there and breaks tagging in production, so the conversion itself is
 * what we assert on.
 */
describe("taggingResponseSchema", () => {
  it("converts to a strict JSON schema without throwing", () => {
    expect(() =>
      zodResponseFormat(taggingResponseSchema, "schema"),
    ).not.toThrow();
  });

  it("keeps both keys required in the strict schema", () => {
    const format = zodResponseFormat(taggingResponseSchema, "schema");
    const schema = format.json_schema.schema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["tags", "new_tags"]);
  });

  it("parses a full response", () => {
    const parsed = taggingResponseSchema.parse({
      tags: ["渗透测试"],
      new_tags: ["新概念"],
    });
    expect(parsed.tags).toEqual(["渗透测试"]);
    expect(parsed.new_tags).toEqual(["新概念"]);
  });

  it("tolerates a null or missing new_tags so json/plain output still works", () => {
    expect(
      taggingResponseSchema.parse({ tags: ["a"], new_tags: null }).new_tags,
    ).toBeNull();
    expect(
      taggingResponseSchema.parse({ tags: ["a"] }).new_tags,
    ).toBeUndefined();
  });

  it("rejects a response without tags", () => {
    expect(taggingResponseSchema.safeParse({}).success).toBe(false);
    expect(
      taggingResponseSchema.safeParse({ tags: "not-an-array" }).success,
    ).toBe(false);
  });
});
