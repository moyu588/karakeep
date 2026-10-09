import { describe, expect, it } from "vitest";

import {
  classifyWithoutVocabulary,
  partitionTagSuggestions,
} from "./tagOutput";

const vocabulary = ["渗透测试", "安全工具", "agent"];
const quotas = { conceptMax: 2, entityMax: 4 };

describe("partitionTagSuggestions", () => {
  it("keeps vocabulary tags as reuse and demotes unknown ones", () => {
    const result = partitionTagSuggestions(
      {
        tags: ["渗透测试", "自造标签"],
        new_tags: [{ name: "自造标签", kind: "concept" }],
      },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual(["渗透测试"]);
    expect(result.demotedTags).toEqual(["自造标签"]);
    // The demoted entry is re-proposed as a concept and kept (quota allows 2).
    expect(result.newConceptTags).toEqual(["自造标签"]);
  });

  it("reuses the vocabulary's own spelling for case variants", () => {
    const result = partitionTagSuggestions(
      { tags: ["Agent"] },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.demotedTags).toEqual([]);
  });

  it("applies independent per-axis quotas", () => {
    const result = partitionTagSuggestions(
      {
        tags: [],
        new_tags: [
          { name: "概念甲", kind: "concept" },
          { name: "概念乙", kind: "concept" },
          { name: "概念丙", kind: "concept" },
          { name: "Codex", kind: "entity" },
          { name: "claude_code", kind: "entity" },
          { name: "opencode", kind: "entity" },
          { name: "skills", kind: "entity" },
          { name: "Suricata", kind: "entity" },
        ],
      },
      vocabulary,
      quotas,
    );
    expect(result.newConceptTags).toEqual(["概念甲", "概念乙"]);
    expect(result.newEntityTags).toEqual([
      "Codex",
      "claude_code",
      "opencode",
      "skills",
    ]);
    expect(result.newTags).toEqual([
      "概念甲",
      "概念乙",
      "Codex",
      "claude_code",
      "opencode",
      "skills",
    ]);
    expect(result.droppedTags).toEqual(["概念丙", "Suricata"]);
  });

  it("never creates event tags and reports them for the 待读 fallback", () => {
    const result = partitionTagSuggestions(
      {
        tags: [],
        new_tags: [
          { name: "CISA-2022在野利用漏洞", kind: "event" },
          { name: "Codex", kind: "entity" },
        ],
      },
      vocabulary,
      quotas,
    );
    expect(result.droppedEventTags).toEqual(["CISA-2022在野利用漏洞"]);
    expect(result.newTags).toEqual(["Codex"]);
  });

  it("captures entity definitions for the entity registry", () => {
    const result = partitionTagSuggestions(
      {
        tags: [],
        new_tags: [
          { name: "opencode", kind: "entity", definition: "开源编码代理 CLI" },
        ],
      },
      vocabulary,
      quotas,
    );
    expect(result.entityDefinitions).toEqual([
      { name: "opencode", definition: "开源编码代理 CLI" },
    ]);
  });

  it("treats a missing kind as a concept (tightest quota)", () => {
    const result = partitionTagSuggestions(
      { tags: [], new_tags: [{ name: "未声明" }] },
      vocabulary,
      quotas,
    );
    expect(result.newConceptTags).toEqual(["未声明"]);
    expect(result.newEntityTags).toEqual([]);
  });

  it("promotes new_tags entries that already exist in the vocabulary", () => {
    const result = partitionTagSuggestions(
      { tags: [], new_tags: [{ name: "安全工具" }, { name: "真正的新概念" }] },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual(["安全工具"]);
    expect(result.newConceptTags).toEqual(["真正的新概念"]);
  });

  it("never lets the model emit the reserved state tag", () => {
    const result = partitionTagSuggestions(
      { tags: ["待读"], new_tags: [{ name: " 待读 " }] },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual([]);
    expect(result.newTags).toEqual([]);
    expect(result.reservedTags).toEqual(["待读", "待读"]);
  });

  it("de-duplicates repeated suggestions across both channels", () => {
    const result = partitionTagSuggestions(
      {
        tags: ["agent"],
        new_tags: [{ name: "新概念" }, { name: "新概念" }],
      },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newConceptTags).toEqual(["新概念"]);
  });

  it("ignores blank entries", () => {
    const result = partitionTagSuggestions(
      { tags: ["  ", "agent"], new_tags: [{ name: "" }] },
      vocabulary,
      quotas,
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newTags).toEqual([]);
  });
});

describe("classifyWithoutVocabulary", () => {
  it("passes the reuse channel through and still caps per axis", () => {
    const result = classifyWithoutVocabulary(
      {
        tags: ["渗透测试", "安全工具"],
        new_tags: [
          { name: "甲", kind: "concept" },
          { name: "乙", kind: "concept" },
          { name: "丙", kind: "concept" },
          { name: "Codex", kind: "entity" },
        ],
      },
      quotas,
    );
    expect(result.canonicalTags).toEqual(["渗透测试", "安全工具"]);
    expect(result.newConceptTags).toEqual(["甲", "乙"]);
    expect(result.newEntityTags).toEqual(["Codex"]);
    expect(result.droppedTags).toEqual(["丙"]);
    expect(result.demotedTags).toEqual([]);
  });

  it("drops events and reports them", () => {
    const result = classifyWithoutVocabulary(
      { new_tags: [{ name: "某事件-2024", kind: "event" }] },
      quotas,
    );
    expect(result.newTags).toEqual([]);
    expect(result.droppedEventTags).toEqual(["某事件-2024"]);
  });

  it("never repeats a reused tag as new", () => {
    const result = classifyWithoutVocabulary(
      { tags: ["agent"], new_tags: [{ name: "Agent", kind: "concept" }] },
      quotas,
    );
    expect(result.canonicalTags).toEqual(["agent"]);
    expect(result.newTags).toEqual([]);
  });
});
