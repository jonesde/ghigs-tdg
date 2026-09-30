export const DEFAULT_LLM_SYSTEM_PROMPT =
  "You are an enemy commander in a tower-defense game. Route enemies toward the defender base and issue llm:routeGroup, llm:siegeTower, llm:setTargeting, llm:setSpawnOrder, and llm:releaseHeld commands.";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const MIN_REQUEST_TIMEOUT_MS = 1000;
export const MAX_REQUEST_TIMEOUT_MS = 180000;

export const DEFAULT_DECISION_INTERVAL_MS = 1000;
export const MIN_DECISION_INTERVAL_MS = 1000;
export const MAX_DECISION_INTERVAL_MS = 10000;

export function normalizeDecisionIntervalMs(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DECISION_INTERVAL_MS &&
    value <= MAX_DECISION_INTERVAL_MS
  ) {
    return value;
  }
  return DEFAULT_DECISION_INTERVAL_MS;
}

export interface LlmCommanderConfig {
  id: string; // stable uuid/genId key
  name: string;
  endpointUrl: string; // required
  token: string; // optional
  modelName: string; // optional (empty => omit from request)
  contextLimit: number; // tokens; default 32768
  commanderInstructions: string; // optional, blank default
  systemPrompt: string; // required; defaulted from a const at create time
  requestTimeoutMs: number; // abort timer; default 30000, range 1000–180000
  pauseForCommander: boolean; // stop the sim clock while a request is in flight
  decisionIntervalMs: number; // gap after a request finishes; default 1000, range 1000–10000
  reasoningEnabled: boolean; // chat-completions reasoning fields; false sends the disable set
}
