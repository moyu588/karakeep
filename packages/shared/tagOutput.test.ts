import { describe, expect, it } from "vitest";

import {
  capNewTagsWithoutVocabulary,
  partitionTagSuggestions,
} from "./tagOutput";

const vocabulary = ["渗透测试", "安全工具", "agent"];

describe("partitionTagSuggestions", () => {
  it("keeps vocabulary tags as reuse and demotes unknown ones", () => {
    const result = partitionTagSuggestions(
      { tags: ["渗透测试", "自造标签"] },
      vocabulary,
      { policy: "cap", maxNewTags: 2 },
    );
    expect(result.canonicalTags).toEqual(["渗透测试"]);
    expect(result.demotedTags).toEqual(["自造标签"]);
    expect(result.newTags).toEqual(["自造标签"]);
    expect(result.droppedTags).toEqual([]);
  });

  it("reuses the vocabulary's own spelling for case variants", () => {
    const result = partitionTagSuggestions({ tags: ["Agent"] }, vocabulary, {
      policy: "cap",
      maxNewTags: 2,
    });
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.demotedTags).toEqual([]);
  });

  it("promotes new_tags entries that already exist in the vocabulary", () => {
    const result = partitionTagSuggestions(
      { tags: [], new_tags: ["安全工具", "真正的新概念"] },
      vocabulary,
      { policy: "cap", maxNewTags: 2 },
    );
    expect(result.canonicalTags).toEqual(["安全工具"]);
    expect(result.newTags).toEqual(["真正的新概念"]);
  });

  it("caps the number of new tags", () => {
    const result = partitionTagSuggestions(
      { tags: [], new_tags: ["A", "B", "C", "D"] },
      vocabulary,
      { policy: "cap", maxNewTags: 2 },
    );
    expect(result.newTags).toEqual(["A", "B"]);
    expect(result.droppedTags).toEqual(["C", "D"]);
  });

  it("drops every new tag under fold_only", () => {
    const result = partitionTagSuggestions(
      { tags: ["安全工具"], new_tags: ["新概念"] },
      vocabulary,
      { policy: "fold_only", maxNewTags: 2 },
    );
    expect(result.canonicalTags).toEqual(["安全工具"]);
    expect(result.newTags).toEqual([]);
    expect(result.droppedTags).toEqual(["新概念"]);
  });

  it("keeps every new tag under allow", () => {
    const result = partitionTagSuggestions(
      { tags: [], new_tags: ["A", "B", "C"] },
      vocabulary,
      { policy: "allow", maxNewTags: 0 },
    );
    expect(result.newTags).toEqual(["A", "B", "C"]);
    expect(result.droppedTags).toEqual([]);
  });

  it("de-duplicates repeated suggestions across both channels", () => {
    const result = partitionTagSuggestions(
      { tags: ["agent"], new_tags: ["新概念", "新概念"] },
      vocabulary,
      { policy: "cap", maxNewTags: 5 },
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newTags).toEqual(["新概念"]);
  });

  it("ignores blank entries", () => {
    const result = partitionTagSuggestions(
      { tags: ["  ", "agent"], new_tags: [""] },
      vocabulary,
      { policy: "cap", maxNewTags: 2 },
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newTags).toEqual([]);
  });
});

describe("capNewTagsWithoutVocabulary", () => {
  it("passes the reuse channel through and caps the new tags", () => {
    const result = capNewTagsWithoutVocabulary(
      { tags: ["渗透测试", "安全工具"], new_tags: ["A", "B", "C"] },
      { policy: "cap", maxNewTags: 2 },
    );
    expect(result.canonicalTags).toEqual(["渗透测试", "安全工具"]);
    expect(result.newTags).toEqual(["A", "B"]);
    expect(result.droppedTags).toEqual(["C"]);
    expect(result.demotedTags).toEqual([]);
  });

  it("keeps every new tag when the policy is allow", () => {
    const result = capNewTagsWithoutVocabulary(
      { tags: [], new_tags: ["A", "B", "C"] },
      { policy: "allow", maxNewTags: 2 },
    );
    expect(result.newTags).toEqual(["A", "B", "C"]);
    expect(result.droppedTags).toEqual([]);
  });

  it("degrades fold_only to the cap instead of dropping everything", () => {
    const result = capNewTagsWithoutVocabulary(
      { tags: [], new_tags: ["A", "B", "C"] },
      { policy: "fold_only", maxNewTags: 1 },
    );
    expect(result.newTags).toEqual(["A"]);
    expect(result.droppedTags).toEqual(["B", "C"]);
  });

  it("de-duplicates and never repeats a reused tag as new", () => {
    const result = capNewTagsWithoutVocabulary(
      { tags: ["agent", "agent"], new_tags: ["Agent", "新概念", "新概念"] },
      { policy: "cap", maxNewTags: 5 },
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newTags).toEqual(["新概念"]);
  });
});
