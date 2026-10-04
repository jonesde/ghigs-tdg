import { BUILDING_DETAILS, BUILDING_LABELS, PACKAGE_CLICK_RADIUS_TILES } from "@/sim/mapSites.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import type { MapBuildingSnapshot, MapCacheSnapshot, SupplyDropSnapshot } from "@/sim/SimulationSnapshot.js";

// Half of the 26-world-unit glyph box MapSiteLayer draws, plus a pixel of grace.
const BUILDING_HOVER_HALF = 14;

export type SiteHoverKind = "drop" | "cache" | "building";

export interface SiteHoverRef {
  kind: SiteHoverKind;
  id: number;
}

export interface SiteHoverText {
  title: string;
  lines: string[];
}

export interface SiteHoverSites {
  drops: readonly SupplyDropSnapshot[];
  caches: readonly MapCacheSnapshot[];
  buildings: readonly MapBuildingSnapshot[];
}

// Hit test for the custom site tooltip. Packages use the same radius as the
// click test, so hover and press always agree on which site they mean; a
// building glyph is only reached when no package is under the pointer.
export function siteHoverAt(
  sites: SiteHoverSites,
  tileSize: number,
  worldX: number,
  worldY: number,
): SiteHoverRef | null {
  const radius = tileSize * PACKAGE_CLICK_RADIUS_TILES;
  const radiusSquared = radius * radius;
  let bestDistance = radiusSquared;
  let best: SiteHoverRef | null = null;
  const consider = (kind: SiteHoverKind, id: number, siteX: number, siteY: number): void => {
    const deltaX = siteX - worldX;
    const deltaY = siteY - worldY;
    const distance = deltaX * deltaX + deltaY * deltaY;
    if (distance > bestDistance) return;
    bestDistance = distance;
    best = { kind, id };
  };
  for (const drop of sites.drops) consider("drop", drop.id, drop.worldX, drop.worldY);
  for (const cache of sites.caches) consider("cache", cache.id, cache.worldX, cache.worldY);
  if (best) return best;
  for (const building of sites.buildings) {
    if (Math.abs(building.worldX - worldX) > BUILDING_HOVER_HALF) continue;
    if (Math.abs(building.worldY - worldY) > BUILDING_HOVER_HALF) continue;
    return { kind: "building", id: building.id };
  }
  return null;
}

// Copy for the hovered site, or null when it has been claimed or consumed since
// the pointer arrived, which is how the tooltip hides without extra bookkeeping.
export function siteHoverText(ref: SiteHoverRef, sites: SiteHoverSites, currentWave: number): SiteHoverText | null {
  if (ref.kind === "drop") {
    const drop = sites.drops.find((site) => site.id === ref.id);
    if (!drop) return null;
    return { title: "Boss package", lines: ["Left by a boss on death.", "Click to claim one of three bonus cards."] };
  }
  if (ref.kind === "cache") {
    const cache = sites.caches.find((site) => site.id === ref.id);
    if (!cache) return null;
    if (cache.hp <= 0) {
      return { title: "Cache — broken open", lines: ["Click to claim a card for free."] };
    }
    if (cache.unlocked) {
      return { title: "Cache — unlocked", lines: ["Fee already paid.", "Click to claim one of three bonus cards."] };
    }
    return {
      title: `Cache ${Math.ceil(cache.hp)}/${Math.ceil(cache.maxHp)}`,
      lines: [`Unlock for ${cacheOpenGold(currentWave)} gold`, "or break it open with tower fire (free)."],
    };
  }
  const building = sites.buildings.find((site) => site.id === ref.id);
  if (!building) return null;
  const detail = BUILDING_DETAILS[building.kind];
  return { title: BUILDING_LABELS[building.kind], lines: [`${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`] };
}
