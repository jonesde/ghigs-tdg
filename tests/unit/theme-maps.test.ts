// @ts-nocheck
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { resolveThemeMaps } from "@/content/themeMaps.js";
import defaultRaw from "@/render/themes/data/default-map-theme.json";
import aftermathRaw from "@/render/themes/data/the-aftermath.json";
import { getMap } from "@/sim/grid/Map.js";
import { progressiveConfigForIndex } from "@/sim/grid/ProgressiveMap.js";

describe("theme world maps", () => {
  it("leaves the default theme without a maps catalog (fallback path)", () => {
    expect(defaultRaw.maps).toBeUndefined();
    expect(resolveThemeMaps(null)).toBe(getGameContent().maps);
    expect(resolveThemeMaps(undefined)).toBe(getGameContent().maps);
  });

  it("resolves the aftermath override into a full catalog", () => {
    expect(aftermathRaw.maps).toBeDefined();
    const resolved = resolveThemeMaps(aftermathRaw.maps);
    expect(resolved.levels).toHaveLength(36);
    expect(resolved.progressive.variants).toHaveLength(12);
    expect(resolved.mapsPerRegion).toBe(12);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("gives the aftermath world distinct maps from the same catalog indexes", () => {
    const resolved = resolveThemeMaps(aftermathRaw.maps);
    const base = getGameContent().maps;
    const baseMap = getMap(0, base);
    const aftermathMap = getMap(0, resolved);
    expect(aftermathMap.seed).not.toBe(baseMap.seed);
    expect(aftermathMap.style).toBe(baseMap.style);
    expect(aftermathMap.width).toBe(baseMap.width);
    const baseConfig = progressiveConfigForIndex(36, base);
    const aftermathConfig = progressiveConfigForIndex(36, resolved);
    expect(aftermathConfig!.seed).not.toBe(baseConfig!.seed);
    expect(aftermathConfig!.regionId).toBe(baseConfig!.regionId);
  });

  it("keeps every aftermath seed distinct from every default seed", () => {
    const resolved = resolveThemeMaps(aftermathRaw.maps);
    const base = getGameContent().maps;
    const baseSeeds = new Set([
      ...base.levels.map((level) => level.seed),
      ...base.progressive.variants.map((v) => v.seed),
    ]);
    for (const level of resolved.levels) {
      expect(baseSeeds.has(level.seed)).toBe(false);
    }
    for (const variant of resolved.progressive.variants) {
      expect(baseSeeds.has(variant.seed)).toBe(false);
    }
  });

  it("rejects a partial progressive object (wholesale replace only)", () => {
    expect(() => resolveThemeMaps({ progressive: { blockSize: 5 } })).toThrow();
  });

  it("rejects a mapsPerRegion override", () => {
    const base = getGameContent().maps;
    expect(() => resolveThemeMaps({ mapsPerRegion: 10, levels: base.levels, progressive: base.progressive })).toThrow();
  });
});
