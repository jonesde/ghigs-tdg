import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/commanders/llm/systemPrompt.js";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE_REASONING_OFF,
  DEFAULT_TEMPERATURE_REASONING_ON,
  type LlmCommanderConfig,
} from "@/commanders/llm/types.js";
import { getGameContent } from "@/content/gameContent.js";

function makeConfig(): LlmCommanderConfig {
  return {
    id: "llm1",
    name: "LLM 1",
    endpointUrl: "http://localhost:1234/v1",
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
}

describe("buildSystemPrompt", () => {
  it("fills victory, tower scaling, navmesh, and the engagement commands from live content", () => {
    const prompt = buildSystemPrompt(makeConfig());
    expect(prompt).toContain(`wave ${getGameContent().economy.victoryWave}`);
    expect(prompt).toContain(`damage * ${getGameContent().towers.tuning.levelDmgMult}^(level-1)`);
    expect(prompt).toContain(`fireRate * ${getGameContent().towers.tuning.levelRateMult}^(level-1)`);
    expect(prompt).toContain(`range * ${getGameContent().towers.tuning.levelRangeMult}^(level-1)`);
    expect(prompt).toContain(`health * ${getGameContent().towers.tuning.levelHealthMult}^(level-1)`);
    expect(prompt).toContain("hp = baseHp * (");
    expect(prompt).toContain(`(1 + ${getGameContent().enemies.waveHpMult} * (wave - 1))`);
    expect(prompt).toContain("damage = attackDamage * (");
    expect(prompt).toContain(`(1 + ${getGameContent().enemies.waveDamageMult} * (wave - 1))`);
    expect(prompt).toContain("Recast navmesh");
    expect(prompt).toContain("DetourCrowd");
    expect(prompt).not.toContain("BFS");
    expect(prompt).toContain("llm:siegeTower");
    expect(prompt).toContain("llm:setTargeting");
    expect(prompt).toContain("llm:setSpawnOrder");
    expect(prompt).toContain("llm:releaseHeld");
    expect(prompt).toContain("spawnOrders");
    expect(prompt).toContain("override any shorter command list");
    expect(prompt).toContain("distanceToBase");
    expect(prompt).toContain("baseHp");
    expect(prompt).toContain("countdownSeconds");
    expect(prompt).toContain("snapped distanceToBase");
    expect(prompt).toContain("flyingHeight=2");
    expect(prompt).toContain("flyingHeight=3");
    expect(prompt).toContain("flyingHeight=5");
    expect(prompt).toContain("plus 1 when a live tower occupies that tile");
    expect(prompt).toContain("straight segment");
    expect(prompt).toContain("once on entry");
    for (const mode of ["default", "base", "nearest", "strongest", "weakest", "strongestAhead"]) {
      expect(prompt).toContain(mode);
    }
  });
});
