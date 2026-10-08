import { beforeEach, describe, expect, it } from "vitest";
import { HP_BAR_POOL_SIZE, SHIELD_BAR_POOL_SIZE, SVG_NS, TOWER_HP_BAR_POOL_SIZE } from "@/render/svg/types.js";
import { UiOverlayManager } from "@/render/svg/UiOverlayManager.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { buildTestTower, createTestEngine } from "../helpers/engine-snapshot.js";

function makeLayer(): SVGGElement {
  return document.createElementNS(SVG_NS, "g") as unknown as SVGGElement;
}

function towerSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    type: "basic",
    x: 100,
    y: 100,
    tileX: 1,
    tileY: 1,
    level: 1,
    variant: null,
    angle: 0,
    cooldown: 0,
    targeting: "first",
    totalInvested: 0,
    waveDamage: 0,
    totalDamageDealt: 0,
    fireAnimTime: 0,
    fixedAimDir: null,
    isGhost: false,
    health: 50,
    maxHealth: 100,
    color: "#fff",
    animation: null,
    base: { fixedAim: false },
    placedAt: 0,
    ...overrides,
  } as never;
}

// The tower HP bars are the last TOWER_HP_BAR_POOL_SIZE * 3 <rect> elements
// appended to the layer during init (enemy/shield/base bars precede them).
// Each tower group is [bg, border, fg]; return the fg rect of group `groupIndex`.
function towerBarFg(layer: SVGGElement, groupIndex: number): SVGRectElement {
  const rects = Array.from(layer.querySelectorAll("rect"));
  const block = rects.slice(rects.length - TOWER_HP_BAR_POOL_SIZE * 3);
  return block[groupIndex * 3 + 2]!;
}

function towerBarBg(layer: SVGGElement, groupIndex: number): SVGRectElement {
  const rects = Array.from(layer.querySelectorAll("rect"));
  const block = rects.slice(rects.length - TOWER_HP_BAR_POOL_SIZE * 3);
  return block[groupIndex * 3]!;
}

function enemySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: "runner",
    x: 100,
    y: 100,
    radius: 8,
    hp: 50,
    maxHp: 100,
    shield: 0,
    maxShield: 0,
    angle: 0,
    level: 1,
    removed: false,
    slowFactor: 1,
    slowTimer: 0,
    burnTimer: 0,
    gameSeconds: 0,
    hitAnimTime: 0,
    attackAnimTime: 0,
    isBoss: false,
    statusEffects: [],
    ...overrides,
  } as never;
}

// The enemy HP bars are the first HP_BAR_POOL_SIZE * 3 <rect> elements appended
// to the layer during init (shield/boss/pending/base/tower elements follow).
function enemyBarFg(layer: SVGGElement, groupIndex: number): SVGRectElement {
  const rects = Array.from(layer.querySelectorAll("rect"));
  return rects.slice(0, HP_BAR_POOL_SIZE * 3)[groupIndex * 3 + 2]!;
}

function enemyBarBg(layer: SVGGElement, groupIndex: number): SVGRectElement {
  const rects = Array.from(layer.querySelectorAll("rect"));
  return rects.slice(0, HP_BAR_POOL_SIZE * 3)[groupIndex * 3]!;
}

function shieldBarFg(layer: SVGGElement, groupIndex: number): SVGRectElement {
  const rects = Array.from(layer.querySelectorAll("rect"));
  return rects.slice(HP_BAR_POOL_SIZE * 3, HP_BAR_POOL_SIZE * 3 + SHIELD_BAR_POOL_SIZE)[groupIndex]!;
}

