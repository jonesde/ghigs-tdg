import { HASTE_AURA_RANGE_TILES, HEAL_AURA_RANGE_TILES } from "@/sim/bossAbilities.js";
import { BUILDING_COLORS, buildingBlurb } from "@/sim/mapSites.js";
import type {
  BombardShotSnapshot,
  MapBuildingSnapshot,
  MapCacheSnapshot,
  SimulationSnapshot,
  SupplyDropSnapshot,
} from "@/sim/SimulationSnapshot.js";

const GLYPH_SIZE = 16;

// Procedural marks, shared by the live layer and the progressive placement ghost.
// Theme JSON stays untouched: these are not sprites.
export function siteGlyphMarkup(
  drops: readonly SupplyDropSnapshot[],
  caches: readonly MapCacheSnapshot[],
  buildings: readonly MapBuildingSnapshot[],
): string {
  const parts: string[] = [];
  for (const drop of drops) parts.push(dropGlyph(drop.worldX, drop.worldY));
  for (const cache of caches) parts.push(cacheGlyph(cache));
  for (const building of buildings) parts.push(buildingGlyph(building));
  return parts.join("");
}

export class MapSiteLayer {
  private layer: SVGGElement | null = null;
  private lastMarkup = "";

  init(layer: SVGGElement): void {
    this.layer = layer;
  }

  sync(snapshot: SimulationSnapshot): void {
    const markup = liveMarkup(snapshot);
    if (markup === this.lastMarkup) return;
    this.lastMarkup = markup;
    if (this.layer) this.layer.innerHTML = markup;
  }

  dispose(): void {
    if (this.layer) this.layer.innerHTML = "";
    this.layer = null;
    this.lastMarkup = "";
  }
}

function liveMarkup(snapshot: SimulationSnapshot): string {
  const meta = snapshot.meta;
  const tileSize = meta.tileSize ?? 36;
  const parts: string[] = [siteGlyphMarkup(meta.supplyDrops ?? [], meta.mapCaches ?? [], meta.mapBuildings ?? [])];
  for (const enemy of snapshot.enemies) {
    if (enemy.removed || enemy.type !== "boss") continue;
    if (enemy.bossAbility === "healAura" && !enemy.mendSuppressed) {
      parts.push(ring(enemy.x, enemy.y, HEAL_AURA_RANGE_TILES * tileSize, "#3dba6a"));
    }
    if (enemy.bossAbility === "speedAura") {
      parts.push(ring(enemy.x, enemy.y, HASTE_AURA_RANGE_TILES * tileSize, "#c98aff"));
    }
  }
  for (const shot of meta.bombardShots ?? []) parts.push(bombardMarkup(shot, tileSize));
  return parts.join("");
}

function dropGlyph(worldX: number, worldY: number): string {
  const half = GLYPH_SIZE / 2;
  const points = `${worldX},${worldY - half} ${worldX + half},${worldY} ${worldX},${worldY + half} ${worldX - half},${worldY}`;
  return `<polygon points="${points}" fill="#e0c040" stroke="#8a7020" stroke-width="1"><title>Supply drop</title></polygon>`;
}

function cacheGlyph(cache: MapCacheSnapshot): string {
  const half = GLYPH_SIZE / 2;
  const left = cache.worldX - half;
  const top = cache.worldY - half;
  const bar =
    cache.hp < cache.maxHp
      ? `<rect x="${left}" y="${top - 4}" width="${GLYPH_SIZE * Math.max(0, cache.hp / cache.maxHp)}" height="2" fill="#d0d0d0"/>`
      : "";
  return (
    `<rect x="${left}" y="${top}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" fill="#8a6230" stroke="#4a3018" stroke-width="1">` +
    `<title>Cache ${Math.ceil(cache.hp)}/${Math.ceil(cache.maxHp)} · open for 50 gold</title></rect>${bar}`
  );
}

function buildingGlyph(building: MapBuildingSnapshot): string {
  const half = GLYPH_SIZE / 2;
  const color = BUILDING_COLORS[building.kind];
  return (
    `<rect x="${building.worldX - half}" y="${building.worldY - half}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" ` +
    `fill="${color}" stroke="#1a1a1a" stroke-width="1"><title>${buildingBlurb(building.kind)}</title></rect>`
  );
}

function ring(centerX: number, centerY: number, radius: number, color: string): string {
  return (
    `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-opacity="0.7"/>`
  );
}

function bombardMarkup(shot: BombardShotSnapshot, tileSize: number): string {
  const left = shot.targetX - tileSize / 2;
  const top = shot.targetY - tileSize / 2;
  const dotX = shot.originX + (shot.targetX - shot.originX) * shot.progress;
  const dotY = shot.originY + (shot.targetY - shot.originY) * shot.progress;
  return (
    `<rect x="${left}" y="${top}" width="${tileSize}" height="${tileSize}" fill="none" stroke="#e07040" stroke-width="2"/>` +
    `<circle cx="${dotX}" cy="${dotY}" r="4" fill="#e07040"/>`
  );
}
