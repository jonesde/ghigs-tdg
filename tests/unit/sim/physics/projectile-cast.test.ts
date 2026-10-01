// @ts-nocheck
// Swept-shape projectile casts (continuous collision, no tunneling).

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXED_DT, PROJECTILE_HIT_SLOP } from "@/sim/Constants.js";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { makeParticleSystem } from "../../../helpers/mock-managers.js";
import { mockDefaultTheme } from "../../../helpers/mock-stores.js";

// Explicit sweep ball for these query tests. Gameplay hits use the glyph radius plus slop.
const BALL = 11;

describe("PhysicsWorld swept casts", () => {
  let grid: Grid;
  let pw: PhysicsWorld;
  beforeEach(() => {
    grid = new Grid(getMap(0));
    pw = new PhysicsWorld(grid);
  });
  afterEach(() => {
    pw.dispose();
  });

  function addAt(x: number, y: number): Enemy {
    const e = new Enemy("minion", 1, 0, grid, 1);
    e.x = x;
    e.y = y;
    e.centerX = x;
    e.centerY = y;
    pw.addEnemy(e);
    return e;
  }

  function addFlyerAt(x: number, y: number): Enemy {
    const e = new Enemy("flyer", 1, 0, grid, 1);
    e.x = x;
    e.y = y;
    e.centerX = x;
    e.centerY = y;
    pw.addEnemy(e);
    return e;
  }

  it("continuous cast catches an enemy a discrete check would tunnel past", () => {
    addAt(200, 200);
    pw.step();
    // Origin (100,200), dir +x, sweep covers 300px -> passes through (200,200).
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy.x).toBeCloseTo(200);
  });

  it("pierce returns multiple enemies along a line, closest-first", () => {
    addAt(150, 200);
    addAt(200, 200);
    addAt(250, 200);
    pw.step();
    const hits: number[] = [];
    pw.castShapePierce(100, 200, 1, 0, BALL, 300, 3, (e) => {
      hits.push(e.x);
      return true;
    });
    expect(hits).toEqual([150, 200, 250]);
  });

  it("ignores towers/walls and returns only enemies (Risk 3)", () => {
    // Only a tower on the line: no enemy -> must be ignored (null).
    pw.rebuildTowers({ towers: [{ tileX: 0, tileY: 0, isGhost: false, x: 150, y: 200 }] });
    pw.step();
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300)).toBeNull();

    // An enemy behind the tower: cast must return it (tower excluded).
    const e = addAt(200, 200);
    pw.step();
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy).toBe(e);
    // Excluding the enemy's collider leaves only the ignored tower -> null.
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, BALL, 300, hit!.collider)).toBeNull();
  });

  it("ground-only casts pass over a flyer without consuming a pierce slot", () => {
    addFlyerAt(150, 200);
    const ground = addAt(250, 200);
    pw.step();
    const hits: number[] = [];
    pw.castShapePierce(
      100,
      200,
      1,
      0,
      BALL,
      300,
      1,
      (enemy) => {
        hits.push(enemy.id);
        return true;
      },
      true,
    );
    expect(hits).toEqual([ground.id]);
  });

  it("casts without ground-only still hit the flyer first", () => {
    const flyer = addFlyerAt(150, 200);
    addAt(250, 200);
    pw.step();
    const hits: number[] = [];
    pw.castShapePierce(100, 200, 1, 0, BALL, 300, 1, (enemy) => {
      hits.push(enemy.id);
      return false;
    });
    expect(hits).toEqual([flyer.id]);
  });
});

