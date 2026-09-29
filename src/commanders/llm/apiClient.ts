import type { LlmCommanderConfig } from "./types.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ApiResult = { content: string; promptTokens: number } | { empty: true } | { error: string };

export interface ApiClient {
  complete(systemPrompt: string, messages: ChatMessage[], config: LlmCommanderConfig): Promise<ApiResult>;
  waitForBackoff(): Promise<void>;
  getBackoffMs(): number;
}

const BASE_BACKOFF_MS = 3000;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_TEMPERATURE = 0.7;

export function normalizeEndpointUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const stripped = trimmed.replace(/\/+$/, "");
  if (/\/v1$/i.test(stripped)) return `http://${stripped}`;
  return `http://${stripped}/v1`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createApiClient(fetchFn: typeof fetch = globalThis.fetch): ApiClient {
  let nextBackoffMs = 0;
  let lastAttemptTimeMs = 0;

  function escalateBackoff(): void {
    const next = Math.max(BASE_BACKOFF_MS, nextBackoffMs * 2);
    nextBackoffMs = Math.min(MAX_BACKOFF_MS, next);
  }

  return {
    getBackoffMs(): number {
      return nextBackoffMs;
    },
    async waitForBackoff(): Promise<void> {
      if (lastAttemptTimeMs > 0) {
        const elapsedMs = Date.now() - lastAttemptTimeMs;
        const waitMs = nextBackoffMs - elapsedMs;
        if (waitMs > 0) await delay(waitMs);
      }
    },
    async complete(systemPrompt, messages, config): Promise<ApiResult> {
      lastAttemptTimeMs = Date.now();

      const baseUrl = normalizeEndpointUrl(config.endpointUrl);
      const url = `${baseUrl}/chat/completions`;
      const body: Record<string, unknown> = {
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: REQUEST_TEMPERATURE,
        stream: false,
      };
      if (config.modelName) body.model = config.modelName;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.token) headers.Authorization = `Bearer ${config.token}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          escalateBackoff();
          return { error: `status ${response.status}` };
        }

        const text = await response.text();
        if (!text) {
          escalateBackoff();
          return { empty: true };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          escalateBackoff();
          return { error: "invalid json" };
        }

        const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
          ?.content;
        if (typeof content !== "string" || content.length === 0) {
          escalateBackoff();
          return { empty: true };
        }
        const promptTokens = (parsed as { usage?: { prompt_tokens?: unknown } }).usage?.prompt_tokens;
        const tokenCount = typeof promptTokens === "number" ? promptTokens : 0;

        nextBackoffMs = 0;
        return { content, promptTokens: tokenCount };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          escalateBackoff();
          return { error: "timeout" };
        }
        escalateBackoff();
        return { error: "network error" };
      }
    },
  };
}
