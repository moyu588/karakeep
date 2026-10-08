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
});

describe("getTagOutputContractPrompt", () => {
  it("requests the dual-channel shape when a vocabulary exists", () => {
    const contract = getTagOutputContractPrompt(true);
    expect(contract).toContain('"tags"');
    expect(contract).toContain('"new_tags"');
  });

  it("still requires both keys without a vocabulary (strict schema)", () => {
    const contract = getTagOutputContractPrompt(false);
    expect(contract).toContain('"tags"');
    expect(contract).toContain('"new_tags"');
    expect(contract).toContain("Always include both keys");
  });
});
