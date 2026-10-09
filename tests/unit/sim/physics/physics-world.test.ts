// @ts-nocheck
// Direct PhysicsWorld tests. We construct the world unconditionally.
// instead we construct the PhysicsWorld directly (which requires initPhysics() to
// have resolved) and drive enemies as bare Rapier bodies.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import { orderedPath } from "../../../helpers/navmesh-test-utils.js";

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Nearest path-tile world-center to a given point, plus that center.
function nearestPathCenter(grid, x, y) {
  let best = null;
  let bestDist = Infinity;
  const path = orderedPath(grid, 0)!;
  for (const tile of path) {
    const c = grid.tileToWorld(tile.x, tile.y);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { center: best, distance: bestDist };
}

describe("PhysicsWorld — lifecycle & containment (flag OFF, direct construction)", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;

  beforeAll(async () => {
    await initPhysics();
  });

  beforeEach(() => {
    grid = new Grid(getMap(0));
    physicsWorld = new PhysicsWorld(grid);
  });

  afterEach(() => {
    physicsWorld.dispose();
  });

  it("keeps two overlapping enemies separated (no enemy-enemy overlap)", () => {
    const tile = orderedPath(grid, 0)![5];
    const p = grid.tileToWorld(tile.x, tile.y);
    const e1 = new Enemy("minion", 1, 0, grid, 1);
    const e2 = new Enemy("minion", 1, 0, grid, 1);
    for (const e of [e1, e2]) {
      e.x = p.x;
      e.y = p.y;
      e.centerX = p.x;
      e.centerY = p.y;
    }
    physicsWorld.addEnemy(e1);
    physicsWorld.addEnemy(e2);

    for (let i = 0; i < 120; i++) physicsWorld.step();

    const d = dist(physicsWorld.getEnemyPosition(e1), physicsWorld.getEnemyPosition(e2));
    expect(d).toBeGreaterThanOrEqual(2 * e1.radius - 1e-2);
  });

  it("prevents base penetration even under a large driving velocity", () => {
    const baseTile = grid.getBase();
    const baseCenter = grid.tileToWorld(baseTile.x, baseTile.y);
    // Start at a path tile near the base and drive straight at the base center.
    const path = orderedPath(grid, 0)!;
    const startTile = path[Math.floor(path.length / 2)];
    const start = grid.tileToWorld(startTile.x, startTile.y);
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.x = start.x;
    enemy.y = start.y;
    enemy.centerX = start.x;
    enemy.centerY = start.y;
    physicsWorld.addEnemy(enemy);

    const SPEED = 400;
    for (let i = 0; i < 120; i++) {
      const pos = physicsWorld.getEnemyPosition(enemy);
      const dx = baseCenter.x - pos.x;
      const dy = baseCenter.y - pos.y;
      const len = Math.hypot(dx, dy) || 1;
      physicsWorld.setEnemyVelocity(enemy, (dx / len) * SPEED, (dy / len) * SPEED);
      physicsWorld.step();
    }

    const pos = physicsWorld.getEnemyPosition(enemy);
    const d = Math.hypot(pos.x - baseCenter.x, pos.y - baseCenter.y);
    expect(d).toBeGreaterThanOrEqual(1.5 * grid.tileSize - enemy.radius - 1e-2);
  });

  it("blocks enemies with a tower collider (no tower penetration)", () => {
    // Minimal tower-manager-like object: rebuildTowers only reads `.towers`,
    // each entry's tileX/tileY/isGhost/x/y.
    const towerTile = orderedPath(grid, 0)![5];
    const towerCenter = grid.tileToWorld(towerTile.x, towerTile.y);
    const fakeTowerManager = {
      towers: [{ tileX: towerTile.x, tileY: towerTile.y, isGhost: false, x: towerCenter.x, y: towerCenter.y }],
    };
    physicsWorld.rebuildTowers(fakeTowerManager);

    const enemyStartTile = orderedPath(grid, 0)![10];
    const start = grid.tileToWorld(enemyStartTile.x, enemyStartTile.y);
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.x = start.x;
    enemy.y = start.y;
    enemy.centerX = start.x;
    enemy.centerY = start.y;
    physicsWorld.addEnemy(enemy);

    const SPEED = 300;
    for (let i = 0; i < 200; i++) {
      const pos = physicsWorld.getEnemyPosition(enemy);
      const dx = towerCenter.x - pos.x;
      const dy = towerCenter.y - pos.y;
      const len = Math.hypot(dx, dy) || 1;
      physicsWorld.setEnemyVelocity(enemy, (dx / len) * SPEED, (dy / len) * SPEED);
      physicsWorld.step();
    }

    const pos = physicsWorld.getEnemyPosition(enemy);
    const d = Math.hypot(pos.x - towerCenter.x, pos.y - towerCenter.y);
    expect(d).toBeGreaterThanOrEqual(grid.tileSize / 2 - enemy.radius - 1e-2);
  });

  it("contains an enemy inside the corridor under lateral escape velocity", () => {
    const tile = orderedPath(grid, 0)![5];
    const center = grid.tileToWorld(tile.x, tile.y);
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.x = center.x;
    enemy.y = center.y;
    enemy.centerX = center.x;
    enemy.centerY = center.y;
    physicsWorld.addEnemy(enemy);

    // Push perpendicular to the local path tangent (away from the corridor).
    const nextTile = orderedPath(grid, 0)![6];
    const next = grid.tileToWorld(nextTile.x, nextTile.y);
    let tangentX = next.x - center.x;
    let tangentY = next.y - center.y;
    const tlen = Math.hypot(tangentX, tangentY) || 1;
    tangentX /= tlen;
    tangentY /= tlen;
    const pushX = -tangentY;
    const pushY = tangentX;

    const SPEED = 200;
    for (let i = 0; i < 120; i++) {
      physicsWorld.setEnemyVelocity(enemy, pushX * SPEED, pushY * SPEED);
      physicsWorld.step();
      // If the enemy somehow drifted onto the corridor centerline, nudge it back out.
      const pos = physicsWorld.getEnemyPosition(enemy);
      const cur = grid.tileToWorld(tile.x, tile.y);
      const dx = pos.x - cur.x;
      const dy = pos.y - cur.y;
      if (Math.hypot(dx, dy) < 1e-3) {
        physicsWorld.setEnemyVelocity(enemy, pushX * SPEED, pushY * SPEED);
      }
    }

    const pos = physicsWorld.getEnemyPosition(enemy);
    const nearest = nearestPathCenter(grid, pos.x, pos.y);
    expect(nearest.distance).toBeLessThanOrEqual(grid.tileSize);
  });

  it("dispose does not throw and invalidates the backing bodies", () => {
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.x = enemy.centerX;
    enemy.y = enemy.centerY;
    physicsWorld.addEnemy(enemy);
    expect(physicsWorld.getEnemyPosition(enemy)).not.toBeNull();

    expect(() => physicsWorld.dispose()).not.toThrow();

    // Freeing the world invalidates the backing rigid body; getEnemyPosition must
    // not resolve to a live position (it either throws or returns null).
    let after = null;
    let threw = false;
    try {
      after = physicsWorld.getEnemyPosition(enemy);
    } catch {
      threw = true;
    }
    expect(threw || after === null).toBe(true);
  });
});

