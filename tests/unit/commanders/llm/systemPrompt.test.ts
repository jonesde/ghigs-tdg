import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/commanders/llm/systemPrompt.js";
import { DEFAULT_LLM_SYSTEM_PROMPT, type LlmCommanderConfig } from "@/commanders/llm/types.js";
import { VICTORY_WAVE } from "@/sim/Constants.js";
import { TOWER_LEVEL_DMG_MULT, TOWER_LEVEL_RANGE_MULT, TOWER_LEVEL_RATE_MULT } from "@/sim/ConstantsTower.js";

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
  };
}

describe("buildSystemPrompt", () => {
  it("fills victory, tower scaling, navmesh, and the engagement commands from live constants", () => {
    const prompt = buildSystemPrompt(makeConfig());
    expect(prompt).toContain(`wave ${VICTORY_WAVE}`);
    expect(prompt).toContain(`damage * ${TOWER_LEVEL_DMG_MULT}^(level-1)`);
    expect(prompt).toContain(`fireRate * ${TOWER_LEVEL_RATE_MULT}^(level-1)`);
    expect(prompt).toContain(`range * ${TOWER_LEVEL_RANGE_MULT}^(level-1)`);
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
    for (const mode of ["default", "base", "nearest", "strongest", "weakest", "strongestAhead"]) {
      expect(prompt).toContain(mode);
    }
  });
});
