import { getGameContent } from "@/content/gameContent.js";
import type { TowerId } from "@/content/towerIds.js";

export function towerGroundOnly(type: string, unlockedAddons?: readonly boolean[]): boolean {
  if (!getGameContent().towers.base[type]?.groundOnly) return false;
  const effects = getGameContent().towers.addonEffects[type as TowerId];
  if (!effects || !unlockedAddons) return true;
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    if (effects[effectIndex]?.antiAir && unlockedAddons[effectIndex]) return false;
  }
  return true;
}

export function targetsLabel(groundOnly: boolean): string {
  return groundOnly ? "Ground only" : "Air & Ground";
}
