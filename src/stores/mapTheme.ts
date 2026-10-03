import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { MapsContent } from "../content/schemas/maps.js";
import type {
  EnemyVisualMeta,
  MapThemeData,
  MapThemeId,
  MapThemeManifestEntry,
  RegionVisualMeta,
  TowerVisualMeta,
} from "../render/themes/index.js";
import { DEFAULT_THEME_ID, MAP_THEME_LOADERS, MAP_THEME_MANIFEST } from "../render/themes/index.js";
import { normalizeThemeImages } from "../render/themes/normalize.js";
import { usePersistStore } from "./persist.js";

export const useMapThemeStore = defineStore("mapTheme", () => {
  const activeThemeId = ref<MapThemeId>(DEFAULT_THEME_ID);
  const activeTheme = ref<MapThemeData | null>(null);
  const defaultTheme = ref<MapThemeData | null>(null);
  const loadedThemes = ref<Record<string, MapThemeData>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function preloadDefault(): Promise<void> {
    try {
      const { RawMapThemeSchema } = await import("@/content/schemas/theme.js");
      const mod = await import("../render/themes/data/default-map-theme.json");
      const rawData = RawMapThemeSchema.parse(mod.default);
      const normalized = await normalizeThemeImages(rawData as never);
      defaultTheme.value = normalized;
      activeTheme.value = normalized;
      loadedThemes.value[DEFAULT_THEME_ID] = normalized;

      const persistStore = usePersistStore();
      const savedThemeId = persistStore.lastSelectedThemeId;
      const resolvedThemeId: MapThemeId =
        savedThemeId && savedThemeId !== DEFAULT_THEME_ID ? (savedThemeId as MapThemeId) : DEFAULT_THEME_ID;
      activeThemeId.value = resolvedThemeId;

      if (resolvedThemeId !== DEFAULT_THEME_ID) {
        await loadActive(resolvedThemeId);
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to preload default theme";
      throw err;
    }
  }

  async function fetchThemeData(id: MapThemeId): Promise<MapThemeData> {
    const loader = MAP_THEME_LOADERS[id];
    if (!loader) {
      throw new Error(`Unknown theme ID: ${id}`);
    }
    const rawData = await loader.load();
    return normalizeThemeImages(rawData as never);
  }

  async function loadActive(id: MapThemeId): Promise<MapThemeData> {
    if (id === DEFAULT_THEME_ID && defaultTheme.value) {
      activeThemeId.value = id;
      activeTheme.value = defaultTheme.value;
      loadedThemes.value[DEFAULT_THEME_ID] = defaultTheme.value;
      return defaultTheme.value;
    }
    const cached = loadedThemes.value[id];
    if (cached) {
      activeThemeId.value = id;
      activeTheme.value = cached;
      return cached;
    }
    loading.value = true;
    error.value = null;
    activeThemeId.value = id;
    try {
      const data = await fetchThemeData(id);
      loadedThemes.value[id] = data;
      activeTheme.value = data;
      return loadedThemes.value[id] ?? data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load theme";
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function ensureThemeLoaded(id: MapThemeId): Promise<MapThemeData> {
    if (id === DEFAULT_THEME_ID && defaultTheme.value) {
      loadedThemes.value[DEFAULT_THEME_ID] = defaultTheme.value;
      return defaultTheme.value;
    }
    const cached = loadedThemes.value[id];
    if (cached) return cached;
    const data = await fetchThemeData(id);
    loadedThemes.value[id] = data;
    return loadedThemes.value[id] ?? data;
  }

  // The active world's effective maps catalog (theme override merged over the
  // default content). Absent when the theme carries no override — the generators
  // then fall back to the default catalog.
  const resolvedMaps = computed<MapsContent | undefined>(() => (activeTheme.value ?? defaultTheme.value)?.maps);

  const regionNames = computed<string[]>(() => {
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const activeRegion = activeTheme.value?.regions.find((r) => r.id === i);
      const defaultRegion = defaultTheme.value?.regions.find((r) => r.id === i);
      names.push(activeRegion?.name ?? defaultRegion?.name ?? `Region ${i + 1}`);
    }
    return names;
  });

  // Resolves the active theme to the selected world before a run starts: the
  // worker re-resolves from its own copy of the same theme bundle, so both
  // sides must use the active world's catalog to stay tile-for-tile identical.
  async function ensureActiveTheme(): Promise<void> {
    const persistStore = usePersistStore();
    const themeId = persistStore.lastSelectedThemeId;
    if (activeTheme.value && activeTheme.value.id === themeId) {
      return;
    }
    if (defaultTheme.value && themeId === defaultTheme.value.id) {
      // Use preloaded default theme
      activeTheme.value = defaultTheme.value;
      return;
    }
    await loadActive(themeId).catch((err) => console.error("Failed to load theme:", err));
  }

  const availableThemes = computed<MapThemeManifestEntry[]>(() => MAP_THEME_MANIFEST);
  const activeThemeLabel = computed(() => {
    return MAP_THEME_MANIFEST.find((e) => e.id === activeThemeId.value)?.label || "Unknown";
  });

  function getTowerVisual(typeId: string): TowerVisualMeta | undefined {
    return activeTheme.value?.towers[typeId] ?? defaultTheme.value?.towers[typeId];
  }

  function getEnemyVisual(typeId: string): EnemyVisualMeta | undefined {
    return activeTheme.value?.enemies[typeId] ?? defaultTheme.value?.enemies[typeId];
  }

  // Resolves an enemy theme `shape` to a single unicode glyph for the text
  // minimap. Themes ship `shape` two ways: semantic names (default theme:
  // "circle" / "triangle" / ...) or raw glyph characters (Aftermath theme:
  // "●" / "◆" / ...). When the shape is already a single glyph character we
  // return it verbatim (so Aftermath-style shapes pass through untouched);
  // otherwise we map the known semantic names to glyphs, falling back to a
  // default dot for anything unknown.
  const ENEMY_SHAPE_GLYPHS: Record<string, string> = {
    circle: "●",
    triangle: "▲",
    square: "■",
    hexagon: "⬢",
    cross: "✚",
    star: "★",
    diamond: "◆",
    chevron: "▸",
    kite: "◈",
  };

  function getEnemyGlyph(shape: string): string {
    const codePointCount = Array.from(shape).length;
    if (codePointCount === 1) return shape;
    return ENEMY_SHAPE_GLYPHS[shape] ?? "●";
  }

  function getDefaultTowerVisual(typeId: string): TowerVisualMeta | undefined {
    return defaultTheme.value?.towers[typeId];
  }

  function getDefaultEnemyVisual(typeId: string): EnemyVisualMeta | undefined {
    return defaultTheme.value?.enemies[typeId];
  }

  function getRegionVisual(regionId: number): RegionVisualMeta | undefined {
    return (
      activeTheme.value?.regions.find((r) => r.id === regionId) ??
      defaultTheme.value?.regions.find((r) => r.id === regionId)
    );
  }

  function reset(): void {
    activeThemeId.value = DEFAULT_THEME_ID;
    activeTheme.value = defaultTheme.value;
    error.value = null;
  }

  return {
    activeThemeId,
    activeTheme,
    defaultTheme,
    loadedThemes,
    loading,
    error,
    preloadDefault,
    loadActive,
    ensureThemeLoaded,
    ensureActiveTheme,
    resolvedMaps,
    regionNames,
    availableThemes,
    activeThemeLabel,
    getTowerVisual,
    getEnemyVisual,
    getEnemyGlyph,
    getDefaultTowerVisual,
    getDefaultEnemyVisual,
    getRegionVisual,
    reset,
  };
});
