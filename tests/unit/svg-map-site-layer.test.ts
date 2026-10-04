import { describe, expect, it } from "vitest";
import { MapSiteLayer } from "@/render/svg/MapSiteLayer.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { createTestEngine } from "../helpers/engine-snapshot.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeLayer(): { layer: MapSiteLayer; readMarkup: () => string; writeCount: () => number } {
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
  layer.init(group);
  return { layer, readMarkup: () => markup, writeCount: () => writes };
}

describe("map site layer", () => {
  it("builds site glyphs and boss rings once, and rewrites the layer only when they change", () => {
    const engine = createTestEngine();
    if (!engine.grid) throw new Error("no grid");
    const dropBoss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const auraBoss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!dropBoss || !auraBoss) throw new Error("no boss");
    auraBoss.bossAbility = "speedAura";
    engine.onEnemyKill(dropBoss);
    expect(engine.supplyDrops.length).toBeGreaterThan(0);
    expect(engine.mapCaches.length).toBeGreaterThan(0);
    expect(engine.mapBuildings.length).toBeGreaterThan(0);

    const { layer, readMarkup, writeCount } = makeLayer();
    const snapshot = buildSnapshot(engine, 0);
    layer.sync(snapshot);
    expect(writeCount()).toBe(1);
    const first = readMarkup();
    expect(first).toContain("<title>Supply drop</title>");
    expect(first).toContain("<title>Cache ");
    expect(first).toContain(`open for ${cacheOpenGold(snapshot.meta.currentWave)} gold`);
    expect(first).toContain('stroke="#c98aff"');
    expect(first.indexOf("<title>Supply drop</title>")).toBeLessThan(first.indexOf('stroke="#c98aff"'));

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
    expect(updated).toContain(`open for ${cacheOpenGold(7)} gold`);
    expect(updated).toContain(`Cache ${Math.ceil(cache.hp)}/`);
    expect(updated).toContain('fill="#d0d0d0"');
    expect(updated).toContain('stroke="#c98aff"');

    layer.dispose();
    expect(readMarkup()).toBe("");
    expect(writeCount()).toBe(3);
  });
});
