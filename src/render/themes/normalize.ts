import type { MapsContent, ThemeMapsOverride } from "@/content/schemas/maps.js";
import { resolveThemeMaps } from "@/content/themeMaps.js";
import {
  type EnemyVisualMeta,
  type MapThemeAnimation,
  type MapThemeData,
  type MapThemeFrame,
  type RegionMapLayout,
  type RegionVisualMeta,
  type SiteArtMeta,
  type SpawnPointVisualMeta,
  TILE_KINDS,
  type TileKind,
  type TileKindImages,
  type TowerVisualMeta,
} from "./index.js";

function stripSvgWrapper(svgContent: string): string {
  let cleaned = svgContent.trim();
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/<\?xml[^?]*\?>/g, "");
  cleaned = cleaned.replace(/^\s+|\s+$/g, "");
  return cleaned;
}

function isExternalImage(image: string): boolean {
  const trimmed = image.trim();
  if (trimmed.startsWith("<svg")) return false;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  )
    return true;
  return false;
}

async function fetchSvgText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch SVG from ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function resolveImage(image: string): Promise<string> {
  if (isExternalImage(image)) {
    return await fetchSvgText(image);
  }
  return image;
}

// Theme JSON may write one tile image or a list of variants; both normalize to
// a non-empty list with the primary art first.
type RawTileImages = Record<TileKind, string | string[]>;

async function resolveTileImages(rawTiles: RawTileImages): Promise<TileKindImages> {
  const resolved = {} as TileKindImages;
  for (const kind of TILE_KINDS) {
    const raw = rawTiles[kind];
    const images = Array.isArray(raw) ? raw : [raw];
    const stripped = await Promise.all(images.map((image) => resolveImage(image)));
    resolved[kind] = stripped.map(stripSvgWrapper);
  }
  return resolved;
}

async function normalizeAnimation(raw: { duration: number; frames: { image: string }[] }): Promise<MapThemeAnimation> {
  const referenceImages: MapThemeFrame[] = [];
  for (const frame of raw.frames) {
    const svg = stripSvgWrapper(await resolveImage(frame.image));
    referenceImages.push({ svg });
  }
  return { duration: raw.duration, referenceImages };
}

async function normalizeTowerVisual(raw: {
  name: string;
  color: string;
  icon: string;
  animation: { duration: number; frames: { image: string }[] } | null;
  walking?: { duration: number; frames: { image: string }[] };
}): Promise<TowerVisualMeta> {
  const animation = raw.animation ? await normalizeAnimation(raw.animation) : null;
  const walking = raw.walking ? await normalizeAnimation(raw.walking) : null;
  return { name: raw.name, color: raw.color, icon: raw.icon, animation, walking };
}

async function normalizeEnemyVisual(raw: {
  name: string;
  color: string;
  shape: string;
  walking: { duration: number; frames: { image: string }[] };
  hitReaction?: { duration: number; frames: { image: string }[] };
  attack?: { duration: number; frames: { image: string }[] };
}): Promise<EnemyVisualMeta> {
  const walking = await normalizeAnimation(raw.walking);
  const hitReaction = raw.hitReaction ? await normalizeAnimation(raw.hitReaction) : null;
  const attack = raw.attack ? await normalizeAnimation(raw.attack) : null;
  return { name: raw.name, color: raw.color, shape: raw.shape, walking, hitReaction, attack };
}

async function normalizeRegionVisual(raw: {
  id: number;
  name: string;
  tiles: RawTileImages;
  base: string;
  mapImage: string;
  mapLayout: RegionMapLayout;
}): Promise<RegionVisualMeta> {
  const tiles = await resolveTileImages(raw.tiles);
  const base = stripSvgWrapper(await resolveImage(raw.base));
  const mapImage = stripSvgWrapper(await resolveImage(raw.mapImage));
  return { id: raw.id, name: raw.name, tiles, base, mapImage, mapLayout: raw.mapLayout };
}

