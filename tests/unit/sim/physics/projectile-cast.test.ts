// @ts-nocheck
// Swept-shape projectile casts (continuous collision, no tunneling).

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { ProjectileManager, projectileHitSlop } from "@/sim/ProjectileManager.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { makeParticleSystem } from "../../../helpers/mock-managers.js";
import { mockDefaultTheme } from "../../../helpers/mock-stores.js";

// Explicit sweep ball for these query tests. Gameplay hits use the glyph radius plus slop.
const ball = 11;

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
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, ball, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy.x).toBeCloseTo(200);
  });

  it("pierce returns multiple enemies along a line, closest-first", () => {
    addAt(150, 200);
    addAt(200, 200);
    addAt(250, 200);
    pw.step();
    const hits: number[] = [];
    pw.castShapePierce(100, 200, 1, 0, ball, 300, 3, (e) => {
      hits.push(e.x);
      return true;
    });
    expect(hits).toEqual([150, 200, 250]);
  });

  it("ignores towers/walls and returns only enemies (Risk 3)", () => {
    // Only a tower on the line: no enemy -> must be ignored (null).
    pw.rebuildTowers({ towers: [{ tileX: 0, tileY: 0, isGhost: false, x: 150, y: 200 }] });
    pw.step();
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, ball, 300)).toBeNull();

    // An enemy behind the tower: cast must return it (tower excluded).
    const e = addAt(200, 200);
    pw.step();
    const hit = pw.castShapeFirstEnemy(100, 200, 1, 0, ball, 300);
    expect(hit).not.toBeNull();
    expect(hit!.enemy).toBe(e);
    // Excluding the enemy's collider leaves only the ignored tower -> null.
    expect(pw.castShapeFirstEnemy(100, 200, 1, 0, ball, 300, hit!.collider)).toBeNull();
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
      ball,
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
    pw.castShapePierce(100, 200, 1, 0, ball, 300, 1, (enemy) => {
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

  it("orders segment hits near to far and keeps the nearer enemy for one hit", () => {
    const farther = manager.spawn("minion", 1, 0, 1)!;
    const nearer = manager.spawn("minion", 1, 0, 1)!;
    for (const [enemy, x] of [
      [farther, 250],
      [nearer, 150],
    ] as const) {
      enemy.x = x;
      enemy.y = 200;
      enemy.centerX = x;
      enemy.centerY = 200;
    }
    const oneHit: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, ball, 300, 1, (enemy) => {
      oneHit.push(enemy.x);
      return true;
    });
    expect(oneHit).toEqual([150]);

    const pierced: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, ball, 300, 3, (enemy) => {
      pierced.push(enemy.x);
      return true;
    });
    expect(pierced).toEqual([150, 250]);

    const stopped: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, ball, 300, 3, (enemy) => {
      stopped.push(enemy.x);
      return false;
    });
    expect(stopped).toEqual([150]);

    nearer.y = 10000;
    farther.y = 10000;
    const tiedFirst = manager.spawn("minion", 1, 0, 1)!;
    const tiedSecond = manager.spawn("runner", 1, 0, 1)!;
    for (const enemy of [tiedFirst, tiedSecond]) {
      enemy.x = 180;
      enemy.y = 200;
      enemy.centerX = 180;
      enemy.centerY = 200;
    }
    const tied: number[] = [];
    manager.castShapePierce(100, 200, 1, 0, ball, 300, 1, (enemy) => {
      tied.push(enemy.id);
      return true;
    });
    expect(tied).toEqual([tiedFirst.id]);
  });

  it("ground-only segment skips a flyer without spending the one hit", () => {
    const ground = manager.spawn("minion", 1, 0, 1)!;
    const flyer = manager.spawn("flyer", 1, 0, 1)!;
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
    manager.castShapePierce(
      100,
      200,
      1,
      0,
      ball,
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
      ball,
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
    projectileManager.prePhysics(fixedDeltaSeconds);
    physicsWorld.step();
    const contactHits = physicsWorld.getContactProcessor().drainProjectileHits();
    projectileManager.postPhysics(fixedDeltaSeconds, contactHits);
    return { hpBefore, renderData: projectileManager.getRenderData() };
  }

  it("one step hits a minion on the glyph-plus-slop reach", () => {
    const enemy = placeMinion(200, 200);
    const moveDist = 60 * fixedDeltaSeconds;
    const reach = 3 + projectileHitSlop + enemy.radius + moveDist;
    const result = tickToward(enemy, enemy.x - (reach - 0.5));
    expect(enemy.hp).toBeLessThan(result.hpBefore);
    expect(result.renderData).toHaveLength(1);
    expect(result.renderData[0].x).toBeCloseTo(enemy.x - enemy.radius, 0);
    projectileManager.prePhysics(fixedDeltaSeconds);
    expect(projectileManager.getRenderData()).toHaveLength(0);
  });

  it("misses a minion a boss-radius farther than that step", () => {
    const enemy = placeMinion(200, 200);
    const moveDist = 60 * fixedDeltaSeconds;
    const bossRadius = 0.33 * grid.tileSize * 0.5;
    const reach = 3 + projectileHitSlop + enemy.radius + moveDist;
    const result = tickToward(enemy, enemy.x - (reach + bossRadius));
    expect(enemy.hp).toBe(result.hpBefore);
    expect(result.renderData).toHaveLength(1);
  });
});

