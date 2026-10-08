/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { type SiteHoverSites, siteHoverAt, siteHoverAtTile, siteHoverText } from "@/render/svg/siteHover.js";
import type { BonusOffer } from "@/sim/runBonuses.js";
import type { MapBuildingSnapshot, MapCacheSnapshot, SupplyDropSnapshot } from "@/sim/SimulationSnapshot.js";

const TILE_SIZE = 36;
const offer: BonusOffer = ["sharpened", "smallPurse", "largePurse"];

function makeDrop(
  id: number,
  worldX: number,
  worldY: number,
  fields: Partial<SupplyDropSnapshot> = {},
): SupplyDropSnapshot {
  return { id, tileX: 0, tileY: 0, worldX, worldY, offer: offer, ...fields };
}

function makeCache(
  id: number,
  worldX: number,
  worldY: number,
  fields: Partial<MapCacheSnapshot> = {},
): MapCacheSnapshot {
  return { id, tileX: 1, tileY: 1, worldX, worldY, hp: 60, maxHp: 60, offer: offer, unlocked: false, ...fields };
}

function makeBuilding(
  id: number,
  worldX: number,
  worldY: number,
  fields: Partial<MapBuildingSnapshot> = {},
): MapBuildingSnapshot {
  return { id, kind: "armory", tileX: 2, tileY: 2, worldX, worldY, active: true, ...fields };
}

function sitesOf(sites: Partial<SiteHoverSites>): SiteHoverSites {
  return { drops: [], caches: [], buildings: [], ...sites };
}

describe("site hover hit test", () => {
  it("returns nothing when the pointer is off every site", () => {
    const sites = sitesOf({ drops: [makeDrop(1, 100, 100)] });
    expect(siteHoverAt(sites, TILE_SIZE, 140, 140)).toBeNull();
    expect(siteHoverAt(sitesOf({}), TILE_SIZE, 100, 100)).toBeNull();
  });

  it("uses the package click radius for drops and caches", () => {
    const sites = sitesOf({ drops: [makeDrop(1, 100, 100)], caches: [makeCache(2, 300, 300)] });
    // 0.75 tiles = 27 world units, matching the click test the engine uses.
    expect(siteHoverAt(sites, TILE_SIZE, 126, 100)).toEqual({ kind: "drop", id: 1 });
    expect(siteHoverAt(sites, TILE_SIZE, 128, 100)).toBeNull();
    expect(siteHoverAt(sites, TILE_SIZE, 300, 320)).toEqual({ kind: "cache", id: 2 });
  });

  it("hits a building glyph box and stops at its edge", () => {
    const sites = sitesOf({ buildings: [makeBuilding(4, 200, 200)] });
    expect(siteHoverAt(sites, TILE_SIZE, 208, 192)).toEqual({ kind: "building", id: 4 });
    // The glyph box is 26 world units wide, so the hover half is 14 with grace.
    expect(siteHoverAt(sites, TILE_SIZE, 214, 200)).toEqual({ kind: "building", id: 4 });
    expect(siteHoverAt(sites, TILE_SIZE, 215, 200)).toBeNull();
  });

  it("gives a package under the pointer priority over the building behind it", () => {
    const sites = sitesOf({ drops: [makeDrop(1, 205, 200)], buildings: [makeBuilding(4, 200, 200)] });
    expect(siteHoverAt(sites, TILE_SIZE, 205, 200)).toEqual({ kind: "drop", id: 1 });
  });
});

