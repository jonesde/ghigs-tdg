import { describe, expect, it, vi } from "vitest";
import type { MapsContent } from "@/content/schemas/maps.js";
import { RawMapThemeSchema } from "@/content/schemas/theme.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import chrithmathTheme from "@/render/themes/data/chrithmath.json";
import defaultTheme from "@/render/themes/data/default-map-theme.json";
import aftermathTheme from "@/render/themes/data/the-aftermath.json";
import { hexChannels } from "@/render/themes/fieldFill.js";
import { DEFAULT_THEME_ID, MAP_THEME_MANIFEST, type MapThemeData } from "@/render/themes/index.js";
import { normalizeThemeImages } from "@/render/themes/normalize.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { createTestMapThemeStore } from "../helpers/mock-stores";
import { makeMockRegionMapLayout, mockRegionMapImage } from "../helpers/regionMap";

describe("Map Theme System", () => {
  describe("Theme Manifest", () => {
    it("should have a default theme in the manifest", () => {
      const theme = MAP_THEME_MANIFEST.find((e) => e.id === DEFAULT_THEME_ID);
      expect(theme).toBeDefined();
      expect(theme!.id).toBe(DEFAULT_THEME_ID);
      expect(theme!.label).toBe("Polymath");
    });

    it("should have a file path for the default theme", () => {
      const defaultTheme = MAP_THEME_MANIFEST.find((e) => e.id === DEFAULT_THEME_ID);
      expect(defaultTheme).toBeDefined();
      expect(defaultTheme!.file).toContain("default-map-theme.json");
    });
  });

  describe("Theme Normalization", () => {
    it("should normalize tower visuals", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: {
          archer: {
            name: "Archer Tower",
            color: "#ff0000",
            icon: "🏹",
            animation: { duration: 1000, frames: [{ image: "<svg></svg>" }] },
            walking: { duration: 500, frames: [{ image: "<svg></svg>" }] },
          },
        },
        enemies: {
          goblin: {
            name: "Goblin",
            color: "#00ff00",
            shape: "circle",
            walking: { duration: 300, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [
          {
            id: 0,
            name: "Forest",
            tiles: {
              path: "<svg></svg>",
              terrain1: "<svg></svg>",
              terrain2: "<svg></svg>",
              terrain3: "<svg></svg>",
              terrain4: "<svg></svg>",
            },
            base: "<svg></svg>",
            mapImage: mockRegionMapImage,
            mapLayout: makeMockRegionMapLayout(),
          },
        ],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.id).toBe("test");
      expect(normalized.label).toBe("Test Theme");
      const archer = normalized.towers.archer!;
      expect(archer).toBeDefined();
      expect(archer.name).toBe("Archer Tower");
      expect(archer.animation).toBeDefined();
      expect(archer.animation!.duration).toBe(1000);
      expect(archer.walking).toBeDefined();
      const goblin = normalized.enemies.goblin!;
      expect(goblin).toBeDefined();
      expect(goblin.name).toBe("Goblin");
      expect(normalized.regions).toHaveLength(1);
      expect(normalized.regions[0]!.name).toBe("Forest");
      expect(normalized.regions[0]!.mapImage).toContain("<svg");
      expect(normalized.regions[0]!.mapLayout.viewBox).toBe("0 0 400 300");
      expect(normalized.regions[0]!.mapLayout.nodes).toHaveLength(16);
    });

    it("should normalize spawn visuals", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
        spawns: {
          closed: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='red'/></svg>",
          open: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='green'/></svg>",
          transition: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='blue'/></svg>",
        },
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.spawns).toBeDefined();
      expect(normalized.spawns!.closed).toContain("fill='red'");
      expect(normalized.spawns!.open).toContain("fill='green'");
      expect(normalized.spawns!.transition).toContain("fill='blue'");
    });

    it("should normalize tile variants and site art", async () => {
      const tile = (fill: string): string =>
        `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="${fill}"/></svg>`;
      const siteTile = (id: string): string => `<svg viewBox="0 0 36 36"><rect id="${id}"/></svg>`;
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "\u{1F527}", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [
          {
            id: 0,
            name: "Test Region",
            tiles: {
              path: tile("#111111"),
              terrain1: [tile("#222222"), tile("#333333")],
              terrain2: tile("#444444"),
              terrain3: tile("#555555"),
              terrain4: tile("#666666"),
            },
            base: "",
            mapImage: "<svg></svg>",
            mapLayout: makeMockRegionMapLayout(),
          },
        ],
        sites: {
          buildings: {
            armory: siteTile("armory"),
            magazine: siteTile("magazine"),
            beacon: siteTile("beacon"),
            foundry: siteTile("foundry"),
            clocktower: siteTile("clocktower"),
            aviary: siteTile("aviary"),
          },
          caches: { sealed: siteTile("sealed"), unlocked: siteTile("unlocked"), broken: siteTile("broken") },
          supplyDrop: siteTile("drop"),
        },
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      const tiles = normalized.regions[0]!.tiles;
      // A bare string and a variant list both normalize to a non-empty list, and
      // the tile string keeps its <svg> wrapper (the symbol builder strips that).
      expect(tiles.path).toEqual([tile("#111111")]);
      expect(tiles.terrain1).toHaveLength(2);
      expect(tiles.terrain1[0]).toContain("#222222");
      expect(tiles.terrain1[1]).toContain("#333333");
      expect(tiles.terrain2).toHaveLength(1);
      expect(normalized.sites?.buildings.armory).toBe(siteTile("armory"));
      expect(normalized.sites?.buildings.clocktower).toBe(siteTile("clocktower"));
      expect(normalized.sites?.buildings.aviary).toBe(siteTile("aviary"));
      expect(normalized.sites?.caches.broken).toBe(siteTile("broken"));
      expect(normalized.sites?.supplyDrop).toBe(siteTile("drop"));
    });

    it("should leave sites undefined when the theme ships none", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "\u{1F527}", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.sites).toBeUndefined();
    });

    it("should handle missing spawns gracefully", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.spawns).toBeUndefined();
    });

    it("should handle null animations", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      const basic = normalized.towers.basic!;
      expect(basic).toBeDefined();
      expect(basic.animation).toBeNull();
      expect(basic.walking).toBeNull();
    });

    it("normalizes menuBackground when present", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        menuBackground: "<svg viewBox='0 0 100 100'><rect width='100' height='100' fill='purple'/></svg>",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.menuBackground).toBeDefined();
      expect(normalized.menuBackground!.startsWith("<svg")).toBe(true);
      expect(normalized.menuBackground).toContain("fill='purple'");
    });

    it("leaves menuBackground undefined when absent", async () => {
      const rawTheme = {
        id: "test",
        label: "Test Theme",
        towers: { basic: { name: "Basic Tower", color: "#ffffff", icon: "🔧", animation: null } },
        enemies: {
          skeleton: {
            name: "Skeleton",
            color: "#cccccc",
            shape: "circle",
            walking: { duration: 400, frames: [{ image: "<svg></svg>" }] },
          },
        },
        regions: [],
      };

      const normalized = await normalizeThemeImages(rawTheme as never);
      expect(normalized.menuBackground).toBeUndefined();
    });
  });

  describe("Theme Store", () => {
    it("should initialize with default theme", () => {
      const store = createTestMapThemeStore();
      expect(store.activeThemeId).toBe(DEFAULT_THEME_ID);
    });

    it("should have manifest available", () => {
      const store = createTestMapThemeStore();
      expect(store.availableThemes).toBeDefined();
      expect(store.availableThemes.length).toBeGreaterThan(0);
    });

    it("should provide getters for tower/enemy/region visuals", () => {
      const store = createTestMapThemeStore();
      expect(store.getDefaultTowerVisual).toBeInstanceOf(Function);
      expect(store.getDefaultEnemyVisual).toBeInstanceOf(Function);
      expect(store.getRegionVisual).toBeInstanceOf(Function);
    });

    it("should provide loadActive function", () => {
      const store = createTestMapThemeStore();
      expect(store.loadActive).toBeInstanceOf(Function);
    });

    it("should provide preloadDefault and reset functions", () => {
      const store = createTestMapThemeStore();
      expect(store.preloadDefault).toBeInstanceOf(Function);
      expect(store.reset).toBeInstanceOf(Function);
    });

    it("should provide ensureThemeLoaded function", () => {
      const store = createTestMapThemeStore();
      expect(store.ensureThemeLoaded).toBeInstanceOf(Function);
    });

    it("loads a theme into loadedThemes without changing the active theme", async () => {
      const store = createTestMapThemeStore();
      const activeBefore = store.activeTheme;
      const loaded = await store.ensureThemeLoaded("the-aftermath");
      expect(loaded.menuBackground).toBeDefined();
      expect(store.loadedThemes["the-aftermath"]).toBe(loaded);
      expect(store.activeTheme).toBe(activeBefore);
    });

    it("returns the cached theme on repeated ensureThemeLoaded calls", async () => {
      const store = createTestMapThemeStore();
      const first = await store.ensureThemeLoaded("the-aftermath");
      const second = await store.ensureThemeLoaded("the-aftermath");
      expect(second).toBe(first);
    });

    it("reuses the loadedThemes cache when switching the active theme", async () => {
      const store = createTestMapThemeStore();
      const loaded = await store.ensureThemeLoaded("the-aftermath");
      const active = await store.loadActive("the-aftermath");
      expect(active).toBe(loaded);
      expect(store.activeTheme).toBe(loaded);
    });

    it("regionNames resolves from the active theme with per-region fallbacks", () => {
      const store = createTestMapThemeStore();
      expect(store.regionNames).toEqual(["Verdant Marches", "Sunscorch Coast", "Thornpeak Wilds"]);
      store.activeTheme = null;
      expect(store.regionNames).toEqual(["Verdant Marches", "Sunscorch Coast", "Thornpeak Wilds"]);
      store.defaultTheme = null;
      expect(store.regionNames).toEqual(["Region 1", "Region 2", "Region 3"]);
    });

    it("resolvedMaps exposes the active world's maps catalog or undefined", () => {
      const store = createTestMapThemeStore();
      expect(store.resolvedMaps).toBeUndefined();
      const catalog = { marker: true } as unknown as MapsContent;
      store.activeTheme = { ...store.defaultTheme!, maps: catalog };
      expect(store.resolvedMaps).toStrictEqual(catalog);
      store.activeTheme = null;
      expect(store.resolvedMaps).toBeUndefined();
    });

    it("ensureActiveTheme is a no-op when the active theme already matches the selected world", async () => {
      const store = createTestMapThemeStore();
      const activeBefore = store.activeTheme;
      await store.ensureActiveTheme();
      expect(store.activeTheme).toBe(activeBefore);
    });

    it("ensureActiveTheme falls back to the preloaded default theme for the default world", async () => {
      const store = createTestMapThemeStore();
      store.activeTheme = null;
      await store.ensureActiveTheme();
      expect(store.activeTheme).toBe(store.defaultTheme);
    });

    it("ensureActiveTheme loads the active theme for a selected non-default world", async () => {
      const store = createTestMapThemeStore();
      const persistStore = usePersistStore();
      persistStore.lastSelectedThemeId = "the-aftermath";
      store.activeTheme = null;
      await store.ensureActiveTheme();
      const activeThemeAfter = store.activeTheme as MapThemeData | null;
      expect(activeThemeAfter?.id).toBe("the-aftermath");
    });

    it("ensureMenuBackgroundLoaded reads the theme sidecar without loading the theme", async () => {
      const store = createTestMapThemeStore();
      const loadedBefore = store.loadedThemes["the-aftermath"];
      const preview = await store.ensureMenuBackgroundLoaded("the-aftermath");
      expect(preview?.startsWith("<svg")).toBe(true);
      expect(store.menuBackgrounds["the-aftermath"]).toBe(preview);
      // The point of the sidecar: the card preview never pulls the theme itself.
      expect(store.loadedThemes["the-aftermath"]).toBe(loadedBefore);
    });

    it("ensureMenuBackgroundLoaded matches the theme's own menuBackground", async () => {
      const store = createTestMapThemeStore();
      const loaded = await store.ensureThemeLoaded("the-aftermath");
      const preview = await store.ensureMenuBackgroundLoaded("the-aftermath");
      expect(preview).toBe(loaded.menuBackground);
    });

    it("ensureMenuBackgroundLoaded caches so a card preview costs one fetch", async () => {
      const store = createTestMapThemeStore();
      const first = await store.ensureMenuBackgroundLoaded("the-aftermath");
      const second = await store.ensureMenuBackgroundLoaded("the-aftermath");
      expect(second).toBe(first);
    });

    it("ensureMenuBackgroundLoaded warns and returns undefined for an unregistered world", async () => {
      const store = createTestMapThemeStore();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const preview = await store.ensureMenuBackgroundLoaded("not-a-theme");
      expect(preview).toBeUndefined();
      expect(store.menuBackgrounds["not-a-theme"]).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("every manifest theme ships a menu background sidecar that paints", async () => {
      const store = createTestMapThemeStore();
      for (const theme of store.availableThemes) {
        const preview = await store.ensureMenuBackgroundLoaded(theme.id);
        expect(preview, `${theme.id} sidecar`).toBeDefined();
        expect(preview!.startsWith("<svg")).toBe(true);
        expect(preview!.includes("url(#")).toBe(false);
      }
    });

    it("preloadDefault seeds the default world's card preview without a fetch", async () => {
      const store = useMapThemeStore();
      await store.preloadDefault();
      expect(store.menuBackgrounds[DEFAULT_THEME_ID]).toBe(store.defaultTheme?.menuBackground);
    });
  });
});