describe("one coarse sweep matches eight fine sweeps", () => {
  function damagedMarks(stepSeconds: number[]): string[] {
    const grid = new Grid(getMap(0));
    const physicsWorld = new PhysicsWorld(grid);
    const enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
    enemyManager.setPhysicsWorld(physicsWorld);
    const projectileManager = new ProjectileManager(enemyManager, makeParticleSystem(), null, grid);
    projectileManager.setPhysicsWorld(physicsWorld);

    const place = (type: string, x: number, y: number) => {
      const enemy = enemyManager.spawn(type, 1, 0, 1)!;
      enemy.x = x;
      enemy.y = y;
      enemy.centerX = x;
      enemy.centerY = y;
      enemy.body?.setTranslation({ x, y }, true);
      return enemy;
    };
    const first = place("minion", 160, 200);
    const second = place("minion", 200, 200);
    const flyer = place("flyer", 180, 200);
    // setTranslation does not update the query pipeline until a step. One step
    // publishes the held positions; these bodies have no velocity, so they stay.
    physicsWorld.step();
    for (const enemy of [first, second, flyer]) {
      const settled = enemy.body!.translation();
      enemy.x = settled.x;
      enemy.y = settled.y;
    }
    const startingHp = new Map([first, second, flyer].map((enemy) => [enemy.id, enemy.hp]));

    projectileManager.spawn({
      x: 100,
      y: 200,
      damage: 1,
      speed: 900,
      range: 30,
      towerType: "sniper",
      towerLevel: 5,
      variant: "B",
      pierce: 3,
      targetId: first.id,
      groundOnly: true,
      critChance: 0,
    });
    for (const dt of stepSeconds) projectileManager.update(dt);

    const marks = [first, second, flyer]
      .filter((enemy) => enemy.hp < (startingHp.get(enemy.id) ?? enemy.hp))
      .map((enemy) => `${enemy.type}@${enemy.x}`);
    enemyManager.clear();
    physicsWorld.dispose();
    return marks;
  }

  it("hits the same held-still enemies, including pierce, and skips the flyer", () => {
    const fineSteps = Array.from({ length: 8 }, () => fixedDeltaSeconds);
    const fine = damagedMarks(fineSteps);
    const coarse = damagedMarks([8 * fixedDeltaSeconds]);
    expect(coarse).toEqual(fine);
    expect(fine.filter((mark) => mark.startsWith("minion@"))).toHaveLength(2);
    expect(fine.some((mark) => mark.startsWith("flyer@"))).toBe(false);
  });
});
