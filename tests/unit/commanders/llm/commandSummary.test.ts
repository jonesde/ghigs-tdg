import { describe, expect, it } from "vitest";
import { summarizeLlmCommands } from "@/commanders/llm/commandSummary.js";
import type { ParsedLlmCommand } from "@/commanders/llm/schema.js";

describe("summarizeLlmCommands", () => {
  it("describes a hold with and without a tile", () => {
    const withTile: ParsedLlmCommand = {
      type: "llm:routeGroup",
      enemyIds: [1, 2],
      hold: true,
      holdTile: { x: 3, y: 4 },
      waypoints: [],
    };
    const withoutTile: ParsedLlmCommand = { type: "llm:routeGroup", enemyIds: [1, 2], hold: true, waypoints: [] };
    expect(summarizeLlmCommands([withTile])).toBe("hold 1, 2 at (3, 4)");
    expect(summarizeLlmCommands([withoutTile])).toBe("hold 1, 2");
  });

  it("describes a route with waypoints and without them", () => {
    const via: ParsedLlmCommand = {
      type: "llm:routeGroup",
      enemyIds: [1, 2],
      waypoints: [
        { x: 5, y: 1 },
        { x: 8, y: 4 },
      ],
    };
    const release: ParsedLlmCommand = { type: "llm:routeGroup", enemyIds: [1, 2], waypoints: [] };
    expect(summarizeLlmCommands([via])).toBe("route 1, 2 via (5, 1) → (8, 4)");
    expect(summarizeLlmCommands([release])).toBe("route 1, 2");
  });

  it("describes siege and targeting", () => {
    const siege: ParsedLlmCommand = { type: "llm:siegeTower", enemyIds: [1, 2], towerTile: { x: 4, y: 2 } };
    const targeting: ParsedLlmCommand = { type: "llm:setTargeting", enemyIds: [3, 7], mode: "aggressive" };
    expect(summarizeLlmCommands([siege])).toBe("siege (4, 2) with 1, 2");
    expect(summarizeLlmCommands([targeting])).toBe("targeting aggressive on 3, 7");
  });

  it("keeps command order and appends a soft rejection", () => {
    const hold: ParsedLlmCommand = { type: "llm:routeGroup", enemyIds: [1], hold: true, waypoints: [] };
    const siege: ParsedLlmCommand = { type: "llm:siegeTower", enemyIds: [2], towerTile: { x: 4, y: 2 } };
    expect(summarizeLlmCommands([hold, siege], "rejected command type: nope")).toBe(
      "hold 1\nsiege (4, 2) with 2\nrejected: rejected command type: nope",
    );
  });

  it("uses the rejection alone when no command applied", () => {
    expect(summarizeLlmCommands([], "LLM response was not valid JSON")).toBe(
      "rejected: LLM response was not valid JSON",
    );
  });

  it("says there were no commands when the reply was empty", () => {
    expect(summarizeLlmCommands([])).toBe("no commands");
  });

  it("describes spawn orders and release held", () => {
    const holdOwn: ParsedLlmCommand = { type: "llm:setSpawnOrder", hold: true };
    const holdTile: ParsedLlmCommand = {
      type: "llm:setSpawnOrder",
      spawnIndex: 2,
      hold: true,
      holdTile: { x: 4, y: 5 },
    };
    const holdSpawn: ParsedLlmCommand = { type: "llm:setSpawnOrder", spawnIndex: 1, hold: true };
    const route: ParsedLlmCommand = { type: "llm:setSpawnOrder", waypoints: [{ x: 1, y: 2 }], targetingMode: "base" };
    const emptyRoute: ParsedLlmCommand = { type: "llm:setSpawnOrder", spawnIndex: 0, waypoints: [] };
    const siege: ParsedLlmCommand = {
      type: "llm:setSpawnOrder",
      towerTile: { x: 6, y: 7 },
      targetingMode: "strongest",
    };
    const clearAll: ParsedLlmCommand = { type: "llm:setSpawnOrder", clear: true };
    const clearOne: ParsedLlmCommand = { type: "llm:setSpawnOrder", clear: true, spawnIndex: 3 };
    const releaseAll: ParsedLlmCommand = { type: "llm:releaseHeld" };
    const releaseFiltered: ParsedLlmCommand = { type: "llm:releaseHeld", wave: 4, spawnIndex: 1 };
    expect(summarizeLlmCommands([holdOwn])).toBe("spawn order hold at own spawn");
    expect(summarizeLlmCommands([holdTile])).toBe("spawn order hold spawn 2 at (4, 5)");
    expect(summarizeLlmCommands([holdSpawn])).toBe("spawn order hold at spawn 1");
    expect(summarizeLlmCommands([route])).toBe("spawn order route via (1, 2) targeting base");
    expect(summarizeLlmCommands([emptyRoute])).toBe("spawn order route spawn 0");
    expect(summarizeLlmCommands([siege])).toBe("spawn order siege (6, 7) targeting strongest");
    expect(summarizeLlmCommands([clearAll])).toBe("clear spawn order");
    expect(summarizeLlmCommands([clearOne])).toBe("clear spawn order 3");
    expect(summarizeLlmCommands([releaseAll])).toBe("release held");
    expect(summarizeLlmCommands([releaseFiltered])).toBe("release held wave 4 spawn 1");
  });
});