describe("Aftermath theme", () => {
  const theme = RawMapThemeSchema.parse(aftermathTheme);

  const towerContract: Record<string, { name: string; color: string; icon: string; duration: number }> = {
    basic: { name: "Ten-Miss Blaster", color: "#b87333", icon: "▪", duration: 0.3 },
    ice: { name: "Cryo-ME A-River", color: "#55ccff", icon: "◆", duration: 0.4 },
    sniper: { name: "Longshot Silver", color: "#888", icon: "◎", duration: 0.35 },
    cannon: { name: "Junk Cannon", color: "#5a4a3a", icon: "◉", duration: 0.5 },
    lightning: { name: "Tesla-Foil Hat", color: "#ff0", icon: "⚡", duration: 0.25 },
    railgun: { name: "Railroad Line-Driver", color: "#44ddaa", icon: "▲", duration: 0.45 },
    sturdyWall: { name: "Bastion Wall", color: "#b08968", icon: "◧", duration: 0.3 },
    shotgunTank: { name: "Shotgun Tank", color: "#c08552", icon: "◳", duration: 0.3 },
  };

  const enemyContract: Record<string, { name: string; color: string; shape: string; walk: number; hit: number }> = {
    minion: { name: "Bad Bug", color: "#88aa44", shape: "●", walk: 0.8, hit: 0.3 },
    runner: { name: "Manic Mantis", color: "#44aa44", shape: "◆", walk: 0.6, hit: 0.3 },
    tank: { name: "Yow Guy", color: "#886644", shape: "■", walk: 1.0, hit: 0.3 },
    shielded: { name: "Shell Shocked", color: "#99aabb", shape: "◇", walk: 0.7, hit: 0.3 },
    healer: { name: "Mole Mender", color: "#bb77aa", shape: "▲", walk: 0.9, hit: 0.3 },
    boss: { name: "Death Draw", color: "#cc6600", shape: "★", walk: 1.2, hit: 0.4 },
    flyer: { name: "Ash Moth", color: "#c4b45a", shape: "◆", walk: 0.7, hit: 0.3 },
    jet: { name: "Bottle Rocket", color: "#e07040", shape: "▸", walk: 0.45, hit: 0.3 },
    aegis: { name: "Tin Canopy", color: "#8ec8d8", shape: "◈", walk: 0.9, hit: 0.3 },
    mender: { name: "Cairn Mender", color: "#e08a5a", shape: "⬢", walk: 1.0, hit: 0.3 },
    skyhold: { name: "Sky Hold", color: "#9ec8d8", shape: "▾", walk: 0.8, hit: 0.3 },
    broodwing: { name: "Cinder Brood", color: "#d8b45a", shape: "⬣", walk: 0.9, hit: 0.3 },
  };

  it("keeps the Aftermath identity and the frame contract", () => {
    expect(theme.id).toBe("the-aftermath");
    expect(theme.label).toBe("Aftermath");
    expect(Object.keys(theme.towers)).toEqual(Object.keys(towerContract));
    expect(Object.keys(theme.enemies)).toEqual(Object.keys(enemyContract));

    for (const [towerId, expected] of Object.entries(towerContract)) {
      const tower = theme.towers[towerId];
      expect(tower).toBeDefined();
      expect(tower?.name).toBe(expected.name);
      expect(tower?.color).toBe(expected.color);
      expect(tower?.icon).toBe(expected.icon);
      expect(tower?.animation?.duration).toBe(expected.duration);
      expect(tower?.animation?.frames).toHaveLength(3);
      expect(tower?.walking?.frames).toHaveLength(1);
      expect(tower?.walking?.frames[0]?.image).toBe(tower?.animation?.frames[0]?.image);
    }

    for (const [enemyId, expected] of Object.entries(enemyContract)) {
      const enemy = theme.enemies[enemyId];
      expect(enemy).toBeDefined();
      expect(enemy?.name).toBe(expected.name);
      expect(enemy?.color).toBe(expected.color);
      expect(enemy?.shape).toBe(expected.shape);
      expect(enemy?.walking.duration).toBe(expected.walk);
      expect(enemy?.walking.frames).toHaveLength(8);
      expect(enemy?.hitReaction?.duration).toBe(expected.hit);
      expect(enemy?.hitReaction?.frames).toHaveLength(3);
      expect(enemy?.attack?.duration).toBe(0.2);
      expect(enemy?.attack?.frames).toHaveLength(3);
    }

    expect(theme.regions.map((region) => region.name)).toEqual(["Rustbloom Wastes", "Sand and Regret", "Ashen Highs"]);
    expect(theme.spawns?.closed.startsWith("<svg")).toBe(true);
    expect(theme.spawns?.open.startsWith("<svg")).toBe(true);
    expect(theme.spawns?.transition.startsWith("<svg")).toBe(true);
  });

  it("exposes the airborne types plus mender, skyhold, and broodwing on the Polymath theme", () => {
    const polymath = RawMapThemeSchema.parse(defaultTheme);
    expect(Object.keys(polymath.enemies)).toEqual([
      "minion",
      "runner",
      "tank",
      "shielded",
      "healer",
      "boss",
      "flyer",
      "jet",
      "aegis",
      "mender",
      "skyhold",
      "broodwing",
    ]);
    expect(polymath.enemies.flyer).toMatchObject({ name: "Flyer", color: "#5ec8e8", shape: "diamond" });
    expect(polymath.enemies.jet).toMatchObject({ name: "Jet", color: "#ff7a3c", shape: "chevron" });
    expect(polymath.enemies.aegis).toMatchObject({ name: "Aegis", color: "#8ea2ff", shape: "kite" });
    expect(polymath.enemies.mender).toMatchObject({ name: "Mender", color: "#66d9a5", shape: "hexagon" });
    expect(polymath.enemies.skyhold).toMatchObject({ name: "Skyhold", color: "#7fb2ff", shape: "diamond" });
    expect(polymath.enemies.broodwing).toMatchObject({ name: "Broodwing", color: "#e8a13c", shape: "triangle" });
    const walkDurations = { flyer: 0.7, jet: 0.45, aegis: 0.9, mender: 1.1, skyhold: 0.8, broodwing: 0.9 } as const;
    for (const enemyId of ["flyer", "jet", "aegis", "mender", "skyhold", "broodwing"] as const) {
      const enemy = polymath.enemies[enemyId];
      expect(enemy?.walking.duration).toBe(walkDurations[enemyId]);
      expect(enemy?.walking.frames).toHaveLength(8);
      expect(enemy?.hitReaction?.frames).toHaveLength(3);
      expect(enemy?.attack?.frames).toHaveLength(3);
      expect(enemy?.attack?.duration).toBe(0.2);
    }
  });

  // The flat-paint rule (no url(# paint servers, no filters) is asserted for all
  // shipped themes by "Theme tile art" below, which supersedes the former
  // single-theme copy of that sweep.
});

