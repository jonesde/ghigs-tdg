import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import {
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import { cloneCommanderConfig } from "@/commanders/relay.js";

describe("cloneCommanderConfig", () => {
  it("copies a reactive commander into an object structuredClone accepts", () => {
    const config = reactive<LlmCommanderConfig>({
      id: "c",
      name: "Ornith",
      endpointUrl: "http://localhost:1234/v1",
      token: "",
      modelName: "ornith",
      contextLimit: 32768,
      commanderInstructions: "",
      systemPrompt: "sys",
      requestTimeoutMs: 30000,
      pauseForCommander: true,
      decisionIntervalMs: 1000,
      reasoningEnabled: false,
      temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
      temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
    });
    const cloned = cloneCommanderConfig(config);
    expect(cloned).not.toBe(config);
    expect(cloned.pauseForCommander).toBe(true);
    expect(structuredClone(cloned)).toEqual(cloned);
  });
});
