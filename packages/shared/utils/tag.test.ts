import { describe, expect, it } from "vitest";

import { getCanonicalTagsPrompt, getTagOutputContractPrompt } from "./tag";

describe("getCanonicalTagsPrompt", () => {
  it("renders nothing without a vocabulary", () => {
    expect(getCanonicalTagsPrompt(undefined)).toBe("");
    expect(getCanonicalTagsPrompt([])).toBe("");
  });

  it("lists the vocabulary and states the verbatim-reuse rule", () => {
    const prompt = getCanonicalTagsPrompt(["渗透测试", "安全工具"]);
    expect(prompt).toContain("CANONICAL_TAGS: [渗透测试, 安全工具]");
    expect(prompt).toContain("copied verbatim");
  });

  it("annotates entities with their one-line definition", () => {
    const prompt = getCanonicalTagsPrompt([
      "渗透测试",
      { name: "opencode", kind: "entity", definition: "开源编码代理 CLI" },
      { name: "Codex", kind: "entity" },
    ]);
    expect(prompt).toContain("opencode（实体：开源编码代理 CLI）");
    // Entities without a definition render as a bare name.
    expect(prompt).toContain("Codex");
    expect(prompt).not.toContain("Codex（实体：");
  });
});

describe("getTagOutputContractPrompt", () => {
  it("requests the dual-channel shape when a vocabulary exists", () => {
    const contract = getTagOutputContractPrompt({
      hasCanonicalTags: true,
      conceptMax: 2,
      entityMax: 4,
    });
    expect(contract).toContain('"tags"');
    expect(contract).toContain('"new_tags"');
    expect(contract).toContain('"kind"');
    expect(contract).toContain("at most 2 per bookmark");
    expect(contract).toContain("at most 4 per bookmark");
  });

  it("still requires both keys without a vocabulary (strict schema)", () => {
    const contract = getTagOutputContractPrompt({
      hasCanonicalTags: false,
      conceptMax: 2,
      entityMax: 4,
    });
    expect(contract).toContain('"tags"');
    expect(contract).toContain('"new_tags"');
    expect(contract).toContain("Always include both keys");
  });

  it("forbids the reserved state tags", () => {
    const contract = getTagOutputContractPrompt({
      hasCanonicalTags: true,
      conceptMax: 2,
      entityMax: 4,
    });
    expect(contract).toContain(
      "Never emit the reserved state tags 待读、已读、待整理",
    );
  });
});
