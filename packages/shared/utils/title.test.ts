import { describe, expect, it } from "vitest";
import { isLowQualityTitle, truncateTitle } from "./title";

describe("isLowQualityTitle", () => {
  it("detects missing, URL-like, hash and challenge titles", () => {
    expect(isLowQualityTitle(null)).toBe(true);
    expect(isLowQualityTitle("   ")).toBe(true);
    expect(isLowQualityTitle("https://example.com/article")).toBe(true);
    expect(isLowQualityTitle("Just a moment...")).toBe(true);
    expect(isLowQualityTitle("8f14e45fceea167a5a36dedd4bea2543")).toBe(true);
  });

  it("detects GitHub and slug titles", () => {
    expect(
      isLowQualityTitle(
        "GitHub - browser-use/browser-use: Make websites accessible for AI agents",
      ),
    ).toBe(true);
    expect(isLowQualityTitle("some-long-project-name-alpha")).toBe(true);
  });

  it("keeps normal article titles", () => {
    expect(isLowQualityTitle("如何使用 React Server Components")).toBe(false);
    expect(
      isLowQualityTitle("Make websites accessible for AI agents"),
      "A normal sentence should not be treated as a slug",
    ).toBe(false);
  });

  it("detects a title equal to the URL host", () => {
    expect(isLowQualityTitle("example.com", "https://example.com/post")).toBe(
      true,
    );
  });
});

describe("truncateTitle", () => {
  it("normalizes whitespace and truncates safely", () => {
    expect(truncateTitle("  A    title  ")).toBe("A title");
    expect(truncateTitle("a".repeat(121), 120)).toHaveLength(120);
  });
});
