import { describe, expect, it } from "vitest";
import { RawMapThemeSchema } from "@/content/schemas/theme.js";
import { useSvgStaticContent } from "@/render/svg/useSvgStaticContent.js";
import defaultTheme from "@/render/themes/data/default-map-theme.json";
import aftermathTheme from "@/render/themes/data/the-aftermath.json";
import { DEFAULT_THEME_ID, MAP_THEME_MANIFEST, type MapThemeData } from "@/render/themes/index.js";
import { normalizeThemeImages } from "@/render/themes/normalize.js";
import { createTestMapThemeStore } from "../helpers/mock-stores";

describe("Map Theme System", () => {
  describe("Theme Manifest", () => {
    it("should have a default theme in the manifest", () => {
      const theme = MAP_THEME_MANIFEST.find((e) => e.id === DEFAULT_THEME_ID);
      expect(theme).toBeDefined();
      expect(theme!.id).toBe(DEFAULT_THEME_ID);
      expect(theme!.label).toBe("Polymath (Default)");
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

  it("exposes flyer, jet, and aegis on the Polymath theme", () => {
    const polymath = RawMapThemeSchema.parse(defaultTheme);
    expect(polymath.enemies.flyer).toMatchObject({ name: "Flyer", color: "#5ec8e8", shape: "diamond" });
    expect(polymath.enemies.jet).toMatchObject({ name: "Jet", color: "#ff7a3c", shape: "chevron" });
    expect(polymath.enemies.aegis).toMatchObject({ name: "Aegis", color: "#8ea2ff", shape: "kite" });
    for (const enemyId of ["flyer", "jet", "aegis"] as const) {
      const enemy = polymath.enemies[enemyId];
      expect(enemy?.walking.frames).toHaveLength(8);
      expect(enemy?.hitReaction?.frames).toHaveLength(3);
      expect(enemy?.attack?.frames).toHaveLength(3);
      expect(enemy?.attack?.duration).toBe(0.2);
    }
  });

  it("paints sprites without document-scoped paint servers", () => {
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
      images.push(
        region.tiles.path,
        region.tiles.terrain1,
        region.tiles.terrain2,
        region.tiles.terrain3,
        region.tiles.terrain4,
      );
      images.push(region.base);
    }
    images.push(theme.spawns?.closed ?? "", theme.spawns?.open ?? "", theme.spawns?.transition ?? "");
    for (const image of images) {
      expect(image.includes("url(#")).toBe(false);
      expect(image.includes("<filter")).toBe(false);
    }
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
          path: makeTileSvg(pathColor, false),
          terrain1: makeTileSvg(terrainColors[0]!, true),
          terrain2: makeTileSvg(terrainColors[1]!, true),
          terrain3: makeTileSvg(terrainColors[2]!, true),
          terrain4: makeTileSvg(terrainColors[3]!, true),
        },
        base: regionBase,
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
    });
  });

  describe("Spawn placement", () => {
    it("renders spawn <use> elements with correct IDs and positions", () => {
      const store = createTestMapThemeStore();
      const customTheme = buildCustomTheme();
      store.activeTheme = customTheme;
      store.defaultTheme = customTheme;

      const mapRef = { value: makeMinimalMap(1, 1, 3) };
      const { gridContent } = useSvgStaticContent(mapRef as never);
      const svg = gridContent.value;

      expect(svg).toContain('<use id="spawn-0" href="#spawn-closed" x="0" y="0" width="36" height="36"/>');
      expect(svg).toContain('<use id="spawn-1" href="#spawn-closed" x="36" y="0" width="36" height="36"/>');
      expect(svg).toContain('<use id="spawn-2" href="#spawn-closed" x="72" y="0" width="36" height="36"/>');
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