describe("enemy CCD follows the step length", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;

  beforeAll(async () => {
    await initPhysics();
  });

  beforeEach(() => {
    grid = new Grid(getMap(0));
    physicsWorld = new PhysicsWorld(grid);
  });

  afterEach(() => {
    physicsWorld.dispose();
  });

  function ccdFor(type: string, stepSeconds: number): boolean {
    physicsWorld.setStepSeconds(stepSeconds);
    const enemy = new Enemy(type, 1, 0, grid, 1);
    enemy.x = enemy.centerX;
    enemy.y = enemy.centerY;
    physicsWorld.addEnemy(enemy);
    return enemy.body.isCcdEnabled();
  }

  it("leaves a minion off at 1/60 and arms it at 8/60", () => {
    expect(ccdFor("minion", fixedDeltaSeconds)).toBe(false);
    expect(ccdFor("minion", 8 * fixedDeltaSeconds)).toBe(true);
  });

  it("keeps a runner armed at 1× under the half-radius rule", () => {
    // radius is meta.radius * tileSize * 0.5, so a runner already clears half a
    // radius in one 1/60 step. The coarse step does not turn that off.
    expect(ccdFor("runner", fixedDeltaSeconds)).toBe(true);
    expect(ccdFor("runner", 8 * fixedDeltaSeconds)).toBe(true);
  });

  it("restamps a live minion when the step length changes and accepts an 8/60 step", () => {
    physicsWorld.setStepSeconds(fixedDeltaSeconds);
    const enemy = new Enemy("minion", 1, 0, grid, 1);
    enemy.x = enemy.centerX;
    enemy.y = enemy.centerY;
    physicsWorld.addEnemy(enemy);
    expect(enemy.body.isCcdEnabled()).toBe(false);
    expect(() => physicsWorld.step(8 * fixedDeltaSeconds)).not.toThrow();
    expect(enemy.body.isCcdEnabled()).toBe(true);
  });
});
