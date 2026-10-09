import { describe, expect, it } from "vitest";

import {
  entityDefinitionFor,
  isRegisteredEntity,
  parseEntityRegistry,
  serializeEntityRegistry,
  upsertEntityEntries,
} from "./tagEntityRegistry";

describe("parseEntityRegistry", () => {
  it("degrades to an empty registry for missing or corrupt values", () => {
    expect(parseEntityRegistry(null)).toEqual({});
    expect(parseEntityRegistry("")).toEqual({});
    expect(parseEntityRegistry("not json")).toEqual({});
    expect(parseEntityRegistry("[1,2]")).toEqual({});
    expect(parseEntityRegistry('{"x": 5}')).toEqual({});
  });

  it("round-trips a serialized registry", () => {
    const registry = upsertEntityEntries(
      {},
      [{ name: "opencode", definition: "开源编码代理 CLI" }, { name: "Codex" }],
      1700000000000,
    );
    const parsed = parseEntityRegistry(serializeEntityRegistry(registry));
    expect(Object.keys(parsed).sort()).toEqual(["codex", "opencode"]);
    expect(entityDefinitionFor(parsed, "OpenCode")).toBe("开源编码代理 CLI");
    expect(entityDefinitionFor(parsed, "codex")).toBeUndefined();
    expect(isRegisteredEntity(parsed, "CODEX")).toBe(true);
    expect(isRegisteredEntity(parsed, "claude_code")).toBe(false);
  });
});

describe("upsertEntityEntries", () => {
  it("keeps a previously stored definition when the update omits it", () => {
    const first = upsertEntityEntries(
      {},
      [{ name: "opencode", definition: "开源编码代理 CLI" }],
      1,
    );
    const second = upsertEntityEntries(first, [{ name: "opencode" }], 2);
    expect(entityDefinitionFor(second, "opencode")).toBe("开源编码代理 CLI");
    expect(second["opencode"].updatedAt).toBe(2);
  });

  it("replaces the definition when a new one is supplied", () => {
    const first = upsertEntityEntries(
      {},
      [{ name: "opencode", definition: "旧定义" }],
      1,
    );
    const second = upsertEntityEntries(
      first,
      [{ name: "OpenCode", definition: "新定义" }],
      2,
    );
    expect(second["opencode"]).toEqual({
      name: "OpenCode",
      definition: "新定义",
      updatedAt: 2,
    });
  });

  it("ignores blank names", () => {
    expect(upsertEntityEntries({}, [{ name: "  " }], 1)).toEqual({});
  });
});