async function normalizeSiteArt(raw: {
  buildings: Record<"armory" | "magazine" | "ward" | "beacon", string>;
  caches: Record<"sealed" | "unlocked" | "broken", string>;
  supplyDrop?: string;
}): Promise<SiteArtMeta> {
  const buildings = {} as SiteArtMeta["buildings"];
  for (const kind of Object.keys(raw.buildings) as (keyof SiteArtMeta["buildings"])[]) {
    buildings[kind] = stripSvgWrapper(await resolveImage(raw.buildings[kind]));
  }
  const caches = {} as SiteArtMeta["caches"];
  for (const state of Object.keys(raw.caches) as (keyof SiteArtMeta["caches"])[]) {
    caches[state] = stripSvgWrapper(await resolveImage(raw.caches[state]));
  }
  const siteArt: SiteArtMeta = { buildings, caches };
  if (raw.supplyDrop) siteArt.supplyDrop = stripSvgWrapper(await resolveImage(raw.supplyDrop));
  return siteArt;
}

async function normalizeSpawnVisuals(raw: {
  closed: string;
  open: string;
  transition: string;
}): Promise<SpawnPointVisualMeta> {
  const closed = stripSvgWrapper(await resolveImage(raw.closed));
  const open = stripSvgWrapper(await resolveImage(raw.open));
  const transition = stripSvgWrapper(await resolveImage(raw.transition));
  return { closed, open, transition };
}

export async function normalizeThemeImages(raw: {
  id: string;
  label: string;
  menuBackground?: string;
  towers: Record<
    string,
    {
      name: string;
      color: string;
      icon: string;
      animation: { duration: number; frames: { image: string }[] } | null;
      walking?: { duration: number; frames: { image: string }[] };
    }
  >;
  enemies: Record<
    string,
    {
      name: string;
      color: string;
      shape: string;
      walking: { duration: number; frames: { image: string }[] };
      hitReaction?: { duration: number; frames: { image: string }[] };
      attack?: { duration: number; frames: { image: string }[] };
    }
  >;
  regions: Array<{
    id: number;
    name: string;
    tiles: RawTileImages;
    base: string;
    mapImage: string;
    mapLayout: RegionMapLayout;
  }>;
  spawns?: { closed: string; open: string; transition: string };
  sites?: {
    buildings: Record<"armory" | "magazine" | "ward" | "beacon", string>;
    caches: Record<"sealed" | "unlocked" | "broken", string>;
    supplyDrop?: string;
  };
  maps?: ThemeMapsOverride;
}): Promise<MapThemeData> {
  const normalizedTowers: Record<string, TowerVisualMeta> = {};
  for (const [key, tower] of Object.entries(raw.towers)) {
    normalizedTowers[key] = await normalizeTowerVisual(tower);
  }

  const normalizedEnemies: Record<string, EnemyVisualMeta> = {};
  for (const [key, enemy] of Object.entries(raw.enemies)) {
    normalizedEnemies[key] = await normalizeEnemyVisual(enemy);
  }

  const normalizedRegions: RegionVisualMeta[] = await Promise.all(raw.regions.map(normalizeRegionVisual));

  const normalizedSpawns = raw.spawns ? await normalizeSpawnVisuals(raw.spawns) : undefined;

  const normalizedSites = raw.sites ? await normalizeSiteArt(raw.sites) : undefined;

  const menuBackground = raw.menuBackground ? stripSvgWrapper(await resolveImage(raw.menuBackground)) : undefined;

  const result: {
    id: string;
    label: string;
    menuBackground?: string;
    towers: Record<string, TowerVisualMeta>;
    enemies: Record<string, EnemyVisualMeta>;
    regions: RegionVisualMeta[];
    spawns?: SpawnPointVisualMeta;
    sites?: SiteArtMeta;
    maps?: MapsContent;
  } = {
    id: raw.id,
    label: raw.label,
    towers: normalizedTowers,
    enemies: normalizedEnemies,
    regions: normalizedRegions,
  };
  if (normalizedSpawns) {
    result.spawns = normalizedSpawns;
  }
  if (normalizedSites) {
    result.sites = normalizedSites;
  }
  if (menuBackground) {
    result.menuBackground = menuBackground;
  }
  if (raw.maps) {
    result.maps = resolveThemeMaps(raw.maps);
  }
  return result;
}
