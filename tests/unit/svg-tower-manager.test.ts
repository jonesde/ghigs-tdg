// Pip tier coloring: level pips are colored by pip index, not by tower level.
// Pips 1-3 (levels 2-4) stay silver; pips 4-6 (levels 5-7) are gold, so adding
// the 4th pip no longer repaints the existing three.
import { describe, expect, it } from "vitest";
import { TowerManager } from "@/render/svg/TowerManager.js";
import type { TowerSnapshot } from "@/sim/SimulationSnapshot.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SILVER = "#c0c0c0";
const GOLD = "#ffd84d";

function makeTower(overrides: Partial<TowerSnapshot>): TowerSnapshot {
  return {
    id: "tower-1",
    type: "basic",
    x: 100,
    y: 100,
    tileX: 2,
    tileY: 3,
    level: 1,
    variant: "A",
    angle: 0,
    cooldown: 0,
    targeting: "default",
    totalInvested: 0,
    waveDamage: 0,
    totalDamageDealt: 0,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    health: 100,
    maxHealth: 100,
    color: "#c8c8c8",
    animation: null,
    base: { fixedAim: false },
    placedAt: 0,
    ...overrides,
  };
}

function makeLayer(): SVGGElement {
  return document.createElementNS(SVG_NS, "g") as unknown as SVGGElement;
}

function pipEls(layer: SVGGElement): SVGCircleElement[] {
  return Array.from(layer.querySelectorAll("circle"));
}

function pipFills(layer: SVGGElement): (string | null)[] {
  return pipEls(layer).map((pip) => pip.getAttribute("fill"));
}

function syncBase(manager: TowerManager, level: number, baseCenter: { x: number; y: number } | null): void {
  manager.syncBaseSentries(
    [],
    level,
    baseCenter,
    { animation: null, color: "#c8c8c8" },
    { animation: null, color: "#c8c8c8" },
    0,
  );
}

describe("render TowerManager level pips", () => {
  it("draws level - 1 pips for a tower", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 1 })], 0);
    expect(pipEls(layer)).toHaveLength(0);

    manager.syncFromGameEngine([makeTower({ level: 4 })], 0);
    expect(pipEls(layer)).toHaveLength(3);
  });

  it("keeps all pips silver through level 4", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 4 })], 0);
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER]);
  });

  it("adds a gold 4th pip at level 5 without repainting the first three", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 4 })], 0);
    const firstThree = pipEls(layer).slice(0, 3);

    manager.syncFromGameEngine([makeTower({ level: 5 })], 0);
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER, GOLD]);

    const pips = pipEls(layer);
    expect(pips.slice(0, 3)).toEqual(firstThree);
  });

  it("tiers pips 4-6 gold at level 7", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 7 })], 0);
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER, GOLD, GOLD, GOLD]);
  });

  it("reverts to silver pips on a downgrade to level 4", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 7 })], 0);
    manager.syncFromGameEngine([makeTower({ level: 4 })], 0);
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER]);
  });

  it("applies the same pip tiers to base defense pips", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    syncBase(manager, 4, { x: 50, y: 50 });
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER]);

    syncBase(manager, 7, { x: 50, y: 50 });
    expect(pipFills(layer)).toEqual([SILVER, SILVER, SILVER, GOLD, GOLD, GOLD]);
  });

  it("hides base defense pips when the base has no center", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    syncBase(manager, 7, { x: 50, y: 50 });
    syncBase(manager, 7, null);
    expect(pipEls(layer).every((pip) => pip.style.visibility === "hidden")).toBe(true);
  });

  it("removes every pip on dispose", () => {
    const layer = makeLayer();
    const manager = new TowerManager();
    manager.init(layer);

    manager.syncFromGameEngine([makeTower({ level: 7 })], 0);
    syncBase(manager, 7, { x: 50, y: 50 });
    manager.dispose();

    expect(pipEls(layer)).toHaveLength(0);
  });
});
