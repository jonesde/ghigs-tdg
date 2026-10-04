import { describe, expect, it } from "vitest";
import { MapSiteLayer, siteGlyphMarkup } from "@/render/svg/MapSiteLayer.js";
import type { SiteArtMeta } from "@/render/themes/index.js";
import { BUILDING_COLORS, BUILDING_ICONS, BUILDING_LABELS, CACHE_ICON } from "@/sim/mapSites.js";
import type { BonusOffer } from "@/sim/runBonuses.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import type { MapCacheSnapshot, SupplyDropSnapshot } from "@/sim/SimulationSnapshot.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { createTestEngine } from "../helpers/engine-snapshot.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function siteArt(): SiteArtMeta {
  return {
    buildings: {
      armory: '<svg viewBox="0 0 36 36"><rect id="art-armory"/></svg>',
      magazine: '<svg viewBox="0 0 36 36"><rect id="art-magazine"/></svg>',
      ward: '<svg viewBox="0 0 36 36"><rect id="art-ward"/></svg>',
      beacon: '<svg viewBox="0 0 36 36"><rect id="art-beacon"/></svg>',
    },
    caches: {
      sealed: '<svg viewBox="0 0 36 36"><rect id="art-sealed"/></svg>',
      unlocked: '<svg viewBox="0 0 36 36"><rect id="art-unlocked"/></svg>',
      broken: '<svg viewBox="0 0 36 36"><rect id="art-broken"/></svg>',
    },
    supplyDrop: '<svg viewBox="0 0 36 36"><rect id="art-drop"/></svg>',
  };
}

function makeLayer(siteArtMeta: SiteArtMeta | null = null): {
  layer: MapSiteLayer;
  readMarkup: () => string;
  writeCount: () => number;
} {
  const layer = new MapSiteLayer();
  const group = document.createElementNS(SVG_NS, "g");
  let markup = "";
  let writes = 0;
  Object.defineProperty(group, "innerHTML", {
    configurable: true,
    get: () => markup,
    set: (value: string) => {
      markup = value;
      writes++;
    },
  });
  layer.init(group, siteArtMeta);
  return { layer, readMarkup: () => markup, writeCount: () => writes };
}

function engineWithSites(): ReturnType<typeof createTestEngine> {
  const engine = createTestEngine();
  if (!engine.grid) throw new Error("no grid");
  const dropBoss = engine.enemyManager?.spawn("boss", 1, 0, 10);
  if (!dropBoss) throw new Error("no boss");
  engine.onEnemyKill(dropBoss);
  if (engine.supplyDrops.length === 0) throw new Error("no supply drop");
  if (engine.mapCaches.length === 0) throw new Error("no cache");
  if (engine.mapBuildings.length === 0) throw new Error("no building");
  return engine;
}

