import {
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
  normalizeTemperature,
} from "./types.js";

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

export function normalizeEndpointUrl(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(stripped)) {
    if (stripped.startsWith("http://") || stripped.startsWith("https://")) return stripped;
    return `http://${stripped}`;
  }
  if (stripped.startsWith("http://") || stripped.startsWith("https://")) {
    if (/\/v1$/i.test(stripped)) return stripped;
    try {
      const parsedUrl = new URL(stripped);
      if (parsedUrl.pathname === "" || parsedUrl.pathname === "/") return `${stripped}/v1`;
    } catch {
      return stripped;
    }
    return stripped;
  }
  if (/\/v1$/i.test(stripped)) return `http://${stripped}`;
  return `http://${stripped}/v1`;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const stripped = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(stripped)) return stripped;
  return `${stripped}/chat/completions`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface AssistantMessage {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function applyReasoningFields(body: Record<string, unknown>, reasoningEnabled: boolean): void {
  if (reasoningEnabled) {
    body.reasoning_effort = "medium";
    body.enable_thinking = true;
    body.chat_template_kwargs = { enable_thinking: true, thinking: true };
    body.thinking = { type: "enabled" };
    body.reasoning = { enabled: true, effort: "medium" };
    return;
  }
  body.reasoning_effort = "none";
  body.enable_thinking = false;
  body.chat_template_kwargs = { enable_thinking: false, thinking: false };
  body.thinking = { type: "disabled" };
  body.reasoning = { enabled: false, effort: "none" };
}

function assistantText(message: AssistantMessage | undefined): string {
  const content = textField(message?.content);
  if (content.length > 0) return content;
  const reasoningContent = textField(message?.reasoning_content);
  if (reasoningContent.length > 0) return reasoningContent;
  return textField(message?.reasoning);
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
      const url = buildChatCompletionsUrl(baseUrl);
      const reasoningEnabled = config.reasoningEnabled === true;
      const fallbackTemperature = reasoningEnabled
        ? DEFAULT_TEMPERATURE_REASONING_ON
        : DEFAULT_TEMPERATURE_REASONING_OFF;
      const temperature = normalizeTemperature(
        reasoningEnabled ? config.temperatureReasoningOn : config.temperatureReasoningOff,
        fallbackTemperature,
      );
      const body: Record<string, unknown> = {
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature,
        stream: false,
      };
      applyReasoningFields(body, reasoningEnabled);
      if (config.modelName) body.model = config.modelName;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.token) headers.Authorization = `Bearer ${config.token}`;

      try {
        const controller = new AbortController();
        const timeoutMs = config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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

        const message = (parsed as { choices?: Array<{ message?: AssistantMessage }> }).choices?.[0]?.message;
        const content = assistantText(message);
        if (content.length === 0) {
          escalateBackoff();
          return { empty: true };
        }
        const promptTokens = (parsed as { usage?: { prompt_tokens?: unknown } }).usage?.prompt_tokens;
        const tokenCount = typeof promptTokens === "number" ? promptTokens : 0;

        nextBackoffMs = 0;
        return { content, promptTokens: tokenCount };
      } catch (error) {
        const errorName = (error as Error)?.name;
        if ((error instanceof DOMException && error.name === "AbortError") || errorName === "AbortError") {
          escalateBackoff();
          return { error: "timeout" };
        }
        escalateBackoff();
        return { error: "network error" };
      }
    },
  };
}
