import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, normalizeEndpointUrl } from "@/commanders/llm/apiClient.js";
import type { LlmCommanderConfig } from "@/commanders/llm/types.js";

function makeConfig(overrides: Partial<LlmCommanderConfig> = {}): LlmCommanderConfig {
  return {
    id: "test",
    name: "Test",
    endpointUrl: "http://localhost:1234/v1",
    token: "",
    modelName: "",
    contextLimit: 32768,
    commanderInstructions: "",
    systemPrompt: "system",
    requestTimeoutMs: 30000,
    pauseForCommander: false,
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
}

function statusResponse(status: number): Response {
  return { ok: false, status, text: async () => "" } as unknown as Response;
}

describe("normalizeEndpointUrl", () => {
  it("uses http(s) verbatim", () => {
    expect(normalizeEndpointUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeEndpointUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });
  it("treats bare host:port as http://host/v1", () => {
    expect(normalizeEndpointUrl("localhost:1234")).toBe("http://localhost:1234/v1");
    expect(normalizeEndpointUrl("ollama")).toBe("http://ollama/v1");
  });
  it("does not append a second /v1 when the bare path already ends in /v1", () => {
    expect(normalizeEndpointUrl("localhost:1234/v1")).toBe("http://localhost:1234/v1");
    expect(normalizeEndpointUrl("localhost:1234/v1/")).toBe("http://localhost:1234/v1");
    expect(normalizeEndpointUrl(normalizeEndpointUrl("localhost:1234/v1"))).toBe("http://localhost:1234/v1");
  });
  it("keeps an http(s) URL verbatim", () => {
    expect(normalizeEndpointUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
  });
});

describe("createApiClient.complete", () => {
  afterEach(() => vi.useRealTimers());

  it("returns content + prompt tokens on success", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 42 } });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    const result = await client.complete("sys", [{ role: "user", content: "hi" }], makeConfig());
    expect(result).toEqual({ content: "hi", promptTokens: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.model).toBeUndefined();
    expect(body.temperature).toBe(0.2);
  });

  it("omits model when empty and sends Bearer token when set", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse({ choices: [{ message: { content: "x" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    await client.complete("sys", [], makeConfig({ modelName: "llama3", token: "sekret" }));
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.model).toBe("llama3");
    expect((capturedInit!.headers as Record<string, string>).Authorization).toBe("Bearer sekret");
  });

  it("returns {empty} on empty body", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }) as unknown as Response);
    const client = createApiClient(fetchFn);
    expect(await client.complete("sys", [], makeConfig())).toEqual({ empty: true });
  });

  it("returns {error} on non-2xx", async () => {
    const fetchFn = vi.fn(async () => statusResponse(500));
    const client = createApiClient(fetchFn);
    expect(await client.complete("sys", [], makeConfig())).toEqual({ error: "status 500" });
  });

  it("returns {error} on invalid json", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => "not json" }) as unknown as Response);
    const client = createApiClient(fetchFn);
    expect(await client.complete("sys", [], makeConfig())).toEqual({ error: "invalid json" });
  });

  it("aborts a hanging fetch after requestTimeoutMs", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    let settled = false;
    const pending = client.complete("sys", [], makeConfig({ requestTimeoutMs: 50 })).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ error: "timeout" });
  });

  it("aborts a hanging fetch at the default timeout", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    let settled = false;
    const pending = client.complete("sys", [], makeConfig()).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(29999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ error: "timeout" });
  });

  it("returns {error: 'timeout'} on abort", async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const client = createApiClient(fetchFn);
    expect(await client.complete("sys", [], makeConfig())).toEqual({ error: "timeout" });
  });

  it("escalates back-off on failure and resets on success", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchFn = vi.fn(async () => {
      callCount += 1;
      if (callCount < 3) return statusResponse(500);
      return okResponse({ choices: [{ message: { content: "ok" } }] });
    });
    const client = createApiClient(fetchFn);
    await client.complete("sys", [], makeConfig());
    expect(client.getBackoffMs()).toBe(3000);

    const pendingWait = client.waitForBackoff();
    await vi.advanceTimersByTimeAsync(3000);
    await pendingWait;
    await client.complete("sys", [], makeConfig());
    expect(client.getBackoffMs()).toBe(6000);

    const pendingWaitAgain = client.waitForBackoff();
    await vi.advanceTimersByTimeAsync(6000);
    await pendingWaitAgain;
    await client.complete("sys", [], makeConfig());
    expect(client.getBackoffMs()).toBe(0);
  });
});
