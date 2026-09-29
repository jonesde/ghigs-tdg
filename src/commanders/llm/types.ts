export const DEFAULT_LLM_SYSTEM_PROMPT =
  "You are an enemy commander in a tower-defense game. Route enemies toward the defender base and issue llm:routeGroup, llm:siegeTower, and llm:setTargeting commands.";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const MIN_REQUEST_TIMEOUT_MS = 1000;
export const MAX_REQUEST_TIMEOUT_MS = 180000;

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
}
