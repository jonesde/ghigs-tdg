import { getGameContent } from "./gameContent.js";
import { deepFreeze } from "./loadGameContent.js";
import { type MapsContent, MapsContentSchema, type ThemeMapsOverride } from "./schemas/maps.js";

// Resolves the effective maps catalog for a theme: the default maps.json content
// with the theme's optional `maps` override merged one level deep. Each present
// top-level field replaces the default wholesale (a provided `progressive` object
// must be complete; there is no nested merge). The combined object is re-parsed
// against the full MapsContentSchema so every required field is enforced, and
// mapsPerRegion is pinned at 12 so region indexing stays uniform across worlds.
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
