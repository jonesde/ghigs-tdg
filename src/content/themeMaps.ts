import { getGameContent } from "./gameContent.js";
import { deepFreeze } from "./loadGameContent.js";
import { type MapsContent, MapsContentSchema, type ThemeMapsOverride } from "./schemas/maps.js";

// Resolves the effective maps catalog for a theme: the default maps.json content
// with the theme's optional `maps` override merged one level deep. Each present
// top-level field replaces the default wholesale (a provided `progressive` object
// must be complete; there is no nested merge). The combined object is re-parsed
// against the full MapsContentSchema so every required field is enforced, and
// mapsPerRegion is pinned at 12 so region indexing stays uniform across worlds.
// The active world's progressive re-roll price, falling back to the content-pack
// default when the theme carries no maps override. The worker resolves this from
// its ThemeBundle and the main thread from mapThemeStore.activeTheme, so both
// must land on the same number or the button's cost disagrees with the charge.
export function themeProgressiveRerollGoldPerWave(worldMaps?: MapsContent | null): number {
  return worldMaps?.progressive.rerollGoldPerWave ?? getGameContent().maps.progressive.rerollGoldPerWave;
}

// The active world's block placement interval for a wave: progressive.placementIntervalSteps
// are walked in order and the last step with afterWave below the wave wins, so the
// first entry (afterWave 0) is the base interval from wave 1 onward.
export function themeProgressivePlacementInterval(worldMaps: MapsContent | null | undefined, wave: number): number {
  const steps = (worldMaps?.progressive ?? getGameContent().maps.progressive).placementIntervalSteps;
  const baseStep = steps[0];
  if (!baseStep) throw new Error("progressive.placementIntervalSteps must define a base step");
  let interval = baseStep.interval;
  for (const step of steps) {
    if (wave > step.afterWave) interval = step.interval;
  }
  return interval;
}

export function resolveThemeMaps(override: ThemeMapsOverride | null | undefined): MapsContent {
  const base = getGameContent().maps;
  if (!override) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override) as Array<keyof ThemeMapsOverride>) {
    const value = override[key];
    if (value !== undefined) merged[key] = value;
  }
  const resolved = MapsContentSchema.parse(merged);
  if (resolved.mapsPerRegion !== 12) {
    throw new Error(`Theme maps override must keep mapsPerRegion at 12, found ${resolved.mapsPerRegion}`);
  }
  return deepFreeze(resolved);
}
