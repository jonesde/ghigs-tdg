export const DEFAULT_LLM_SYSTEM_PROMPT =
  "You are an enemy commander in a tower-defense game. Route enemies toward the defender base and issue llm:routeGroup, llm:siegeTower, and llm:setTargeting commands.";

export interface LlmCommanderConfig {
  id: string; // stable uuid/genId key
  name: string;
  endpointUrl: string; // required
  token: string; // optional
  modelName: string; // optional (empty => omit from request)
  contextLimit: number; // tokens; default 32768
  commanderInstructions: string; // optional, blank default
  systemPrompt: string; // required; defaulted from a const at create time
}
