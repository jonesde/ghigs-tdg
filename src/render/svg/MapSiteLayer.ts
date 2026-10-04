import type { SiteArtMeta } from "@/render/themes/index.js";
import { HASTE_AURA_RANGE_TILES, HEAL_AURA_RANGE_TILES } from "@/sim/bossAbilities.js";
import { BUILDING_COLORS, BUILDING_ICONS, buildingBlurb, CACHE_ICON } from "@/sim/mapSites.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import type {
  BombardShotSnapshot,
  MapBuildingSnapshot,
  MapCacheSnapshot,
  SimulationSnapshot,
  SnapshotMeta,
  SupplyDropSnapshot,
} from "@/sim/SimulationSnapshot.js";

// Site art is authored in a 36x36 box (the tile size) and drawn smaller so a
// building or cache sits inside its cell with a margin.
const GLYPH_SIZE = 26;
const ICON_FONT_SIZE = 11;
const PULSE_GROWTH = 5;

// A theme's `sites` block replaces these marks with its own symbols
// (site-building-{kind}, site-cache-{state}, site-supply-drop). The procedural
// marks stay as the fallback, so a theme with no site art renders as before.
// Shared by the live layer and the progressive placement ghost.
export function siteGlyphMarkup(
  drops: readonly SupplyDropSnapshot[],
  caches: readonly MapCacheSnapshot[],
  buildings: readonly MapBuildingSnapshot[],
  currentWave: number,
  siteArt: SiteArtMeta | null,
): string {
  const parts: string[] = [];
  for (const drop of drops) parts.push(dropGlyph(drop.worldX, drop.worldY, siteArt));
  for (const cache of caches) parts.push(cacheGlyph(cache, currentWave, siteArt));
  for (const building of buildings) parts.push(buildingGlyph(building, siteArt));
  return parts.join("");
}

export class MapSiteLayer {
  private layer: SVGGElement | null = null;
  private siteArt: SiteArtMeta | null = null;
  private lastMarkup = "";
  private siteSignature = "";
  private siteMarkup = "";

  init(layer: SVGGElement, siteArt: SiteArtMeta | null): void {
    this.layer = layer;
    this.siteArt = siteArt;
    this.siteSignature = "";
  }

  sync(snapshot: SimulationSnapshot): void {
    const meta = snapshot.meta;
    // Site glyphs carry tooltips and HP bars, so they dominate this layer's string
    // cost. A cheap signature keeps them out of the per-frame path; aura rings and
    // bombard shots are rebuilt every call because they move every frame.
    const signature = siteSignature(meta, this.siteArt != null);
    if (signature !== this.siteSignature) {
      this.siteSignature = signature;
      this.siteMarkup = siteGlyphMarkup(
        meta.supplyDrops ?? [],
        meta.mapCaches ?? [],
        meta.mapBuildings ?? [],
        meta.currentWave,
        this.siteArt,
      );
    }
    const markup = this.siteMarkup + overlayMarkup(snapshot);
    if (markup === this.lastMarkup) return;
    this.lastMarkup = markup;
    if (this.layer) this.layer.innerHTML = markup;
  }

  dispose(): void {
    if (this.layer) this.layer.innerHTML = "";
    this.layer = null;
    this.siteArt = null;
    this.lastMarkup = "";
    this.siteSignature = "";
    this.siteMarkup = "";
  }
}

// Covers every field siteGlyphMarkup reads: positions come from tile coords plus
// the run's tile size and world origin, cache titles from hp, unlock state, and
// the current wave.
function siteSignature(meta: SnapshotMeta, hasSiteArt: boolean): string {
  let signature =
    `t${meta.tileSize ?? 36}:${meta.worldOriginX ?? 0},${meta.worldOriginY ?? 0}w${meta.currentWave}` +
    `a${hasSiteArt ? 1 : 0}`;
  for (const drop of meta.supplyDrops ?? []) signature += `d${drop.id}:${drop.tileX},${drop.tileY}`;
  for (const cache of meta.mapCaches ?? [])
    signature += `c${cache.id}:${cache.tileX},${cache.tileY}:${cache.hp}:${cache.unlocked}`;
  for (const building of meta.mapBuildings ?? [])
    signature += `b${building.id}:${building.tileX},${building.tileY}:${building.kind}`;
  return signature;
}

