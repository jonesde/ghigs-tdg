import { getGameContent } from "@/content/gameContent.js";

// Glyphs index by milestoneWaves order, which the economy pack ships ascending
// (bronze, silver, gold). Reordering the pack re-labels the medals with no
// component edit; the same emoji vocabulary as the wave-top tower medals in
// render/svg/UiOverlayManager.ts.
const milestoneMedalGlyphs = ["🥉", "🥈", "🥇"] as const;
const clearedCrown = "👑";

export function medalGlyphsForBestWave(bestWave: number): string[] {
  if (!(bestWave > 0)) return [];
  return getGameContent().economy.milestoneWaves.flatMap((milestoneWave, index) => {
    const glyph = milestoneMedalGlyphs[index];
    return glyph && bestWave >= milestoneWave ? [glyph] : [];
  });
}

export function clearedCrownGlyph(): string {
  return clearedCrown;
}

export function isClearedBestWave(bestWave: number): boolean {
  return bestWave >= getGameContent().economy.victoryWave;
}
