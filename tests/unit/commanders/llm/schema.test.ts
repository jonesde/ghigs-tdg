import { describe, expect, it } from "vitest";
import { validateLlmResponse } from "@/commanders/llm/schema.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";

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
  decisionIntervalMs: 1000,
  reasoningEnabled: false,
  temperatureReasoningOff: DEFAULT_TEMPERATURE_REASONING_OFF,
  temperatureReasoningOn: DEFAULT_TEMPERATURE_REASONING_ON,
};

describe("validateLlmResponse", () => {
  it("accepts a bare array of allowed commands", () => {
    const result = validateLlmResponse(
      [
        { type: "llm:routeGroup", enemyIds: [1, 2], waypoints: [{ x: 3, y: 4 }] },
        { type: "llm:setTargeting", enemyIds: [5], mode: "nearest" },
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
        { type: "llm:setTargeting", enemyIds: ["x"], mode: "nearest" },
      ],
      config,
    );
    expect(result.commands).toHaveLength(0);
    expect(result.error).toBe("empty enemyIds");
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

  it("accepts a spawn order and a release, and soft-rejects an empty or mixed order", () => {
    const result = validateLlmResponse(
      [
        { type: "llm:setSpawnOrder", hold: true, targetingMode: "base" },
        { type: "llm:setSpawnOrder" },
        { type: "llm:setSpawnOrder", clear: true, hold: true },
        { type: "llm:setSpawnOrder", hold: true, waypoints: [{ x: 1, y: 1 }] },
        { type: "llm:releaseHeld", wave: 4, spawnIndex: 0 },
        { type: "llm:routeGroup", enemyIds: [9], waypoints: [] },
      ],
      config,
    );
    expect(result.commands.map((command) => command.type)).toEqual([
      "llm:setSpawnOrder",
      "llm:releaseHeld",
      "llm:routeGroup",
    ]);
    expect(result.error).toBe("setSpawnOrder is empty");
    const spawnOrder = result.commands[0];
    if (spawnOrder?.type === "llm:setSpawnOrder") {
      expect(spawnOrder.hold).toBe(true);
      expect(spawnOrder.targetingMode).toBe("base");
    }
    const release = result.commands[1];
    if (release?.type === "llm:releaseHeld") {
      expect(release.wave).toBe(4);
      expect(release.spawnIndex).toBe(0);
    }
  });
});