describe("UiOverlayManager tower health bars", () => {
  let manager: UiOverlayManager;
  let layer: SVGGElement;

  beforeEach(() => {
    layer = makeLayer();
    manager = new UiOverlayManager();
    manager.init(layer);
  });

  it("shows a bar above a damaged tower with width proportional to health", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 50, maxHealth: 100 })]);
    const fg = towerBarFg(layer, 0);
    expect(fg.style.visibility).toBe("visible");
    expect(fg.getAttribute("width")).toBe("14");
    expect(fg.getAttribute("transform")).toContain("86"); // x - 14
  });

  it("colors the bar yellow below 50% and red below 25%", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 30, maxHealth: 100 })]);
    expect(towerBarFg(layer, 0).getAttribute("fill")).toBe("#ffff00");
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 10, maxHealth: 100 })]);
    expect(towerBarFg(layer, 0).getAttribute("fill")).toBe("#ff0000");
  });

  it("shows a bar for a damaged tower serialized from a live engine", () => {
    const engine = createTestEngine();
    const tower = buildTestTower(engine);
    tower.health = tower.maxHealth * 0.5;
    const snapshot = buildSnapshot(engine, 0);
    manager.syncFromGameEngine(snapshot.enemies, null, snapshot.towers);
    const fg = towerBarFg(layer, 0);
    expect(fg.style.visibility).toBe("visible");
    expect(Number(fg.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(fg.getAttribute("width"))).toBeLessThan(28);
  });

  it("hides the bar for a full-health tower", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 100, maxHealth: 100 })]);
    expect(towerBarFg(layer, 0).style.visibility).toBe("hidden");
  });

  it("hides leftover bars when fewer towers are damaged", () => {
    manager.syncFromGameEngine([], null, [
      towerSnapshot({ id: "a", health: 50, maxHealth: 100 }),
      towerSnapshot({ id: "b", health: 40, maxHealth: 100 }),
    ]);
    // Now only one damaged tower remains; second bar group must hide.
    manager.syncFromGameEngine([], null, [towerSnapshot({ id: "a", health: 50, maxHealth: 100 })]);
    expect(towerBarBg(layer, 1).style.visibility).toBe("hidden");
  });

  it("shows medals above wave-top towers during the display window", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ id: "a", x: 100, y: 100 })]);
    manager.syncWaveTopTowers(
      [towerSnapshot({ id: "a", x: 100, y: 100 })],
      [{ towerId: "a", rank: 1, damage: 40, simSeconds: 10 }],
      11,
    );
    const medals = Array.from(layer.querySelectorAll("text"));
    const visible = medals.filter((el) => el.style.visibility === "visible" && el.textContent === "🥇");
    expect(visible.length).toBe(1);
    manager.syncWaveTopTowers(
      [towerSnapshot({ id: "a", x: 100, y: 100 })],
      [{ towerId: "a", rank: 1, damage: 40, simSeconds: 10 }],
      14,
    );
    expect(visible[0]!.style.visibility).toBe("hidden");
  });

  it("removes bar elements on dispose", () => {
    manager.syncFromGameEngine([], null, [towerSnapshot({ health: 50, maxHealth: 100 })]);
    const fg = towerBarFg(layer, 0);
    expect(layer.contains(fg)).toBe(true);
    manager.dispose();
    expect(layer.contains(fg)).toBe(false);
  });
});

