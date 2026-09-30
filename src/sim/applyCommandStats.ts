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
// type). Calls applyCommand exactly once for the mutation, then derives
// applied/skipped counts with read-only queries so nothing is mutated twice.
export function applyCommandWithStats(engine: GameEngine, command: Command): CommandApplyStats {
  if (command.type === "llm:releaseHeld") {
    const heldMatching = countHeldMatching(engine, command.wave, command.spawnIndex);
    const mutated = applyCommand(engine, command);
    return { mutated, applied: heldMatching, skipped: 0 };
  }
  const mutated = applyCommand(engine, command);
  switch (command.type) {
    case "llm:routeGroup":
    case "llm:setTargeting": {
      const foundCount = engine.getEnemiesByIds(command.enemyIds).length;
      return { mutated, applied: foundCount, skipped: command.enemyIds.length - foundCount };
    }
    case "llm:siegeTower": {
      const foundCount = engine.getEnemiesByIds(command.enemyIds).length;
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
    default:
      return { mutated, applied: mutated ? 1 : 0, skipped: 0 };
  }
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