describe("site hover at a tile", () => {
  it("returns the building, cache, or drop sitting on the tile", () => {
    expect(siteHoverAtTile(sitesOf({ buildings: [makeBuilding(4, 200, 200)] }), 2, 2)).toEqual({
      kind: "building",
      id: 4,
    });
    expect(siteHoverAtTile(sitesOf({ caches: [makeCache(2, 200, 200)] }), 1, 1)).toEqual({ kind: "cache", id: 2 });
    expect(siteHoverAtTile(sitesOf({ drops: [makeDrop(1, 200, 200, { tileX: 3, tileY: 4 })] }), 3, 4)).toEqual({
      kind: "drop",
      id: 1,
    });
  });

  it("returns nothing when the tile holds no site", () => {
    const sites = sitesOf({
      buildings: [makeBuilding(4, 200, 200)],
      caches: [makeCache(2, 300, 300)],
      drops: [makeDrop(1, 100, 100, { tileX: 3, tileY: 4 })],
    });
    expect(siteHoverAtTile(sites, 5, 5)).toBeNull();
    expect(siteHoverAtTile(sitesOf({}), 5, 5)).toBeNull();
  });
});

describe("site hover copy", () => {
  it("describes a boss package", () => {
    const sites = sitesOf({ drops: [makeDrop(1, 100, 100)] });
    const text = siteHoverText({ kind: "drop", id: 1 }, sites, 0);
    expect(text?.title).toBe("Boss package");
    expect(text?.lines.join(" ")).toContain("one of three bonus cards");
  });

  it("prices a locked cache and switches copy as it unlocks or breaks", () => {
    const sites = sitesOf({ caches: [makeCache(2, 100, 100)] });
    const locked = siteHoverText({ kind: "cache", id: 2 }, sites, 3);
    expect(locked?.title).toBe("Cache 60/60");
    expect(locked?.lines[0]).toBe("Unlock for 60 gold");

    const cache = sites.caches[0]!;
    cache.unlocked = true;
    expect(siteHoverText({ kind: "cache", id: 2 }, sites, 3)?.lines[0]).toBe("Fee already paid.");

    cache.hp = 0;
    const broken = siteHoverText({ kind: "cache", id: 2 }, sites, 3);
    expect(broken?.title).toBe("Cache — broken open");
    expect(broken?.lines[0]).toContain("free");
  });

  it("names the building and both halves of its buff, plus the unpowered state", () => {
    const powered = sitesOf({ buildings: [makeBuilding(4, 100, 100)] });
    const text = siteHoverText({ kind: "building", id: 4 }, powered, 0);
    expect(text?.title).toBe("Armory");
    expect(text?.lines).toEqual(["Adjacent towers deal ×1.20 damage.", "×1.10 damage to every tower while active."]);

    const unpowered = sitesOf({ buildings: [makeBuilding(4, 100, 100, { active: false })] });
    const dim = siteHoverText({ kind: "building", id: 4 }, unpowered, 0);
    expect(dim?.lines).toEqual([
      "Adjacent towers deal ×1.20 damage.",
      "×1.10 damage to every tower while active.",
      "Inactive — no tower beside it.",
    ]);
  });

  it("states only the powered half for a tethered kind", () => {
    const sites = sitesOf({ buildings: [makeBuilding(5, 100, 100, { kind: "foundry" })] });
    const text = siteHoverText({ kind: "building", id: 5 }, sites, 0);
    expect(text?.title).toBe("Foundry");
    expect(text?.lines).toEqual(["Every active building adds ×1.01 damage to all towers while a Foundry is active."]);

    const inactive = sitesOf({ buildings: [makeBuilding(5, 100, 100, { kind: "foundry", active: false })] });
    expect(siteHoverText({ kind: "building", id: 5 }, inactive, 0)?.lines).toEqual([
      "Every active building adds ×1.01 damage to all towers while a Foundry is active.",
      "Inactive — no tower beside it.",
    ]);
  });

  it("returns nothing for a site consumed since the pointer arrived", () => {
    expect(siteHoverText({ kind: "drop", id: 9 }, sitesOf({}), 0)).toBeNull();
    expect(siteHoverText({ kind: "cache", id: 9 }, sitesOf({}), 0)).toBeNull();
    expect(siteHoverText({ kind: "building", id: 9 }, sitesOf({}), 0)).toBeNull();
  });
});
