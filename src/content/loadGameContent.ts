import economyRaw from "./data/economy.json";
import enemiesRaw from "./data/enemies.json";
import mapsRaw from "./data/maps.json";
import skillTreeRaw from "./data/skill-tree.json";
import towersRaw from "./data/towers.json";
import { type GameContent, GameContentSchema } from "./schemas/gameContent.js";

// Recursively freezes every object/array reachable from the parsed content.
// A shallow Object.freeze left nested balance tables mutable at runtime, so a
// stray writer could silently corrupt the shared content singleton.
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function loadGameContent(): GameContent {
  const parsed = GameContentSchema.parse({
    towers: towersRaw,
    enemies: enemiesRaw,
    economy: economyRaw,
    maps: mapsRaw,
    skillTree: skillTreeRaw,
  });
  return deepFreeze(parsed) as GameContent;
}
