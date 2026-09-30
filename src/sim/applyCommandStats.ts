import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { GameEngine } from "@/sim/GameEngine.js";
import { applyCommand } from "./applyCommand.js";
import type { Command } from "./Command.js";

export interface CommandApplyStats {
  mutated: boolean;
  applied: number;
  skipped: number;
  note?: string;
}

// Parallel wrapper around applyCommand (applyCommand keeps its boolean return
// type). For id-addressed llm commands the id map is built once and shared with
// the apply so one command never builds it twice.
export function applyCommandWithStats(engine: GameEngine, command: Command): CommandApplyStats {
  if (command.type === "llm:releaseHeld") {
    const heldMatching = countHeldMatching(engine, command.wave, command.spawnIndex);
    const mutated = applyCommand(engine, command);
    return { mutated, applied: heldMatching, skipped: 0 };
  }
  switch (command.type) {
    case "llm:routeGroup":
    case "llm:setTargeting": {
      const lookup = engine.buildEnemyLookup();
      const mutated = applyCommand(engine, command, lookup);
      const foundCount = countLookupHits(lookup, command.enemyIds);
      return { mutated, applied: foundCount, skipped: command.enemyIds.length - foundCount };
    }
    case "llm:siegeTower": {
      const lookup = engine.buildEnemyLookup();
      const mutated = applyCommand(engine, command, lookup);
      const foundCount = countLookupHits(lookup, command.enemyIds);
      const skippedCount = command.enemyIds.length - foundCount;
      const tower = engine.towerManager?.towerAt(command.towerTile.x, command.towerTile.y) ?? null;
      if (!tower || tower.isGhost) {
        return {
          mutated,
          applied: foundCount,
          skipped: skippedCount,
          note: "tower missing/ghost — released to default",
        };
      }
      return { mutated, applied: foundCount, skipped: skippedCount };
    }
    default: {
      const mutated = applyCommand(engine, command);
      return { mutated, applied: mutated ? 1 : 0, skipped: 0 };
    }
  }
}

function countLookupHits(lookup: Map<number, Enemy>, enemyIds: number[]): number {
  let foundCount = 0;
  for (const enemyId of enemyIds) {
    if (lookup.has(enemyId)) foundCount += 1;
  }
  return foundCount;
}

function countHeldMatching(engine: GameEngine, wave: number | undefined, spawnIndex: number | undefined): number {
  const enemies = engine.enemyManager?.enemies ?? [];
  let heldCount = 0;
  for (const enemy of enemies) {
    if (enemy.routingMode !== "hold") continue;
    if (wave !== undefined && enemy.wave !== wave) continue;
    if (spawnIndex !== undefined && enemy.spawnIndex !== spawnIndex) continue;
    heldCount += 1;
  }
  return heldCount;
}