describe("Chrithmath theme", () => {
  const theme = RawMapThemeSchema.parse(chrithmathTheme);

  const towerContract: Record<string, { name: string; color: string; icon: string; duration: number }> = {
    basic: { name: "Gingerbread Barrage", color: "#c8804a", icon: "▪", duration: 0.3 },
    ice: { name: "Candy Cane Coil", color: "#e87a7a", icon: "◆", duration: 0.4 },
    sniper: { name: "The Nutcracker", color: "#b0a08c", icon: "◎", duration: 0.35 },
    cannon: { name: "Marzipan Mortar", color: "#d8c8a8", icon: "◉", duration: 0.5 },
    lightning: { name: "Cotton Candy Cloud", color: "#f0c0d0", icon: "⚡", duration: 0.25 },
    railgun: { name: "Peppermint Railgun", color: "#e8e8f0", icon: "▲", duration: 0.45 },
    sturdyWall: { name: "Stollen Bastion", color: "#a08050", icon: "◧", duration: 0.3 },
    shotgunTank: { name: "Jimmie Blaster", color: "#e0a040", icon: "◳", duration: 0.3 },
  };

  const enemyContract: Record<string, { name: string; color: string; shape: string; walk: number; hit: number }> = {
    minion: { name: "Tin Soldier", color: "#9fb4c4", shape: "■", walk: 0.8, hit: 0.3 },
    runner: { name: "All Aboard", color: "#e8b04a", shape: "▸", walk: 0.6, hit: 0.3 },
    tank: { name: "Grizzly Ted", color: "#b08050", shape: "⬢", walk: 1.0, hit: 0.3 },
    shielded: { name: "Marble's the Man", color: "#8fd0e8", shape: "●", walk: 0.7, hit: 0.3 },
    healer: { name: "Music Box Mender", color: "#e8a0c0", shape: "♪", walk: 0.9, hit: 0.3 },
    boss: { name: "Jack in the Box", color: "#d05050", shape: "★", walk: 1.2, hit: 0.4 },
    flyer: { name: "Paper Kite", color: "#e8e0c0", shape: "◈", walk: 0.7, hit: 0.3 },
    jet: { name: "Yo-Yo", color: "#70c0a0", shape: "◆", walk: 0.45, hit: 0.3 },
    aegis: { name: "Roly-Poly", color: "#c0c8d0", shape: "✚", walk: 0.9, hit: 0.3 },
    mender: { name: "Mince Pie Medic", color: "#7ec8a8", shape: "✛", walk: 1.0, hit: 0.3 },
    skyhold: { name: "Frost Star", color: "#90b4e0", shape: "▾", walk: 0.8, hit: 0.3 },
    broodwing: { name: "Ginger Brood", color: "#d8a050", shape: "❖", walk: 0.9, hit: 0.3 },
  };

  it("keeps the Chrithmath identity and the frame contract", () => {
    expect(theme.id).toBe("chrithmath");
    expect(theme.label).toBe("Chrithmath");
    expect(Object.keys(theme.towers)).toEqual(Object.keys(towerContract));
    expect(Object.keys(theme.enemies)).toEqual(Object.keys(enemyContract));

    for (const [towerId, expected] of Object.entries(towerContract)) {
      const tower = theme.towers[towerId];
      expect(tower).toBeDefined();
      expect(tower?.name).toBe(expected.name);
      expect(tower?.color).toBe(expected.color);
      expect(tower?.icon).toBe(expected.icon);
      expect(tower?.animation?.duration).toBe(expected.duration);
      expect(tower?.animation?.frames).toHaveLength(3);
      expect(tower?.walking?.frames).toHaveLength(1);
      expect(tower?.walking?.frames[0]?.image).toBe(tower?.animation?.frames[0]?.image);
    }

    for (const [enemyId, expected] of Object.entries(enemyContract)) {
      const enemy = theme.enemies[enemyId];
      expect(enemy).toBeDefined();
      expect(enemy?.name).toBe(expected.name);
      expect(enemy?.color).toBe(expected.color);
      expect(enemy?.shape).toBe(expected.shape);
      expect(enemy?.walking.duration).toBe(expected.walk);
      expect(enemy?.walking.frames).toHaveLength(8);
      expect(enemy?.hitReaction?.duration).toBe(expected.hit);
      expect(enemy?.hitReaction?.frames).toHaveLength(3);
      expect(enemy?.attack?.duration).toBe(0.2);
      expect(enemy?.attack?.frames).toHaveLength(3);
    }

    expect(theme.regions.map((region) => region.name)).toEqual([
      "The Yule Vale",
      "The Sunspice Coast",
      "The Icon Snows",
    ]);
    expect(theme.spawns?.closed.startsWith("<svg")).toBe(true);
    expect(theme.spawns?.open.startsWith("<svg")).toBe(true);
    expect(theme.spawns?.transition.startsWith("<svg")).toBe(true);
  });
});

