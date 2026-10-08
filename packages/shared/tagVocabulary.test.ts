import { describe, expect, it } from "vitest";

import {
  buildCanonicalVocabulary,
  normalizeVocabularyName,
} from "./tagVocabulary";

const baseOptions = { maxTags: 200, maxChars: 1000, minUsage: 2 };

describe("normalizeVocabularyName", () => {
  it("collapses case and separators so spellings de-duplicate", () => {
    expect(normalizeVocabularyName(" Machine-Learning ")).toBe(
      "machinelearning",
    );
    expect(normalizeVocabularyName("machine_learning")).toBe("machinelearning");
    expect(normalizeVocabularyName("LLM")).toBe("llm");
  });
});

describe("buildCanonicalVocabulary", () => {
  it("drops tags below the minimum usage", () => {
    const vocabulary = buildCanonicalVocabulary(
      [
        { name: "常用", usage: 10 },
        { name: "一次性", usage: 1 },
      ],
      [],
      baseOptions,
    );
    expect(vocabulary).toEqual(["常用"]);
  });

  it("ranks by usage and prefers shorter tags on ties", () => {
    const vocabulary = buildCanonicalVocabulary(
      [
        { name: "B", usage: 5 },
        { name: "A", usage: 5 },
        { name: "高", usage: 9 },
      ],
      [],
      baseOptions,
    );
    expect(vocabulary).toEqual(["高", "A", "B"]);
  });

  it("appends similar-bookmark tags after the global ranking", () => {
    const vocabulary = buildCanonicalVocabulary(
      [{ name: "全局", usage: 3 }],
      ["邻居一", "邻居二"],
      baseOptions,
    );
    expect(vocabulary).toEqual(["全局", "邻居一", "邻居二"]);
  });

  it("de-duplicates across global and neighbour sources", () => {
    const vocabulary = buildCanonicalVocabulary(
      [{ name: "GitHub", usage: 4 }],
      ["github", "GitHub-"],
      baseOptions,
    );
    expect(vocabulary).toEqual(["GitHub"]);
  });

  it("respects the tag-count cap", () => {
    const vocabulary = buildCanonicalVocabulary(
      Array.from({ length: 20 }, (_, i) => ({
        name: `tag-${i}`,
        usage: 5,
      })),
      [],
      { ...baseOptions, maxTags: 3 },
    );
    expect(vocabulary).toHaveLength(3);
  });

  it("respects the character budget but keeps scanning shorter tags", () => {
    const vocabulary = buildCanonicalVocabulary(
      [
        { name: "这是一个非常非常长的标签名称", usage: 10 },
        { name: "短", usage: 2 },
      ],
      [],
      { ...baseOptions, maxChars: 5 },
    );
    expect(vocabulary).toEqual(["短"]);
  });

  it("excludes tags rejected by the predicate", () => {
    const vocabulary = buildCanonicalVocabulary(
      [
        { name: "example.com", usage: 10 },
        { name: "正常", usage: 3 },
      ],
      ["foo.bar"],
      { ...baseOptions, isExcluded: (n) => n.includes(".") },
    );
    expect(vocabulary).toEqual(["正常"]);
  });
});
