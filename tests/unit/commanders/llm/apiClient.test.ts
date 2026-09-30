import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatCompletionsUrl, createApiClient, normalizeEndpointUrl } from "@/commanders/llm/apiClient.js";
import {
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";

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
    decisionIntervalMs: 1000,
    reasoningEnabled: false,
    temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
    temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
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
  it("appends /v1 to an http(s) URL with no path", () => {
    expect(normalizeEndpointUrl("https://example.com")).toBe("https://example.com/v1");
    expect(normalizeEndpointUrl("http://localhost:8080")).toBe("http://localhost:8080/v1");
    expect(normalizeEndpointUrl("http://localhost:8080/")).toBe("http://localhost:8080/v1");
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
  it("keeps an http(s) URL that already ends in /v1", () => {
    expect(normalizeEndpointUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
    expect(normalizeEndpointUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
  });
  it("keeps a full /chat/completions URL as the request base", () => {
    expect(normalizeEndpointUrl("http://localhost:1234/v1/chat/completions")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
    expect(normalizeEndpointUrl("localhost:1234/v1/chat/completions")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
  });
  it("keeps an http(s) URL with a custom path stored as entered", () => {
    expect(normalizeEndpointUrl("https://example.com/custom/path")).toBe("https://example.com/custom/path");
  });
});

describe("buildChatCompletionsUrl", () => {
  it("appends /chat/completions to a /v1 base", () => {
    expect(buildChatCompletionsUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1/chat/completions");
  });
  it("does not duplicate /chat/completions when the base already ends with it", () => {
    expect(buildChatCompletionsUrl("http://localhost:1234/v1/chat/completions")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
    expect(buildChatCompletionsUrl("http://localhost:1234/v1/chat/completions/")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
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
    expect(body.temperature).toBe(DEFAULT_TEMPERATURE_REASONING_OFF);
    expect(body.reasoning_effort).toBe("none");
    expect(body.enable_thinking).toBe(false);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning).toEqual({ enabled: false, effort: "none" });
  });

  it("sends the enable set when reasoningEnabled is true", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse({ choices: [{ message: { content: "hi" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    await client.complete("sys", [], makeConfig({ reasoningEnabled: true }));
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.enable_thinking).toBe(true);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true, thinking: true });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning).toEqual({ enabled: true, effort: "medium" });
    expect(body.temperature).toBe(DEFAULT_TEMPERATURE_REASONING_ON);
  });

  it("selects the configured temperature per reasoning flag", async () => {
    const seenTemperatures: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seenTemperatures.push(JSON.parse(init!.body as string).temperature);
      return okResponse({ choices: [{ message: { content: "x" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    await client.complete(
      "sys",
      [],
      makeConfig({ reasoningEnabled: false, temperatureReasoningOff: 1.2, temperatureReasoningOn: 0.3 }),
    );
    await client.complete(
      "sys",
      [],
      makeConfig({ reasoningEnabled: true, temperatureReasoningOff: 1.2, temperatureReasoningOn: 0.3 }),
    );
    expect(seenTemperatures).toEqual([1.2, 0.3]);
  });

  it("falls back to temperature defaults when the config fields are undefined", async () => {
    const seenTemperatures: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seenTemperatures.push(JSON.parse(init!.body as string).temperature);
      return okResponse({ choices: [{ message: { content: "x" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    const withoutTemperatures = makeConfig() as Partial<LlmCommanderConfig>;
    delete withoutTemperatures.temperatureReasoningOff;
    delete withoutTemperatures.temperatureReasoningOn;
    await client.complete("sys", [], { ...withoutTemperatures, reasoningEnabled: false } as LlmCommanderConfig);
    await client.complete("sys", [], { ...withoutTemperatures, reasoningEnabled: true } as LlmCommanderConfig);
    expect(seenTemperatures).toEqual([DEFAULT_TEMPERATURE_REASONING_OFF, DEFAULT_TEMPERATURE_REASONING_ON]);
  });

  it("clamps an out-of-range configured temperature to the default", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse({ choices: [{ message: { content: "x" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    await client.complete("sys", [], makeConfig({ temperatureReasoningOff: 9 }));
    expect(JSON.parse(capturedInit!.body as string).temperature).toBe(DEFAULT_TEMPERATURE_REASONING_OFF);
  });

  it("posts to a full /chat/completions endpoint without duplicating the path", async () => {
    const seenUrls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      seenUrls.push(url);
      return okResponse({ choices: [{ message: { content: "x" } }] });
    });
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    await client.complete("sys", [], makeConfig({ endpointUrl: "http://localhost:1234/v1/chat/completions" }));
    await client.complete("sys", [], makeConfig({ endpointUrl: "http://localhost:1234/v1" }));
    expect(seenUrls).toEqual([
      "http://localhost:1234/v1/chat/completions",
      "http://localhost:1234/v1/chat/completions",
    ]);
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

  it("uses reasoning_content when content is empty and ignores it when content is present", async () => {
    const reasoningFetch = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: "", reasoning_content: "thought then []" } }] }),
    );
    const reasoningClient = createApiClient(reasoningFetch as unknown as typeof fetch);
    expect(await reasoningClient.complete("sys", [], makeConfig())).toEqual({
      content: "thought then []",
      promptTokens: 0,
    });

    const contentFetch = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: "[]", reasoning_content: "thought" } }] }),
    );
    const contentClient = createApiClient(contentFetch as unknown as typeof fetch);
    expect(await contentClient.complete("sys", [], makeConfig())).toEqual({ content: "[]", promptTokens: 0 });

    const emptyFetch = vi.fn(async () => okResponse({ choices: [{ message: { content: "" } }] }));
    const emptyClient = createApiClient(emptyFetch as unknown as typeof fetch);
    expect(await emptyClient.complete("sys", [], makeConfig())).toEqual({ empty: true });
  });

  it("uses reasoning when reasoning_content is absent", async () => {
    const fetchFn = vi.fn(async () => okResponse({ choices: [{ message: { reasoning: "only reasoning" } }] }));
    const client = createApiClient(fetchFn as unknown as typeof fetch);
    expect(await client.complete("sys", [], makeConfig())).toEqual({ content: "only reasoning", promptTokens: 0 });
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

  it("returns {error: 'timeout'} on a non-DOMException abort", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchFn = vi.fn(async () => {
      throw abortError;
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
