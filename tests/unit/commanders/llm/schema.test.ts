import { describe, expect, it } from "vitest";
import { validateLlmResponse } from "@/commanders/llm/schema.js";
import { DEFAULT_LLM_SYSTEM_PROMPT, type LlmCommanderConfig } from "@/commanders/llm/types.js";

const config: LlmCommanderConfig = {
  id: "c",
  name: "c",
  endpointUrl: "http://x",
  token: "",
  modelName: "",
  contextLimit: 32768,
  commanderInstructions: "",
  systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
  requestTimeoutMs: 30000,
  pauseForCommander: false,
};

describe("validateLlmResponse", () => {
  it("accepts a bare array of allowed commands", () => {
    const result = validateLlmResponse(
      [
        { type: "llm:routeGroup", enemyIds: [1, 2], waypoints: [{ x: 3, y: 4 }] },
        { type: "llm:setTargeting", enemyIds: [5], mode: "aggressive" },
      ],
      config,
    );
    expect(result.error).toBeUndefined();
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]!.type).toBe("llm:routeGroup");
    expect(result.commands[1]!.type).toBe("llm:setTargeting");
  });

  it("accepts a wrapped object with chat", () => {
    const result = validateLlmResponse(
      { commands: [{ type: "llm:routeGroup", enemyIds: [1], waypoints: [] }], chat: "hello player" },
      config,
    );
    expect(result.error).toBeUndefined();
    expect(result.commands).toHaveLength(1);
    expect(result.chat).toBe("hello player");
  });

  it("rejects disallowed command types", () => {
    const result = validateLlmResponse(
      [{ type: "llm:gridLayoutToggle" }, { type: "llm:routeGroup", enemyIds: [1], waypoints: [] }],
      config,
    );
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.type).toBe("llm:routeGroup");
    expect(result.error).toContain("rejected command type");
  });

  it("drops commands with no valid enemy ids", () => {
    const result = validateLlmResponse(
      [
        { type: "llm:routeGroup", enemyIds: [], waypoints: [] },
        { type: "llm:setTargeting", enemyIds: ["x"], mode: "a" },
      ],
      config,
    );
    expect(result.commands).toHaveLength(0);
  });

  it("drops setTargeting without a mode", () => {
    const result = validateLlmResponse([{ type: "llm:setTargeting", enemyIds: [1] }], config);
    expect(result.commands).toHaveLength(0);
  });

  it("returns an error for non-array / malformed responses", () => {
    expect(validateLlmResponse({ commands: "nope" }, config).error).toBeDefined();
    expect(validateLlmResponse(42, config).error).toBeDefined();
    expect(validateLlmResponse(null, config).error).toBeDefined();
  });

  it("preserves hold + holdTile on routeGroup", () => {
    const result = validateLlmResponse(
      [{ type: "llm:routeGroup", enemyIds: [1], hold: true, holdTile: { x: 2, y: 3 }, waypoints: [] }],
      config,
    );
    const command = result.commands[0];
    expect(command?.type).toBe("llm:routeGroup");
    if (command?.type === "llm:routeGroup") {
      expect(command.hold).toBe(true);
      expect(command.holdTile).toEqual({ x: 2, y: 3 });
    }
  });
});
