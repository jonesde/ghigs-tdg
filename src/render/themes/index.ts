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

export interface RegionVisualMeta {
  id: number;
  name: string;
  tiles: { path: string; terrain1: string; terrain2: string; terrain3: string; terrain4: string };
  base: string;
  mapImage: string;
  mapLayout: RegionMapLayout;
}

export interface SpawnPointVisualMeta {
  closed: string;
  open: string;
  transition: string;
}

export interface MapThemeData {
  id: string;
  label: string;
  menuBackground?: string;
  towers: Record<string, TowerVisualMeta>;
  enemies: Record<string, EnemyVisualMeta>;
  regions: RegionVisualMeta[];
  spawns?: SpawnPointVisualMeta;
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