describe("Menu background", () => {
  const shippedThemes = [
    { label: "Polymath", raw: defaultTheme },
    { label: "Aftermath", raw: aftermathTheme },
    { label: "Chrithmath", raw: chrithmathTheme },
  ];

  for (const { label, raw } of shippedThemes) {
    it(`${label} ships a main menu background`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      expect(theme.menuBackground).toBeDefined();
      expect(theme.menuBackground!.startsWith("<svg")).toBe(true);
      expect(theme.menuBackground!.includes("url(#")).toBe(false);
      expect(theme.menuBackground!.includes("<filter")).toBe(false);
    });
  }

  it("parses a theme without menuBackground (field is optional)", () => {
    const raw = structuredClone(defaultTheme) as Record<string, unknown>;
    delete raw.menuBackground;
    expect(() => RawMapThemeSchema.parse(raw)).not.toThrow();
  });
});

describe("Region map layouts", () => {
  const shippedThemes = [
    { label: "Polymath", raw: defaultTheme },
    { label: "Aftermath", raw: aftermathTheme },
    { label: "Chrithmath", raw: chrithmathTheme },
  ];

  for (const { label, raw } of shippedThemes) {
    describe(label, () => {
      const theme = RawMapThemeSchema.parse(raw);

      it("ships a region map image and level layout for every region", () => {
        expect(theme.regions).toHaveLength(3);
        for (const region of theme.regions) {
          expect(region.mapImage.startsWith("<svg")).toBe(true);
          expect(region.mapImage).toContain(`viewBox="${region.mapLayout.viewBox}"`);
          expect(region.mapImage.includes("url(#")).toBe(false);
          expect(region.mapImage.includes("<filter")).toBe(false);
          expect(region.mapLayout.nodes).toHaveLength(16);
          expect(region.mapLayout.connections).toHaveLength(15);
        }
      });

      it("places 12 level nodes and 4 progressive branch nodes", () => {
        for (const region of theme.regions) {
          const levels = region.mapLayout.nodes
            .filter((node) => node.kind === "level")
            .map((node) => node.level)
            .sort((a, b) => a - b);
          expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
          const progressiveLevels = region.mapLayout.nodes
            .filter((node) => node.kind === "progressive")
            .map((node) => node.level)
            .sort((a, b) => a - b);
          expect(progressiveLevels).toEqual([1, 5, 9, 12]);
        }
      });

      it("connects the level chain and branches progressive nodes off levels 1, 5, 9, and 12", () => {
        for (const region of theme.regions) {
          const nodeKeys = new Set(region.mapLayout.nodes.map((node) => `${node.kind}:${node.level}`));
          for (const connection of region.mapLayout.connections) {
            expect(nodeKeys.has(`${connection.from.kind}:${connection.from.level}`)).toBe(true);
            expect(nodeKeys.has(`${connection.to.kind}:${connection.to.level}`)).toBe(true);
          }
          const chain = region.mapLayout.connections.filter(
            (connection) => connection.from.kind === "level" && connection.to.kind === "level",
          );
          expect(chain).toHaveLength(11);
          const branches = region.mapLayout.connections.filter((connection) => connection.to.kind === "progressive");
          expect(branches.map((connection) => connection.from.level)).toEqual([1, 5, 9, 12]);
        }
      });
    });
  }

  it("rejects duplicate region map nodes", () => {
    const raw = structuredClone(defaultTheme);
    raw.regions[0]!.mapLayout.nodes.push({ kind: "level", level: 1, x: 0, y: 0 });
    expect(() => RawMapThemeSchema.parse(raw)).toThrow();
  });

  it("rejects region map connections that do not resolve to a node", () => {
    const raw = structuredClone(defaultTheme);
    raw.regions[0]!.mapLayout.connections.push({
      from: { kind: "level", level: 1 },
      to: { kind: "progressive", level: 2 },
    });
    expect(() => RawMapThemeSchema.parse(raw)).toThrow();
  });
});