describe("EnemyManager cast delegate", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let pw: PhysicsWorld;
  let particles: ReturnType<typeof makeParticleSystem>;
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    grid = new Grid(makeBastionMap());
    particles = makeParticleSystem();
    manager = new EnemyManager(grid, particles, 0);
    pw = new PhysicsWorld(grid);
    manager.setPhysicsWorld(pw);
  });

  it("castShapePierce delegates to the physics world", () => {
    const e1 = manager.spawn("minion", 1, 0, 1)!;
    const e2 = manager.spawn("minion", 1, 0, 1)!;
    for (const [e, x] of [
      [e1, 150],
      [e2, 200],
    ] as const) {
      e.x = x;
      e.y = 200;
      e.centerX = x;
      e.centerY = 200;
      e.body?.setTranslation({ x, y: 200 }, true);
    }
    pw.step();
    const hits: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, BALL, 300, 3, (en) => {
      hits.push(en.x);
      return true;
    });
    expect(hits).toHaveLength(2);
  });

  it("fallback casts without a physics world skip flyers for ground-only casts", () => {
    const fallbackManager = new EnemyManager(grid, particles, 0);
    const ground = fallbackManager.spawn("minion", 1, 0, 1)!;
    const flyer = fallbackManager.spawn("flyer", 1, 0, 1)!;
    for (const [enemy, x] of [
      [flyer, 150],
      [ground, 250],
    ] as const) {
      enemy.x = x;
      enemy.y = 200;
      enemy.centerX = x;
      enemy.centerY = 200;
    }
    const hits: number[] = [];
    fallbackManager.castShapePierce(
      100,
      200,
      1,
      0,
      BALL,
      300,
      1,
      (enemy) => {
        hits.push(enemy.id);
        return true;
      },
      true,
    );
    expect(hits).toEqual([ground.id]);
  });
});

describe("projectile hit radius", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let enemyManager: EnemyManager;
  let projectileManager: ProjectileManager;

  beforeEach(() => {
    grid = new Grid(getMap(0));
    physicsWorld = new PhysicsWorld(grid);
    enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
    enemyManager.setPhysicsWorld(physicsWorld);
    projectileManager = new ProjectileManager(enemyManager, makeParticleSystem(), null, grid);
    projectileManager.setPhysicsWorld(physicsWorld);
  });

  afterEach(() => {
    enemyManager.clear();
    physicsWorld.dispose();
  });

  function placeMinion(x: number, y: number) {
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    enemy.x = x;
    enemy.y = y;
    enemy.centerX = x;
    enemy.centerY = y;
    enemy.body?.setTranslation({ x, y }, true);
    physicsWorld.step();
    physicsWorld.getContactProcessor().drainProjectileHits();
    const settled = enemy.body.translation();
    enemy.x = settled.x;
    enemy.y = settled.y;
    return enemy;
  }

  function tickToward(enemy, startX: number) {
    const hpBefore = enemy.hp;
    projectileManager.spawn({
      x: startX,
      y: enemy.y,
      damage: 1,
      speed: 60,
      range: 30,
      towerType: "basic",
      towerLevel: 1,
      targetId: enemy.id,
      critChance: 0,
    });
    projectileManager.prePhysics(FIXED_DT);
    const projectileId = projectileManager.getRenderData()[0].id;
    const sensorRadius = physicsWorld.projectileSensorRadius(projectileId);
    physicsWorld.step();
    const contactHits = physicsWorld.getContactProcessor().drainProjectileHits();
    projectileManager.postPhysics(FIXED_DT, contactHits);
    return { hpBefore, sensorRadius, renderData: projectileManager.getRenderData() };
  }

  it("sensor is the glyph plus slop, and one step hits a minion on that reach", () => {
    const enemy = placeMinion(200, 200);
    const moveDist = 60 * FIXED_DT;
    const reach = 3 + PROJECTILE_HIT_SLOP + enemy.radius + moveDist;
    const result = tickToward(enemy, enemy.x - (reach - 0.5));
    expect(result.sensorRadius).toBeCloseTo(3 + PROJECTILE_HIT_SLOP);
    expect(enemy.hp).toBeLessThan(result.hpBefore);
    expect(result.renderData).toHaveLength(1);
    expect(result.renderData[0].x).toBeCloseTo(enemy.x - enemy.radius, 0);
    projectileManager.prePhysics(FIXED_DT);
    expect(projectileManager.getRenderData()).toHaveLength(0);
  });

  it("misses a minion a boss-radius farther than that step", () => {
    const enemy = placeMinion(200, 200);
    const moveDist = 60 * FIXED_DT;
    const bossRadius = 0.33 * grid.tileSize * 0.5;
    const reach = 3 + PROJECTILE_HIT_SLOP + enemy.radius + moveDist;
    const result = tickToward(enemy, enemy.x - (reach + bossRadius));
    expect(result.sensorRadius).toBeCloseTo(3 + PROJECTILE_HIT_SLOP);
    expect(enemy.hp).toBe(result.hpBefore);
    expect(result.renderData).toHaveLength(1);
  });
});
