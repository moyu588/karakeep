import { describe, expect, it } from "vitest";

import { filterUrlLikeTags, isUrlLikeTag } from "./tagValidation";

describe("tag URL validation", () => {
  it("rejects URLs and domains", () => {
    expect(isUrlLikeTag("https://ipcheck.ing/#/")).toBe(true);
    expect(isUrlLikeTag("http://example.com")).toBe(true);
    expect(isUrlLikeTag("www.example.com")).toBe(true);
    expect(isUrlLikeTag("ipcheck.ing")).toBe(true);
    expect(isUrlLikeTag("example.com/path")).toBe(true);
  });

  it("accepts product and concept tags containing dots or hyphens", () => {
    expect(isUrlLikeTag("Node.js")).toBe(false);
    expect(isUrlLikeTag("IP检测")).toBe(false);
    expect(isUrlLikeTag("Prompt_Injection")).toBe(false);
    expect(isUrlLikeTag("Web搜索")).toBe(false);
  });

  it("filters URL-like tags", () => {
    expect(filterUrlLikeTags(["IPCheck.ing", "IP检测", "开源"])).toEqual([
      "IP检测",
      "开源",
    ]);
  });
});
