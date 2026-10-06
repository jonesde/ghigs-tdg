import { MILESTONE_WAVES, VICTORY_WAVE } from "@/sim/Constants.js";

// Glyphs index by MILESTONE_WAVES order, which the economy pack ships ascending
// (bronze, silver, gold). Reordering the pack re-labels the medals with no
// component edit; the same emoji vocabulary as the wave-top tower medals in
// render/svg/UiOverlayManager.ts.
export const MILESTONE_MEDAL_GLYPHS = ["🥉", "🥈", "🥇"] as const;
export const CLEARED_CROWN_GLYPH = "👑";

export function medalGlyphsForBestWave(bestWave: number): string[] {
  if (!(bestWave > 0)) return [];
  return MILESTONE_WAVES.flatMap((milestoneWave, index) => {
    const glyph = MILESTONE_MEDAL_GLYPHS[index];
    return glyph && bestWave >= milestoneWave ? [glyph] : [];
  });
}

export function isClearedBestWave(bestWave: number): boolean {
  return bestWave >= VICTORY_WAVE;
}
