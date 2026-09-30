// Regression coverage for Block D2 animation shipping sparseness: the snapshot
// no longer carries per-enemy animation frame payloads, so the render manager
// must resolve walk/hit/attack frame timing by enemy.type from the active theme
// (or its default-theme visual fallback) while producing the exact same sprite
// ids and frame progression as before.
import { describe, expect, it } from "vitest";
import { EnemyManager } from "@/render/svg/EnemyManager.js";
import type { EnemyVisualMeta, MapThemeAnimation, MapThemeData } from "@/render/themes/index.js";
import type { EnemySnapshot } from "@/sim/SimulationSnapshot.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function animation(duration: number, frameCount: number): MapThemeAnimation {
  return {
    duration,
    referenceImages: Array.from({ length: frameCount }, (_, index) => ({ svg: `<svg>frame${index}</svg>` })),
  };
}

function enemyVisual(attack: MapThemeAnimation | null): EnemyVisualMeta {
  return {
    name: "Minion",
    color: "#e85a6a",
    shape: "circle",
    walking: animation(1, 4),
    hitReaction: animation(0.2, 2),
    attack,
  };
}

function makeTheme(attack: MapThemeAnimation | null): MapThemeData {
  return { id: "test", label: "Test", towers: {}, enemies: { minion: enemyVisual(attack) }, regions: [] };
}

function makeEnemy(overrides: Partial<EnemySnapshot>): EnemySnapshot {
  return {
    id: 1,
    type: "minion",
    x: 100,
    y: 100,
    radius: 8,
    hp: 100,
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
  };
}

function makeLayer(): SVGGElement {
  return document.createElementNS(SVG_NS, "g") as unknown as SVGGElement;
}

function firstEnemyHref(layer: SVGGElement): string {
  return layer.querySelector("use")!.getAttribute("href") ?? "";
}

describe("render EnemyManager animation resolution (Block D2)", () => {
  it("selects walk frames from the active theme's walking animation by type", () => {
    const layer = makeLayer();
    const manager = new EnemyManager(makeTheme(null));
    manager.init(layer);

    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 0.25 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-f1");

    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 0.5 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-f2");
  });

  it("selects hit-reaction frames while the hit animation is active", () => {
    const layer = makeLayer();
    const manager = new EnemyManager(makeTheme(animation(0.4, 3)));
    manager.init(layer);

    // elapsedInHit = 0.15s of a 0.2s / 2-frame hit animation → frame 1.
    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 1.0, hitAnimTime: 0.85 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-hit-f1");
  });

  it("selects attack frames when no hit reaction is active", () => {
    const layer = makeLayer();
    const manager = new EnemyManager(makeTheme(animation(0.4, 3)));
    manager.init(layer);

    // elapsedInAttack = 0.2s of a 0.4s / 3-frame attack animation → frame 1.
    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 0.9, attackAnimTime: 0.7 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-attack-f1");
  });

  it("prefers an active hit reaction over an active attack animation", () => {
    const layer = makeLayer();
    const manager = new EnemyManager(makeTheme(animation(0.4, 3)));
    manager.init(layer);

    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 1.0, hitAnimTime: 0.85, attackAnimTime: 0.95 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-hit-f1");
  });

  it("falls back to the default-enemy-visual chain when no active theme is supplied", () => {
    const layer = makeLayer();
    const manager = new EnemyManager(null, { minion: enemyVisual(null) });
    manager.init(layer);

    manager.syncFromGameEngine([makeEnemy({ gameSeconds: 0.25 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-minion-f1");
  });

  it("renders walk frame 0 when the theme has no walking animation for the type", () => {
    const layer = makeLayer();
    const theme = makeTheme(null);
    theme.enemies.unknown = {
      name: "Unknown",
      color: "#ffffff",
      shape: "circle",
      walking: animation(0, 1),
      hitReaction: null,
    };
    const manager = new EnemyManager(theme);
    manager.init(layer);

    manager.syncFromGameEngine([makeEnemy({ type: "unknown", gameSeconds: 0.5 })]);
    expect(firstEnemyHref(layer)).toBe("#enemy-unknown-f0");
  });
});