function overlayMarkup(snapshot: SimulationSnapshot): string {
  const meta = snapshot.meta;
  const tileSize = meta.tileSize ?? 36;
  const parts: string[] = [];
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

function dropGlyph(worldX: number, worldY: number, siteArt: SiteArtMeta | null): string {
  const half = GLYPH_SIZE / 2;
  const points = `${worldX},${worldY - half} ${worldX + half},${worldY} ${worldX},${worldY + half} ${worldX - half},${worldY}`;
  const pulseHalf = half + PULSE_GROWTH;
  const pulse =
    `${worldX},${worldY - pulseHalf} ${worldX + pulseHalf},${worldY} ` +
    `${worldX},${worldY + pulseHalf} ${worldX - pulseHalf},${worldY}`;
  // The pulse ring is what makes a fresh boss package findable across a busy
  // corridor; the class animates stroke paint from the global stylesheet, so the
  // ring stays its own stroked element (theme art replaces only the crate) and
  // the signature cache never has to rewrite this markup to keep it moving.
  const ring = `<polygon points="${pulse}" class="site-drop-pulse" fill="none" stroke="#ffd84d" stroke-width="2"/>`;
  const label = "Boss package — click to claim one of three bonus cards";
  if (siteArt?.supplyDrop) {
    return ring + siteArtUse("site-supply-drop", worldX, worldY, label);
  }
  return (
    ring +
    `<polygon points="${points}" fill="#e0c040" stroke="#8a7020" stroke-width="1" ` +
    `aria-label="${label}"></polygon>`
  );
}

// A site symbol's 36x36 viewBox maps into the <use> width/height viewport, the
// same way tile art scales, so placing a glyph is x/y plus a 26px box.
function siteArtUse(symbolId: string, worldX: number, worldY: number, label: string): string {
  const offset = GLYPH_SIZE / 2;
  return (
    `<use href="#${symbolId}" x="${n(worldX - offset)}" y="${n(worldY - offset)}" ` +
    `width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" aria-label="${label}"></use>`
  );
}

function cacheGlyph(cache: MapCacheSnapshot, currentWave: number, siteArt: SiteArtMeta | null): string {
  const half = GLYPH_SIZE / 2;
  const left = cache.worldX - half;
  const top = cache.worldY - half;
  const broken = cache.hp <= 0;
  const unlocked = broken || cache.unlocked;
  const bar =
    !broken && cache.hp < cache.maxHp
      ? `<rect x="${left}" y="${top - 4}" width="${GLYPH_SIZE * Math.max(0, cache.hp / cache.maxHp)}" height="2" fill="#d0d0d0"/>`
      : "";
  const label = broken
    ? "Broken cache — click to claim a card for free"
    : unlocked
      ? "Cache unlocked — click to claim a card"
      : `Cache ${Math.ceil(cache.hp)}/${Math.ceil(cache.maxHp)} — unlock for ` +
        `${cacheOpenGold(currentWave)} gold or break it open`;
  const state = broken ? "broken" : unlocked ? "unlocked" : "sealed";
  if (siteArt) {
    return siteArtUse(`site-cache-${state}`, cache.worldX, cache.worldY, label) + bar;
  }
  const fill = broken ? "#5a4a30" : "#8a6230";
  const ink = broken ? "#c8b898" : "#f4e6cc";
  return (
    `<rect x="${left}" y="${top}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" fill="${fill}" stroke="#4a3018" ` +
    `stroke-width="1" aria-label="${label}"></rect>` +
    iconText(cache.worldX, cache.worldY, CACHE_ICON, ink) +
    bar
  );
}

function buildingGlyph(building: MapBuildingSnapshot, siteArt: SiteArtMeta | null): string {
  const half = GLYPH_SIZE / 2;
  const label = buildingBlurb(building.kind);
  if (siteArt) {
    return siteArtUse(`site-building-${building.kind}`, building.worldX, building.worldY, label);
  }
  const color = BUILDING_COLORS[building.kind];
  return (
    `<rect x="${building.worldX - half}" y="${building.worldY - half}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" ` +
    `fill="${color}" stroke="#1a1a1a" stroke-width="1" aria-label="${label}"></rect>` +
    iconText(building.worldX, building.worldY, BUILDING_ICONS[building.kind], "#141414")
  );
}

function iconText(centerX: number, centerY: number, glyph: string, ink: string): string {
  return (
    `<text x="${centerX}" y="${centerY}" font-size="${ICON_FONT_SIZE}" font-weight="bold" font-family="sans-serif" ` +
    `text-anchor="middle" dominant-baseline="central" fill="${ink}" aria-hidden="true">${glyph}</text>`
  );
}

function n(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