function buildCustomTheme(overrides?: {
  regionBase?: string;
  pathColor?: string;
  terrainColors?: string[];
}): MapThemeData {
  const pathColor = overrides?.pathColor ?? "#abcdef";
  const terrainColors = overrides?.terrainColors ?? ["#111111", "#222222", "#333333", "#444444"];
  const regionBase = overrides?.regionBase ?? "";
  const makeTileSvg = (color: string, withCrossHatch: boolean): string => {
    const crossHatch = withCrossHatch
      ? '<path d="M7.2,7.2 L28.8,28.8 M28.8,7.2 L7.2,28.8" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>'
      : "";
    return `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="${color}"/>${crossHatch}</svg>`;
  };
  return {
    id: "custom",
    label: "Custom Theme",
    spawns: {
      closed: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='red'/></svg>",
      open: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='green'/></svg>",
      transition: "<svg viewBox='0 0 36 36'><rect width='36' height='36' fill='blue'/></svg>",
    },
    towers: {
      basic: {
        name: "Basic Tower",
        color: "#8fbc8f",
        icon: "\u2500",
        animation: {
          duration: 0.3,
          referenceImages: [
            { svg: "<svg viewBox='-16 -16 32 32'><rect/></svg>" },
            { svg: "<svg viewBox='-16 -16 32 32'><circle/></svg>" },
            { svg: "<svg viewBox='-16 -16 32 32'><path/></svg>" },
          ],
        },
        walking: { duration: 0.6, referenceImages: [{ svg: "<svg viewBox='-16 -16 32 32'><rect/></svg>" }] },
      },
    },
    enemies: {
      minion: {
        name: "Minion",
        color: "#e85a6a",
        shape: "circle",
        walking: {
          duration: 0.5,
          referenceImages: [
            { svg: "<svg viewBox='-1 -1 2 2'><rect/></svg>" },
            { svg: "<svg viewBox='-1 -1 2 2'><circle/></svg>" },
          ],
        },
        hitReaction: { duration: 0.1, referenceImages: [{ svg: "<svg viewBox='-1 -1 2 2'><path/></svg>" }] },
      },
    },
    regions: [
      {
        id: 0,
        name: "Test Region",
        tiles: {
          path: [makeTileSvg(pathColor, false)],
          terrain1: [makeTileSvg(terrainColors[0]!, true)],
          terrain2: [makeTileSvg(terrainColors[1]!, true)],
          terrain3: [makeTileSvg(terrainColors[2]!, true)],
          terrain4: [makeTileSvg(terrainColors[3]!, true)],
        },
        base: regionBase,
        mapImage: mockRegionMapImage,
        mapLayout: makeMockRegionMapLayout(),
      },
    ],
  };
}

function makeMinimalMap(baseX: number, baseY: number, spawnCount: number = 0) {
  const spawns = Array.from({ length: spawnCount }, (_, i) => ({ x: i, y: 0 }));
  return {
    width: 2,
    height: 1,
    tiles: [
      [
        { type: "terrain" as const, height: 2 },
        { type: "path" as const, height: 0 },
      ],
    ],
    spawns,
    base: { x: baseX, y: baseY },
    regionId: 0,
    seed: 42,
  };
}

describe("SVG Static Content Render Placement", () => {
  describe("Spawn symbol ID generation", () => {
    it("should generate spawn symbol IDs from theme", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme();
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: null };
      const { staticDefsContent } = useSvgStaticContent(mapRef as never);
      const defs = staticDefsContent.value;

      expect(defs).toContain('<symbol id="spawn-closed"');
      expect(defs).toContain('<symbol id="spawn-open"');
      expect(defs).toContain('<symbol id="spawn-transition"');
      expect(defs).toContain('viewBox="0 0 36 36"');
    });
  });

  describe("Symbol ID generation", () => {
    it("should generate symbol IDs matching the frame counts in the theme", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme();
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: null };
      const { staticDefsContent } = useSvgStaticContent(mapRef as never);
      const defs = staticDefsContent.value;

      expect(defs).toContain('<symbol id="tower-basic-f0"');
      expect(defs).toContain('<symbol id="tower-basic-f1"');
      expect(defs).toContain('<symbol id="tower-basic-f2"');
      expect(defs).toContain('<symbol id="enemy-minion-f0"');
      expect(defs).toContain('<symbol id="enemy-minion-f1"');
      expect(defs).toContain('<symbol id="enemy-minion-hit-f0"');
      expect(defs).not.toContain('<symbol id="tower-basic-f3"');
      expect(defs).not.toContain('<symbol id="enemy-minion-f2"');
      expect(defs).toContain('viewBox="-16 -16 32 32"');
      expect(defs).toContain('viewBox="-1 -1 2 2"');
    });
  });

  describe("Tile placement", () => {
    it("should render tile rects with region path/terrain colors and overlays", () => {
      const store = createTestMapThemeStore();
      const pathColor = "#abcdef";
      const terrainColors = ["#aabbcc", "#bbccdd", "#ccddee", "#ddeeff"];
      const customTheme = buildCustomTheme({ pathColor, terrainColors });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const { gridContent } = useSvgStaticContent(mapRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<use href="#tile-r0-terrain2"');
      expect(svg).toContain('<use href="#tile-r0-path"');
      expect(svg).toContain('<svg x="0" y="0" width="36" height="36" viewBox="0 0 36 36" overflow="hidden">');
      expect(svg).not.toContain("transform-box:fill-box");
      const rotations = svg.match(/rotate\([^)]*\)/g) ?? [];
      expect(rotations.length).toBeGreaterThan(0);
      for (const rotation of rotations) {
        expect(rotation).toMatch(/^rotate\((90|180|270) 18 18\)$/);
      }
    });
  });

  describe("Spawn placement", () => {
    it("keeps spawn markers out of the static grid content", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme();
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1, 3) };
      const { gridContent } = useSvgStaticContent(mapRef as never);
      const svg = gridContent.value;

      // Spawn markers are dynamic (their href flips per snapshot) and are owned
      // by SpawnManager's imperative layer; if they lived in this v-html string,
      // a re-render (grid or theme change) would replace the nodes SpawnManager
      // captured and the open/close states would stop reaching the DOM.
      expect(svg).not.toContain("spawn-marker");
      expect(svg).not.toContain('id="spawn-');
    });
  });

  describe("Base placement", () => {
    it("places themed base SVG inside base-structure group when region.base is non-empty", () => {
      const store = createTestMapThemeStore();
      const regionBase = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#f0f"/></svg>';
      const customTheme = buildCustomTheme({ regionBase });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const { gridContent } = useSvgStaticContent(mapRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<g id="base-structure"');
      const groupStart = svg.indexOf('<g id="base-structure"');
      const groupEnd = svg.indexOf("</g>", groupStart);
      const groupContent = svg.slice(groupStart, groupEnd);
      expect(groupContent).toContain('<rect width="10" height="10" fill="#f0f"/>');
      expect(groupContent).not.toContain("url(#base-gradient)");
    });

    it("uses procedural fallback when region.base is empty", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme({ regionBase: "" });
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1) };
      const { gridContent } = useSvgStaticContent(mapRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<g id="base-structure"');
      const groupStart = svg.indexOf('<g id="base-structure"');
      const groupEnd = svg.indexOf("</g>", groupStart);
      const groupContent = svg.slice(groupStart, groupEnd);
      expect(groupContent).toContain("url(#base-gradient)");
    });
  });
});

