import { describe, expect, it } from "vitest";
import { parseTitleResponseForTest } from "./titleInternal";

describe("title optimization response parsing", () => {
  it("parses compact JSON", () => {
    expect(parseTitleResponseForTest('{"title":"浏览器自动化工具"}')).toBe(
      "浏览器自动化工具",
    );
  });

  it("recovers a quoted title from plain text", () => {
    expect(parseTitleResponseForTest('prefix {"title":"AI agents"} suffix')).toBe(
      "AI agents",
    );
  });

  it("returns null for unusable output", () => {
    expect(parseTitleResponseForTest("not json")).toBeNull();
  });
});