describe("UiOverlayManager enemy health bars", () => {
  let manager: UiOverlayManager;
  let layer: SVGGElement;

  beforeEach(() => {
    layer = makeLayer();
    manager = new UiOverlayManager();
    manager.init(layer);
  });

  it("shows a bar above a damaged enemy with width proportional to hp", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 50, maxHp: 100 })], null);
    const fg = enemyBarFg(layer, 0);
    expect(fg.style.visibility).toBe("visible");
    expect(fg.getAttribute("width")).toBe("12");
    expect(fg.getAttribute("transform")).toContain("88"); // x - 12
  });

  it("colors the bar yellow below 50% and red below 25%", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 30, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).getAttribute("fill")).toBe("#ffff00");
    manager.syncFromGameEngine([enemySnapshot({ hp: 10, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).getAttribute("fill")).toBe("#ff0000");
  });

  it("hides the bar for a full-hp enemy", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 100, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("hidden");
    expect(enemyBarBg(layer, 0).style.visibility).toBe("hidden");
  });

  it("hides the bar once an enemy heals back to full hp", () => {
    manager.syncFromGameEngine([enemySnapshot({ id: 1, hp: 50, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("visible");
    manager.syncFromGameEngine([enemySnapshot({ id: 1, hp: 100, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("hidden");
  });

  it("draws the health fill behind the shield in the same bar row", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 100, maxHp: 100, shield: 25, maxShield: 50 })], null);
    const healthFg = enemyBarFg(layer, 0);
    const shieldFg = shieldBarFg(layer, 0);
    // Full health is normally barless, but the shield bar needs something to drain onto.
    expect(healthFg.style.visibility).toBe("visible");
    expect(healthFg.getAttribute("width")).toBe("24");
    expect(healthFg.getAttribute("fill")).toBe("#00ff00");
    expect(shieldFg.style.visibility).toBe("visible");
    expect(shieldFg.getAttribute("width")).toBe("12");
    // One row: both rects share the health bar's transform.
    expect(healthFg.getAttribute("transform")).toBe("translate(88, 88)");
    expect(shieldFg.getAttribute("transform")).toBe("translate(88, 88)");
  });

  it("leaves the health fill standing when the shield breaks", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 40, maxHp: 100, shield: 25, maxShield: 50 })], null);
    expect(shieldBarFg(layer, 0).getAttribute("width")).toBe("12");
    manager.syncFromGameEngine([enemySnapshot({ hp: 40, maxHp: 100, shield: 0, maxShield: 50 })], null);
    expect(shieldBarFg(layer, 0).style.visibility).toBe("hidden");
    const healthFg = enemyBarFg(layer, 0);
    expect(healthFg.style.visibility).toBe("visible");
    expect(Number(healthFg.getAttribute("width"))).toBeCloseTo(9.6);
    expect(healthFg.getAttribute("fill")).toBe("#ffff00");
    expect(healthFg.getAttribute("transform")).toBe("translate(88, 88)");
  });

  it("hides the health fill again at full hp once the shield is gone", () => {
    manager.syncFromGameEngine([enemySnapshot({ hp: 100, maxHp: 100, shield: 25, maxShield: 50 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("visible");
    manager.syncFromGameEngine([enemySnapshot({ hp: 100, maxHp: 100, shield: 0, maxShield: 50 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("hidden");
    expect(enemyBarBg(layer, 0).style.visibility).toBe("hidden");
    expect(shieldBarFg(layer, 0).style.visibility).toBe("hidden");
  });

  it("shows a boss hp bar only while the boss is damaged", () => {
    manager.syncFromGameEngine([enemySnapshot({ id: 1, type: "boss", hp: 100, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("hidden");
    manager.syncFromGameEngine([enemySnapshot({ id: 1, type: "boss", hp: 60, maxHp: 100 })], null);
    expect(enemyBarFg(layer, 0).style.visibility).toBe("visible");
    expect(Number(enemyBarFg(layer, 0).getAttribute("width"))).toBeCloseTo(14.4);
  });

  it("hides leftover bars when the damaged enemy count drops", () => {
    manager.syncFromGameEngine(
      [enemySnapshot({ id: 1, hp: 50, maxHp: 100 }), enemySnapshot({ id: 2, hp: 40, maxHp: 100 })],
      null,
    );
    expect(enemyBarFg(layer, 1).style.visibility).toBe("visible");
    // Second enemy now at full hp: only the first bar stays up.
    manager.syncFromGameEngine(
      [enemySnapshot({ id: 1, hp: 50, maxHp: 100 }), enemySnapshot({ id: 2, hp: 100, maxHp: 100 })],
      null,
    );
    expect(enemyBarFg(layer, 1).style.visibility).toBe("hidden");
  });
});

describe("UiOverlayManager base health bar", () => {
  let manager: UiOverlayManager;
  let layer: SVGGElement;

  const fakeGrid = {
    tileSize: 36,
    getBase: () => ({ x: 2, y: 3 }),
    tileToWorld: (tileX: number, tileY: number) => ({ x: tileX * 36 + 18, y: tileY * 36 + 18 }),
  } as never;

  // The base bar is the single [bg, border, fg] group between the pending-queue
  // texts and the tower bars.
  function baseBarRects(): SVGRectElement[] {
    const rects = Array.from(layer.querySelectorAll("rect"));
    const enemyBlock = HP_BAR_POOL_SIZE * 3;
    const shieldBlock = SHIELD_BAR_POOL_SIZE;
    const baseBlock = rects.slice(enemyBlock + shieldBlock, enemyBlock + shieldBlock + 3);
    expect(baseBlock.length).toBe(3);
    return baseBlock as SVGRectElement[];
  }

  beforeEach(() => {
    layer = makeLayer();
    manager = new UiOverlayManager();
    manager.init(layer);
  });

  it("renders a half-height bar just inside the top of the 3x3 base block", () => {
    manager.syncBaseHealthBar(fakeGrid, 80, 100);
    const [bg, , fg] = baseBarRects();
    // Base center is (90, 126); the 3x3 top edge sits at 126 - 54 = 72.
    expect(bg!.getAttribute("height")).toBe("5");
    expect(fg!.getAttribute("height")).toBe("5");
    expect(bg!.getAttribute("transform")).toBe("translate(36, 76)");
    expect(bg!.style.visibility).toBe("visible");
    expect(fg!.getAttribute("width")).toBe("86.4");
  });

  it("colors the bar green/yellow/red by health ratio", () => {
    manager.syncBaseHealthBar(fakeGrid, 80, 100);
    expect(baseBarRects()[2]!.getAttribute("fill")).toBe("#5ec46a");
    manager.syncBaseHealthBar(fakeGrid, 30, 100);
    expect(baseBarRects()[2]!.getAttribute("fill")).toBe("#ffd84d");
    manager.syncBaseHealthBar(fakeGrid, 10, 100);
    expect(baseBarRects()[2]!.getAttribute("fill")).toBe("#e05548");
  });
});