describe("map site layer", () => {
  it("builds site glyphs and boss rings once, and rewrites the layer only when they change", () => {
    const engine = engineWithSites();
    const auraBoss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!auraBoss) throw new Error("no boss");
    auraBoss.bossAbility = "speedAura";

    const { layer, readMarkup, writeCount } = makeLayer();
    const snapshot = buildSnapshot(engine, 0);
    layer.sync(snapshot);
    expect(writeCount()).toBe(1);
    const first = readMarkup();
    expect(first).toContain('aria-label="Boss package');
    expect(first).toContain('class="site-drop-pulse"');
    expect(first).toContain('aria-label="Cache ');
    expect(first).toContain(`unlock for ${cacheOpenGold(snapshot.meta.currentWave)} gold`);
    expect(first).toContain('stroke="#c98aff"');
    expect(first.indexOf('class="site-drop-pulse"')).toBeLessThan(first.indexOf('stroke="#c98aff"'));
    // Icon characters, so a cache and each building kind read without color.
    expect(first).toContain(`>${CACHE_ICON}</text>`);
    for (const building of snapshot.meta.mapBuildings ?? []) {
      expect(first).toContain(`aria-label="${BUILDING_LABELS[building.kind]}:`);
      expect(first).toContain(`>${BUILDING_ICONS[building.kind]}</text>`);
      expect(first).toContain(`fill="${BUILDING_COLORS[building.kind]}"`);
    }
    expect(first).not.toContain("<title>");

    layer.sync(buildSnapshot(engine, 1));
    expect(writeCount()).toBe(1);

    const changed = buildSnapshot(engine, 2);
    const cache = changed.meta.mapCaches?.[0];
    if (!cache) throw new Error("no cache");
    changed.meta.currentWave = 7;
    cache.hp = Math.max(1, cache.hp - 1);
    layer.sync(changed);
    expect(writeCount()).toBe(2);
    const updated = readMarkup();
    expect(updated).toContain(`unlock for ${cacheOpenGold(7)} gold`);
    expect(updated).toContain(`Cache ${Math.ceil(cache.hp)}/`);
    expect(updated).toContain('fill="#d0d0d0"');
    expect(updated).toContain('stroke="#c98aff"');

    // Unlocking without touching hp changes the label, so it has to rewrite too.
    cache.unlocked = true;
    layer.sync(changed);
    expect(writeCount()).toBe(3);
    expect(readMarkup()).toContain("Cache unlocked");

    layer.dispose();
    expect(readMarkup()).toBe("");
    expect(writeCount()).toBe(4);
  });

  it("draws theme site art as 26px symbol references instead of rects and icon text", () => {
    const engine = engineWithSites();
    const { layer, readMarkup } = makeLayer(siteArt());
    const snapshot = buildSnapshot(engine, 0);
    layer.sync(snapshot);
    const markup = readMarkup();

    const cache = snapshot.meta.mapCaches?.[0];
    if (!cache) throw new Error("no cache");
    expect(markup).toContain(
      `<use href="#site-cache-sealed" x="${cache.worldX - 13}" y="${cache.worldY - 13}" ` +
        `width="26" height="26" aria-label="Cache `,
    );
    for (const building of snapshot.meta.mapBuildings ?? []) {
      expect(markup).toContain(`<use href="#site-building-${building.kind}"`);
      expect(markup).toContain(`aria-label="${BUILDING_LABELS[building.kind]}:`);
    }
    expect(markup).toContain('<use href="#site-supply-drop"');
    // The pulse ring stays a stroked element of its own: its CSS animation
    // targets stroke paint, and it must survive the art swap.
    expect(markup).toContain('<polygon points="');
    expect(markup).toContain('class="site-drop-pulse"');
    expect(markup).not.toContain("</text>");
    for (const building of snapshot.meta.mapBuildings ?? []) {
      expect(markup).not.toContain(`fill="${BUILDING_COLORS[building.kind]}"`);
    }
  });

  it("swaps the cache symbol with the cache state", () => {
    const engine = engineWithSites();
    const { layer, readMarkup } = makeLayer(siteArt());
    const snapshot = buildSnapshot(engine, 0);
    const cache = snapshot.meta.mapCaches?.[0];
    if (!cache) throw new Error("no cache");
    layer.sync(snapshot);
    expect(readMarkup()).toContain("#site-cache-sealed");

    cache.unlocked = true;
    layer.sync(snapshot);
    expect(readMarkup()).toContain("#site-cache-unlocked");

    cache.hp = 0;
    layer.sync(snapshot);
    expect(readMarkup()).toContain("#site-cache-broken");
  });
});

describe("siteGlyphMarkup", () => {
  const offer: BonusOffer = ["smallPurse", "largePurse", "sharpened"];
  const drop: SupplyDropSnapshot = { id: 1, tileX: 2, tileY: 3, worldX: 90, worldY: 126, offer };
  const cache: MapCacheSnapshot = {
    id: 4,
    tileX: 1,
    tileY: 1,
    worldX: 54,
    worldY: 54,
    hp: 40,
    maxHp: 40,
    offer,
    unlocked: false,
  };
  const building = { id: 7, tileX: 5, tileY: 6, worldX: 198, worldY: 234, kind: "beacon" as const };

  it("renders the same markup with or without theme site art", () => {
    const withArt = siteGlyphMarkup([drop], [cache], [building], 3, siteArt());
    const withoutArt = siteGlyphMarkup([drop], [cache], [building], 3, null);

    expect(withArt).toContain('<use href="#site-supply-drop" x="77" y="113" width="26" height="26"');
    expect(withArt).toContain('<use href="#site-building-beacon" x="185" y="221"');
    expect(withoutArt).toContain("<polygon points=");
    expect(withoutArt).toContain(`>${CACHE_ICON}</text>`);
    expect(withoutArt).toContain(`>${BUILDING_ICONS.beacon}</text>`);
    for (const markup of [withArt, withoutArt]) {
      expect(markup).toContain('aria-label="Boss package');
      expect(markup).toContain('aria-label="Beacon: adjacent towers have');
      expect(markup).toContain("Cache 40/40");
    }
  });
});
