import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  matchTagsForAbsorption,
  normalizeTagForAbsorption,
} from "./tagAbsorption";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("handles empty, mismatched and zero vectors", () => {
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("normalizeTagForAbsorption", () => {
  it("collapses case, separators and punctuation variants", () => {
    expect(normalizeTagForAbsorption("Machine-Learning")).toBe("machine learning");
    expect(normalizeTagForAbsorption("AI/ML!")).toBe("aiml");
    expect(normalizeTagForAbsorption("  LLM  ")).toBe("llm");
  });
});

describe("matchTagsForAbsorption", () => {
  const candidates = [
    { name: "Machine Learning", embedding: [1, 0] },
    { name: "LLM", embedding: [0, 1] },
  ];

  it("absorbs exact normalized matches regardless of embedding", () => {
    const { absorbed, fresh } = matchTagsForAbsorption(
      [{ name: "machine-learning", embedding: [0.1, 0.9] }],
      candidates,
      0.85,
    );
    expect(absorbed).toEqual([
      { input: "machine-learning", matched: "Machine Learning", similarity: 1 },
    ]);
    expect(fresh).toEqual([]);
  });

  it("absorbs close suggestions and keeps dissimilar ones fresh", () => {
    const { absorbed, fresh } = matchTagsForAbsorption(
      [
        { name: "Deep Learning", embedding: [0.9, 0.1] },
        { name: "Cooking", embedding: [-1, 0] },
      ],
      candidates,
      0.85,
    );
    expect(absorbed.map((m) => m.matched)).toEqual(["Machine Learning"]);
    expect(fresh).toEqual(["Cooking"]);
  });

  it("lets the most similar input claim a candidate first", () => {
    const { absorbed, fresh } = matchTagsForAbsorption(
      [
        { name: "Weak Match", embedding: [0.7, 0.1] },
        { name: "Strong Match", embedding: [1, 0] },
      ],
      [{ name: "Machine Learning", embedding: [1, 0] }],
      0.85,
    );
    expect(absorbed.map((m) => m.input)).toEqual(["Strong Match"]);
    expect(fresh).toEqual(["Weak Match"]);
  });

  it("absorbs suggestions that exactly hit an alias name via candidates", () => {
    const { absorbed, fresh } = matchTagsForAbsorption(
      [{ name: "AI/ML!", embedding: [0, 1] }],
      [{ name: "AI ML", embedding: [0, 1] }],
      0.99,
    );
    expect(absorbed).toEqual([
      { input: "AI/ML!", matched: "AI ML", similarity: 1 },
    ]);
    expect(fresh).toEqual([]);
  });
});
