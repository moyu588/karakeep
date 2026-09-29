import { afterEach, describe, expect, it, vi } from "vitest";

import { JevClient } from "./tagGovernance";

const client = new JevClient({
  baseUrl: "https://jev.example.test/api",
  apiKey: "test-key",
  model: "jev-test",
  timeoutSec: 5,
});

describe("JevClient.chooseEquivalentTag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a choice request and parses the equivalent tag", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-key",
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          state: "Candidate tag: ip风险",
          model: "jev-test",
        });
        expect(body.questions).toMatchObject({
          tagMapping: {
            type: "choice",
          },
        });
        expect(body.questions).toHaveProperty("tagMapping.criteria.ip检测");
        expect(body.questions).toHaveProperty("tagMapping.criteria.NONE");
        return new Response(
          JSON.stringify({
            answers: {
              tagMapping: {
                choice: "ip检测",
                confidence: 0.96,
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client.chooseEquivalentTag("ip风险", ["ip检测", "AI"]),
    ).resolves.toEqual({
      choice: "ip检测",
      confidence: 0.96,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the NONE answer unchanged for no-match cases", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: {
              tagMapping: {
                choice: "NONE",
                confidence: 0.81,
              },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client.chooseEquivalentTag("react", ["ip检测", "AI"]),
    ).resolves.toEqual({
      choice: "NONE",
      confidence: 0.81,
    });
  });

  it("throws on HTTP errors so the caller can fall back", async () => {
    const fetchMock = vi.fn(
      async () => new Response("failed", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client.chooseEquivalentTag("ip风险", ["ip检测"]),
    ).rejects.toThrow("jev request failed: 500");
  });

  it("does not call jev when no canonical tags exist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.chooseEquivalentTag("ip风险", [])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
