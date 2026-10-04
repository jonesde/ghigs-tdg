import type { MapsContent } from "@/content/schemas/maps.js";

export const DEFAULT_THEME_ID = "default";

export interface MapThemeManifestEntry {
  id: string;
  label: string;
  file: string;
}

export const MAP_THEME_LOADERS: Record<string, MapThemeLoader> = {};

export type MapThemeId = string;

export interface MapTheme {
  id: string;
  label: string;
}

export interface MapThemeFrame {
  svg: string;
}

export interface MapThemeAnimation {
  duration: number;
  referenceImages: MapThemeFrame[];
}

export interface TowerVisualMeta {
  name: string;
  color: string;
  icon: string;
  animation: MapThemeAnimation | null;
  walking: MapThemeAnimation | null;
}

export interface EnemyVisualMeta {
  name: string;
  color: string;
  shape: string;
  walking: MapThemeAnimation;
  hitReaction: MapThemeAnimation | null;
  attack?: MapThemeAnimation | null;
}

// level is the map level (1-12) for "level" nodes and the branch level (1, 5, 9, or 12)
// for "progressive" nodes, so connections read as from {level, 5} to {progressive, 5}.
export interface RegionMapNodeRef {
  kind: "level" | "progressive";
  level: number;
}

export interface RegionMapNode extends RegionMapNodeRef {
  x: number;
  y: number;
}

export interface RegionMapConnection {
  from: RegionMapNodeRef;
  to: RegionMapNodeRef;
}

// Node x/y coordinates live in the mapImage's viewBox space.
export interface RegionMapLayout {
  viewBox: string;
  nodes: RegionMapNode[];
  connections: RegionMapConnection[];
}

export const TILE_KINDS = ["path", "terrain1", "terrain2", "terrain3", "terrain4"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

// One image per variant, primary art first. Theme JSON may ship a bare string,
// which normalizes to a single-element list (see normalizeThemeImages).
export type TileKindImages = Record<TileKind, string[]>;

export interface RegionVisualMeta {
  id: number;
  name: string;
  tiles: TileKindImages;
  base: string;
  mapImage: string;
  mapLayout: RegionMapLayout;
}

export interface SpawnPointVisualMeta {
  closed: string;
  open: string;
  transition: string;
}

// Map site art (buildings, caches, boss packages), authored in the same
// 0 0 36 36 space as tile art and drawn at 26 world px. Absent when a theme
// ships none, and MapSiteLayer then draws its procedural marks instead.
export interface SiteArtMeta {
  buildings: Record<"armory" | "magazine" | "ward" | "beacon", string>;
  caches: Record<"sealed" | "unlocked" | "broken", string>;
  supplyDrop?: string;
}

export interface MapThemeData {
  id: string;
  label: string;
  menuBackground?: string;
  towers: Record<string, TowerVisualMeta>;
  enemies: Record<string, EnemyVisualMeta>;
  regions: RegionVisualMeta[];
  spawns?: SpawnPointVisualMeta;
  sites?: SiteArtMeta;
  // Effective maps catalog for this world: the default maps content merged with
  // the theme's optional `maps` override (see resolveThemeMaps). Absent when the
  // theme carries no override — consumers then fall back to the default catalog.
  maps?: MapsContent;
}

export interface MapThemeLoader {
  load(): Promise<MapThemeData>;
}

export type SpawnVisualState = "closed" | "transition" | "open";

export interface SpawnState {
  visualState: SpawnVisualState;
  closeTransitionTimer: number;
}

export function registerThemeLoader(themeId: string, loaderFn: () => Promise<MapThemeData>): void {
  MAP_THEME_LOADERS[themeId] = {
    async load(): Promise<MapThemeData> {
      return loaderFn();
    },
  };
}

export function getThemeLoader(id: string): MapThemeLoader | undefined {
  return MAP_THEME_LOADERS[id];
}

/* ======= ADD MAP THEMES HERE ======= */

export const MAP_THEME_MANIFEST: MapThemeManifestEntry[] = [
  { id: DEFAULT_THEME_ID, label: "Polymath", file: "./data/default-map-theme.json" },
  { id: "the-aftermath", label: "Aftermath", file: "./data/the-aftermath.json" },
];

async function loadRawTheme(loader: () => Promise<{ default: unknown }>): Promise<MapThemeData> {
  const { RawMapThemeSchema } = await import("@/content/schemas/theme.js");
  const mod = await loader();
  // Raw theme JSON uses frames[].image; normalizeThemeImages converts to MapThemeData.
  return RawMapThemeSchema.parse(mod.default) as unknown as MapThemeData;
}

registerThemeLoader(DEFAULT_THEME_ID, () => loadRawTheme(() => import("./data/default-map-theme.json")));
registerThemeLoader("the-aftermath", () => loadRawTheme(() => import("./data/the-aftermath.json")));
