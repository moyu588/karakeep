import { zodResponseFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";

import { parseTaggingResponse, taggingResponseSchema } from "./taggingSchema";

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
      new_tags: [{ name: "新概念", kind: "concept" }],
    });
    expect(parsed.tags).toEqual(["渗透测试"]);
    expect(parsed.new_tags).toEqual([{ name: "新概念", kind: "concept" }]);
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

  it("carries entity definitions through the strict schema", () => {
    const parsed = taggingResponseSchema.parse({
      tags: [],
      new_tags: [
        { name: "opencode", kind: "entity", definition: "开源编码代理 CLI" },
      ],
    });
    expect(parsed.new_tags?.[0].definition).toBe("开源编码代理 CLI");
  });
});

describe("parseTaggingResponse", () => {
  it("normalizes the v2 object form", () => {
    const parsed = parseTaggingResponse({
      tags: ["渗透测试"],
      new_tags: [
        { name: "opencode", kind: "entity", definition: "开源编码代理 CLI" },
        { name: "CISA-2022事件", kind: "event" },
      ],
    });
    expect(parsed.tags).toEqual(["渗透测试"]);
    expect(parsed.newTags).toEqual([
      { name: "opencode", kind: "entity", definition: "开源编码代理 CLI" },
      { name: "CISA-2022事件", kind: "event" },
    ]);
  });

  it("accepts the legacy plain-string form (prompt/code rollout mismatch)", () => {
    const parsed = parseTaggingResponse({
      tags: ["a"],
      new_tags: ["旧格式"],
    });
    expect(parsed.newTags).toEqual([
      { name: "旧格式", kind: null, definition: null },
    ]);
  });

  it("tolerates a missing or null new_tags", () => {
    expect(parseTaggingResponse({ tags: ["a"] }).newTags).toEqual([]);
    expect(
      parseTaggingResponse({ tags: ["a"], new_tags: null }).newTags,
    ).toEqual([]);
  });

  it("throws on garbage so the worker can report a prompt violation", () => {
    expect(() => parseTaggingResponse({ new_tags: ["a"] })).toThrow();
  });
});