// Rotated neighbors meet on the cell edge, so tile ink has to stay inside a
// 3px band around every cell. The one deliberate exception is the inner ring
// rect, which is rotationally symmetric so all four rotations paint the same
// band. This is the tile-side half of the rule MapThemeHowTo.md documents.
const TILE_EDGE_BAND_INSET = 3;

function blobBoxes(tileContent: string): { minX: number; minY: number; maxX: number; maxY: number }[] {
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  for (const match of tileContent.matchAll(/<(ellipse|circle)\b([^>]*?)\/?>/g)) {
    const attributes = match[2]!;
    const numberAttribute = (name: string): number => {
      const found = attributes.match(new RegExp(`\\b${name}="([\\d.]+)"`));
      return found ? Number(found[1]) : 0;
    };
    const centerX = numberAttribute("cx");
    const centerY = numberAttribute("cy");
    const radiusX = numberAttribute("rx") || numberAttribute("r");
    const radiusY = numberAttribute("ry") || numberAttribute("r");
    boxes.push({ minX: centerX - radiusX, minY: centerY - radiusY, maxX: centerX + radiusX, maxY: centerY + radiusY });
  }
  return boxes;
}

function relativeLuminanceOfChannels(channels: [number, number, number]): number {
  const channelToLinear = (channel: number): number => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = channels;
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue);
}

describe("Theme tile art", () => {
  const shippedThemes = [
    { label: "Polymath", raw: defaultTheme },
    { label: "Aftermath", raw: aftermathTheme },
    { label: "Chrithmath", raw: chrithmathTheme },
  ];
  const TERRAIN_KINDS = ["terrain1", "terrain2", "terrain3", "terrain4"] as const;
  const TILE_KINDS = ["path", ...TERRAIN_KINDS] as const;

  // A tile kind is one image or a list of variants in theme JSON; every image
  // has to satisfy the same rules.
  function variantsOf(rawImage: string | string[]): string[] {
    return Array.isArray(rawImage) ? rawImage : [rawImage];
  }

  function firstFillHex(tileContent: string): string {
    const firstFill = tileContent.match(/fill="(#[0-9a-fA-F]{3,8})"/);
    if (!firstFill) throw new Error("tile has no hex fill");
    return firstFill[1]!;
  }

  function firstFillTag(tileContent: string): string {
    const firstFillIndex = tileContent.search(/fill="#[0-9a-fA-F]{3,8}"/);
    const tagStart = tileContent.lastIndexOf("<", firstFillIndex);
    return tileContent.slice(tagStart, tileContent.indexOf(">", firstFillIndex));
  }

  for (const { label, raw } of shippedThemes) {
    it(`${label} tile variants all open with the full-bleed field rect`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      for (const region of theme.regions) {
        for (const kind of TILE_KINDS) {
          const variants = variantsOf(region.tiles[kind]);
          expect(variants.length).toBeGreaterThanOrEqual(1);
          for (const variant of variants) {
            const tag = firstFillTag(variant);
            expect(tag.startsWith("<rect")).toBe(true);
            expect(tag).toContain('width="36"');
            expect(tag).toContain('height="36"');
          }
        }
      }
    });

    it(`${label} shares one field fill across a kind's variants`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      for (const region of theme.regions) {
        for (const kind of TILE_KINDS) {
          const fieldFills = new Set(variantsOf(region.tiles[kind]).map((variant) => firstFillHex(variant)));
          expect(fieldFills.size).toBe(1);
        }
      }
    });

    it(`${label} terrain ramps darken with height`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      for (const region of theme.regions) {
        const luminosities = TERRAIN_KINDS.map((kind) => {
          const channels = hexChannels(firstFillHex(variantsOf(region.tiles[kind])[0]!));
          if (!channels) throw new Error("terrain field fill is not a 3- or 6-digit hex");
          return relativeLuminanceOfChannels(channels);
        });
        for (let step = 1; step < luminosities.length; step++) {
          expect(luminosities[step]).toBeLessThanOrEqual(luminosities[step - 1]!);
        }
      }
    });

    it(`${label} sprites paint without document-scoped paint servers`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      const images: string[] = [];
      for (const tower of Object.values(theme.towers)) {
        for (const frame of tower.animation?.frames ?? []) images.push(frame.image);
        for (const frame of tower.walking?.frames ?? []) images.push(frame.image);
      }
      for (const enemy of Object.values(theme.enemies)) {
        for (const frame of enemy.walking.frames) images.push(frame.image);
        for (const frame of enemy.hitReaction?.frames ?? []) images.push(frame.image);
        for (const frame of enemy.attack?.frames ?? []) images.push(frame.image);
      }
      for (const region of theme.regions) {
        for (const kind of TILE_KINDS) images.push(...variantsOf(region.tiles[kind]));
        images.push(region.base);
      }
      images.push(theme.spawns?.closed ?? "", theme.spawns?.open ?? "", theme.spawns?.transition ?? "");
      const sites = theme.sites;
      if (sites) {
        images.push(...Object.values(sites.buildings), ...Object.values(sites.caches));
        if (sites.supplyDrop) images.push(sites.supplyDrop);
      }
      for (const image of images) {
        expect(image.includes("url(#")).toBe(false);
        expect(image.includes("<filter")).toBe(false);
      }
    });

    it(`${label} ships three variants per tile kind`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      for (const region of theme.regions) {
        for (const kind of TILE_KINDS) {
          expect(variantsOf(region.tiles[kind])).toHaveLength(3);
        }
      }
    });

    it(`${label} ships 36x36 art for every map site`, () => {
      const theme = RawMapThemeSchema.parse(raw);
      const sites = theme.sites;
      expect(new Set(Object.keys(sites?.buildings ?? {}))).toEqual(
        new Set(["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"]),
      );
      expect(new Set(Object.keys(sites?.caches ?? {}))).toEqual(new Set(["sealed", "unlocked", "broken"]));
      // Drawn at 26 world px inside a 26px box, so the 36x36 viewBox is what
      // scales the glyph: art authored in any other box clips.
      const images = [...Object.values(sites?.buildings ?? {}), ...Object.values(sites?.caches ?? {})];
      if (sites?.supplyDrop) images.push(sites.supplyDrop);
      expect(images).toHaveLength(10);
      for (const image of images) {
        expect(image).toContain('<svg viewBox="0 0 36 36">');
      }
    });
  }

  it("keeps Polymath tile blobs inside the edge band", () => {
    const theme = RawMapThemeSchema.parse(defaultTheme);
    for (const region of theme.regions) {
      for (const kind of TILE_KINDS) {
        for (const variant of variantsOf(region.tiles[kind])) {
          for (const box of blobBoxes(variant)) {
            expect(box.minX).toBeGreaterThanOrEqual(TILE_EDGE_BAND_INSET);
            expect(box.minY).toBeGreaterThanOrEqual(TILE_EDGE_BAND_INSET);
            expect(box.maxX).toBeLessThanOrEqual(36 - TILE_EDGE_BAND_INSET);
            expect(box.maxY).toBeLessThanOrEqual(36 - TILE_EDGE_BAND_INSET);
          }
        }
      }
    }
  });
});

