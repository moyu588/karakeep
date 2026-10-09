import { describe, expect, it } from "vitest";

import {
  explicitEquivalenceKey,
  foldExplicitEquivalents,
  isFoldExemptTag,
  isNamespaceTag,
  isReservedTag,
  matchExplicitEquivalent,
  PENDING_READ_TAG,
} from "./tagEquivalence";

describe("reserved and namespace tags", () => {
  it("recognizes the system state tags", () => {
    expect(isReservedTag(PENDING_READ_TAG)).toBe(true);
    expect(isReservedTag(" 待读 ")).toBe(true);
    expect(isReservedTag("已读")).toBe(true);
    expect(isReservedTag("渗透测试")).toBe(false);
  });

  it("treats namespaced tags as fold-exempt", () => {
    expect(isNamespaceTag("harness:codex")).toBe(true);
    expect(isFoldExemptTag("harness:codex")).toBe(true);
    expect(isFoldExemptTag(PENDING_READ_TAG)).toBe(true);
    expect(isFoldExemptTag("codex")).toBe(false);
  });
});

describe("explicitEquivalenceKey", () => {
  it("folds case, spacing, hyphens and punctuation", () => {
    expect(explicitEquivalenceKey("claude_code")).toBe(
      explicitEquivalenceKey("Claude Code"),
    );
    expect(explicitEquivalenceKey("Prompt-Injection")).toBe(
      explicitEquivalenceKey("promptinjection"),
    );
  });

  it("folds English plurals on the last word", () => {
    expect(explicitEquivalenceKey("skills")).toBe(
      explicitEquivalenceKey("skill"),
    );
    expect(explicitEquivalenceKey("AI agents")).toBe(
      explicitEquivalenceKey("AI agent"),
    );
    expect(explicitEquivalenceKey("queries")).toBe(
      explicitEquivalenceKey("query"),
    );
  });

  it("keeps different products apart", () => {
    expect(explicitEquivalenceKey("codex")).not.toBe(
      explicitEquivalenceKey("opencode"),
    );
    expect(explicitEquivalenceKey("claude_code")).not.toBe(
      explicitEquivalenceKey("codex"),
    );
  });
});

describe("matchExplicitEquivalent", () => {
  const candidates = [
    { name: "claude_code" },
    { name: "渗透测试" },
    { name: PENDING_READ_TAG },
  ];

  it("folds case/punctuation variants onto the existing spelling", () => {
    expect(matchExplicitEquivalent("Claude Code", candidates)).toEqual({
      input: "Claude Code",
      matched: "claude_code",
      reason: "normalized",
    });
  });

  it("reports plural folding separately", () => {
    expect(
      matchExplicitEquivalent("AI agent", [{ name: "AI agents" }]),
    ).toEqual({
      input: "AI agent",
      matched: "AI agents",
      reason: "plural",
    });
  });

  it("never folds into a reserved or namespaced target", () => {
    expect(matchExplicitEquivalent("待读", candidates)).toBeNull();
    expect(
      matchExplicitEquivalent("codex", [{ name: "harness:codex" }]),
    ).toBeNull();
  });

  it("leaves semantically neighbouring names alone", () => {
    expect(matchExplicitEquivalent("opencode", candidates)).toBeNull();
  });
});

describe("foldExplicitEquivalents", () => {
  it("splits inputs into folded and kept", () => {
    const { folded, kept } = foldExplicitEquivalents(
      ["Claude Code", "opencode", "渗透测试"],
      [{ name: "claude_code" }, { name: "渗透测试" }],
    );
    expect(folded.map((m) => `${m.input}->${m.matched}`)).toEqual([
      "Claude Code->claude_code",
      "渗透测试->渗透测试",
    ]);
    expect(kept).toEqual(["opencode"]);
  });

  it("de-duplicates plural variants of the same input", () => {
    const { kept } = foldExplicitEquivalents(["skill", "skills"], []);
    expect(kept).toEqual(["skill"]);
  });

  it("drops reserved inputs instead of keeping them", () => {
    const { folded, kept } = foldExplicitEquivalents(
      [PENDING_READ_TAG, "codex"],
      [],
    );
    expect(folded).toEqual([]);
    expect(kept).toEqual(["codex"]);
  });
});
