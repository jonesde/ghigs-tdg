import { defineStore } from "pinia";
import { computed, ref } from "vue";
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

  async function loadActive(id: MapThemeId): Promise<MapThemeData> {
    if (id === DEFAULT_THEME_ID && defaultTheme.value) {
      activeThemeId.value = id;
      activeTheme.value = defaultTheme.value;
      return defaultTheme.value;
    }
    loading.value = true;
    error.value = null;
    activeThemeId.value = id;
    try {
      const loader = MAP_THEME_LOADERS[id];
      if (!loader) {
        throw new Error(`Unknown theme ID: ${id}`);
      }
      const rawData = await loader.load();
      const data = await normalizeThemeImages(rawData as never);
      activeTheme.value = data;
      return data;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load theme";
      throw err;
    } finally {
      loading.value = false;
    }
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
    loading,
    error,
    preloadDefault,
    loadActive,
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