describe("Contour edge pass", () => {
  function makeContourMap(row: { type: string; height: number }[]) {
    return { width: row.length, height: 1, tiles: [row], spawns: [], base: null, regionId: 0, seed: 42 };
  }

  function edgeSegmentCount(svg: string, edgeName: string): number {
    const match = svg.match(new RegExp(`<path data-edge="${edgeName}" d="([^"]*)"`));
    if (!match) return 0;
    return (match[1]!.match(/M/g) ?? []).length;
  }

  it("draws a cliff at the height step, the same contours on path edges, and a map border", () => {
    const store = createTestMapThemeStore();
    const customTheme = buildCustomTheme();
    store.activeTheme = customTheme;
    store.defaultTheme = customTheme;

    const map = makeContourMap([
      { type: "terrain", height: 1 },
      { type: "terrain", height: 2 },
      { type: "path", height: 0 },
      { type: "terrain", height: 1 },
    ]);
    const { gridContent } = useSvgStaticContent({ value: map } as never);
    const svg = gridContent.value;

    // height 1→2 is thin; path (level 0)→height 2 is thick; path→height 1 is thin.
    expect(edgeSegmentCount(svg, "cliff-thin")).toBe(2);
    expect(edgeSegmentCount(svg, "cliff-thick")).toBe(1);
    expect(edgeSegmentCount(svg, "curb")).toBe(0);
    expect(edgeSegmentCount(svg, "border")).toBe(10);
  });

  it("draws no interior edge between path, spawn, and base, and a thick contour against tall terrain", () => {
    const store = createTestMapThemeStore();
    const customTheme = buildCustomTheme();
    store.activeTheme = customTheme;
    store.defaultTheme = customTheme;

    const map = makeContourMap([
      { type: "spawn", height: 1 },
      { type: "path", height: 1 },
      { type: "base", height: 1 },
      { type: "terrain", height: 3 },
    ]);
    const { gridContent } = useSvgStaticContent({ value: map } as never);
    const svg = gridContent.value;

    expect(edgeSegmentCount(svg, "cliff-thin")).toBe(0);
    expect(edgeSegmentCount(svg, "cliff-thick")).toBe(1);
  });

  it("draws no interior edge between same-height terrain neighbors", () => {
    const store = createTestMapThemeStore();
    const customTheme = buildCustomTheme();
    store.activeTheme = customTheme;
    store.defaultTheme = customTheme;

    const map = makeContourMap([
      { type: "terrain", height: 2 },
      { type: "terrain", height: 2 },
    ]);
    const { gridContent } = useSvgStaticContent({ value: map } as never);
    const svg = gridContent.value;

    expect(edgeSegmentCount(svg, "cliff-thin")).toBe(0);
    expect(edgeSegmentCount(svg, "cliff-thick")).toBe(0);
    expect(edgeSegmentCount(svg, "border")).toBe(6);
  });

  it("separates a two-step height drop from a one-step height drop", () => {
    const store = createTestMapThemeStore();
    const customTheme = buildCustomTheme();
    store.activeTheme = customTheme;
    store.defaultTheme = customTheme;

    const map = makeContourMap([
      { type: "terrain", height: 1 },
      { type: "terrain", height: 2 },
      { type: "terrain", height: 4 },
    ]);
    const { gridContent } = useSvgStaticContent({ value: map } as never);
    const svg = gridContent.value;

    expect(edgeSegmentCount(svg, "cliff-thin")).toBe(1);
    expect(edgeSegmentCount(svg, "cliff-thick")).toBe(1);
  });

  it("tones the backdrop from the region terrain2 field fill and overlays the vignette", () => {
    const store = createTestMapThemeStore();
    const customTheme = buildCustomTheme();
    store.activeTheme = customTheme;
    store.defaultTheme = customTheme;

    const { gridContent, mapDefsContent } = useSvgStaticContent({
      value: makeContourMap([{ type: "terrain", height: 1 }]),
    } as never);
    const svg = gridContent.value;
    // buildCustomTheme terrain2 is #222222; scaled 35% toward black each channel is round(34 * 0.65) = 22.
    expect(svg).toContain('fill="rgba(22,22,22,1)"');
    expect(svg).toContain('fill="url(#map-vignette)"');
    expect(mapDefsContent.value).toContain('<radialGradient id="map-vignette"');
  });
});

describe("Entity symbol frames carry no injected ground shadow", () => {
  function defsForTheme(theme: MapThemeData): string {
    const store = createTestMapThemeStore();
    store.activeTheme = theme;
    store.defaultTheme = theme;
    const { staticDefsContent } = useSvgStaticContent({ value: null } as never);
    return staticDefsContent.value;
  }

  it("starts tower symbols directly with the theme frame content", () => {
    const defs = defsForTheme(buildCustomTheme());
    expect(defs).toContain('<symbol id="tower-basic-f0" viewBox="-16 -16 32 32"><rect/></symbol>');
    expect(defs).not.toMatch(/tower-[a-z]+-f\d+" viewBox="-16 -16 32 32"><ellipse/);
  });

  it("starts enemy symbols directly with the theme frame content", () => {
    const defs = defsForTheme(buildCustomTheme());
    expect(defs).toContain('<symbol id="enemy-minion-f0" viewBox="-1 -1 2 2"><rect/></symbol>');
    expect(defs).toContain('<symbol id="enemy-minion-hit-f0" viewBox="-1 -1 2 2"><path/></symbol>');
    expect(defs).not.toMatch(/enemy-[a-z]+-[a-z]*f\d+" viewBox="-1 -1 2 2"><ellipse/);
  });

  const GROUND_SHADOW_FILL = "#120e0c";

  function frameImages(
    record: { frames: { image: string }[] } | null | undefined,
    unit: string,
  ): { unit: string; frame: string }[] {
    return (record?.frames ?? []).map((entry) => ({ unit, frame: entry.image }));
  }

  it("ships no theme painting a ground shadow into a rotated sprite", () => {
    for (const [label, rawTheme] of [
      ["Polymath", defaultTheme],
      ["Aftermath", aftermathTheme],
      ["Chrithmath", chrithmathTheme],
    ] as const) {
      const theme = RawMapThemeSchema.parse(rawTheme);
      const frames = [
        ...Object.entries(theme.towers).flatMap(([towerId, tower]) => [
          ...frameImages(tower.animation, `${label} ${towerId} animation`),
          ...frameImages(tower.walking, `${label} ${towerId} walking`),
        ]),
        ...Object.entries(theme.enemies).flatMap(([enemyId, enemy]) => [
          ...frameImages(enemy.walking, `${label} ${enemyId} walking`),
          ...frameImages(enemy.hitReaction, `${label} ${enemyId} hitReaction`),
          ...frameImages(enemy.attack, `${label} ${enemyId} attack`),
        ]),
      ];
      expect(
        frames.filter((entry) => entry.frame.includes(GROUND_SHADOW_FILL)).map((entry) => entry.unit),
        `${label} bakes ${GROUND_SHADOW_FILL} into a sprite frame the renderer rotates`,
      ).toEqual([]);
    }
  });
});

describe("Tile variants", () => {
  const TERRAIN2_VARIANTS = ["#223322", "#334433", "#445544"];

  function buildVariantTheme(): MapThemeData {
    const theme = structuredClone(buildCustomTheme());
    const region = theme.regions[0]!;
    region.tiles.terrain2 = TERRAIN2_VARIANTS.map(
      (fill) => `<svg viewBox="0 0 36 36"><rect width="36" height="36" fill="${fill}"/></svg>`,
    );
    return theme;
  }

  function useVariantTheme(): void {
    const store = createTestMapThemeStore();
    const theme = buildVariantTheme();
    store.activeTheme = theme;
    store.defaultTheme = theme;
  }

  function terrainRowMap(width: number, height: number) {
    return {
      width,
      height,
      tiles: Array.from({ length: height }, () =>
        Array.from({ length: width }, () => ({ type: "terrain", height: 2 })),
      ),
      spawns: [],
      base: null,
      regionId: 0,
      seed: 1337,
    };
  }

  function referencedTileSymbols(svg: string): string[] {
    return [...svg.matchAll(/<use href="#(tile-r0-terrain2[^"]*)"/g)].map((match) => match[1]!);
  }

  it("emits one symbol per variant, keeping the unsuffixed id for variant 0", () => {
    useVariantTheme();
    const { mapDefsContent } = useSvgStaticContent({ value: terrainRowMap(4, 1) } as never);
    const defs = mapDefsContent.value;
    expect(defs).toContain('<symbol id="tile-r0-terrain2" viewBox="0 0 36 36">');
    expect(defs).toContain('<symbol id="tile-r0-terrain2-v1" viewBox="0 0 36 36">');
    expect(defs).toContain('<symbol id="tile-r0-terrain2-v2" viewBox="0 0 36 36">');
  });

  it("draws every variant of a multi-variant kind across a row of terrain", () => {
    useVariantTheme();
    const { gridContent } = useSvgStaticContent({ value: terrainRowMap(12, 1) } as never);
    const referenced = new Set(referencedTileSymbols(gridContent.value));
    expect(referenced).toEqual(new Set(["tile-r0-terrain2", "tile-r0-terrain2-v1", "tile-r0-terrain2-v2"]));
  });

  it("picks the same variant for a tile across two builds of the same map", () => {
    useVariantTheme();
    const map = terrainRowMap(12, 1);
    const first = useSvgStaticContent({ value: map } as never).gridContent.value;
    const second = useSvgStaticContent({ value: structuredClone(map) } as never).gridContent.value;
    expect(referencedTileSymbols(second)).toEqual(referencedTileSymbols(first));
  });

  it("leaves a single-variant kind on its documented unsuffixed symbol id", () => {
    useVariantTheme();
    const { mapDefsContent } = useSvgStaticContent({ value: terrainRowMap(4, 1) } as never);
    const defs = mapDefsContent.value;
    // Only terrain2 has variants here, so terrain1 stays unsuffixed.
    expect(defs).toContain('<symbol id="tile-r0-terrain1" viewBox="0 0 36 36">');
    expect(defs).not.toContain("tile-r0-terrain1-v");
  });
});

describe("Map site art symbols", () => {
  function defsForTheme(theme: MapThemeData): string {
    const store = createTestMapThemeStore();
    store.activeTheme = theme;
    store.defaultTheme = theme;
    return useSvgStaticContent({ value: null } as never).staticDefsContent.value;
  }

  it("emits one symbol per building kind, cache state, and boss package", () => {
    const theme = structuredClone(buildCustomTheme());
    theme.sites = {
      buildings: {
        armory: "<svg viewBox='0 0 36 36'><rect/></svg>",
        magazine: "<svg viewBox='0 0 36 36'><rect/></svg>",
        beacon: "<svg viewBox='0 0 36 36'><rect/></svg>",
        foundry: "<svg viewBox='0 0 36 36'><rect/></svg>",
        clocktower: "<svg viewBox='0 0 36 36'><rect/></svg>",
        aviary: "<svg viewBox='0 0 36 36'><rect/></svg>",
      },
      caches: {
        sealed: "<svg viewBox='0 0 36 36'><rect/></svg>",
        unlocked: "<svg viewBox='0 0 36 36'><rect/></svg>",
        broken: "<svg viewBox='0 0 36 36'><rect/></svg>",
      },
      supplyDrop: "<svg viewBox='0 0 36 36'><rect/></svg>",
    };
    const defs = defsForTheme(theme);
    for (const kind of ["armory", "magazine", "beacon", "foundry", "clocktower", "aviary"]) {
      expect(defs).toContain(`<symbol id="site-building-${kind}" viewBox="0 0 36 36">`);
    }
    for (const state of ["sealed", "unlocked", "broken"]) {
      expect(defs).toContain(`<symbol id="site-cache-${state}" viewBox="0 0 36 36">`);
    }
    expect(defs).toContain('<symbol id="site-supply-drop" viewBox="0 0 36 36">');
  });

  it("emits nothing for a theme with no sites block", () => {
    const defs = defsForTheme(buildCustomTheme());
    expect(defs).not.toContain("site-building-");
    expect(defs).not.toContain("site-cache-");
    expect(defs).not.toContain("site-supply-drop");
  });
});

describe("hexChannels", () => {
  it("expands a 3-digit hex and parses a 6-digit hex", () => {
    expect(hexChannels("#abc")).toEqual([170, 187, 204]);
    expect(hexChannels("#427542")).toEqual([66, 117, 66]);
  });

  it("returns null for alpha forms and non-hex strings so callers can fall back", () => {
    expect(hexChannels("#abcd")).toBeNull();
    expect(hexChannels("#42754280")).toBeNull();
    expect(hexChannels("rgb(1,2,3)")).toBeNull();
    expect(hexChannels("")).toBeNull();
  });
});
