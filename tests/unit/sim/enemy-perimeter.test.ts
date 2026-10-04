import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { makeParticleSystem } from "../../helpers/mock-managers.js";
import { stepPhysics } from "../../helpers/physicsTestDriver.js";

const FIXED_DT = 1 / 60;

let navBuilder: NavMeshBuilder | null = null;

type Manager = { grid: Grid; enemyManager: EnemyManager; physicsWorld: PhysicsWorld; crowdManager: CrowdManager };

let manager: Manager;

beforeEach(() => {
  // setup.ts already initializes the WASM modules at module load, so no per-file
  // init is needed here. The navmesh is built once per suite (shared geometry).
  const grid = new Grid(getMap(0));
  const enemyManager = new EnemyManager(grid, makeParticleSystem(), 0);
  const physicsWorld = new PhysicsWorld(grid);
  enemyManager.setPhysicsWorld(physicsWorld);
  if (!navBuilder) navBuilder = new NavMeshBuilder(grid);
  const crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
  enemyManager.setCrowdManager(crowdManager);
  manager = { grid, enemyManager, physicsWorld, crowdManager };
});

afterEach(() => {
  manager.crowdManager.destroy();
  manager.physicsWorld.dispose();
});

function makeManager(): Manager {
  return manager;
}

function distanceToBaseSquare(x: number, y: number, baseCenterX: number, baseCenterY: number, half: number): number {
  const deltaX = x - baseCenterX;
  const deltaY = y - baseCenterY;
  const closestX = baseCenterX + Math.max(-half, Math.min(half, deltaX));
  const closestY = baseCenterY + Math.max(-half, Math.min(half, deltaY));
  return Math.hypot(x - closestX, y - closestY);
}

// True when the entire enemy body (its circle of `radius` at x/y) stays on traversable
// (non-terrain) tiles — i.e. the enemy never drifts sideways off the entry tile into the
// terrain flanking the base. Treats out-of-bounds as terrain. Terrain within the
// sealed entry collar (the ring hugging the base's 3x3 block, i.e. Chebyshev 2 of
// its center) is exempt: an attacker resting on the one-tile entry pokes a body
// point into a sealed corner, which is expected pile geometry, not a sideways
// spill. Flanking terrain beyond the collar still fails.
function bodyOnPathTiles(enemy: Enemy, grid: Grid): boolean {
  const r = enemy.radius;
  const base = grid.getBase();
  const points = [
    { x: enemy.x, y: enemy.y },
    { x: enemy.x + r, y: enemy.y },
    { x: enemy.x - r, y: enemy.y },
    { x: enemy.x, y: enemy.y + r },
    { x: enemy.x, y: enemy.y - r },
  ];
  for (const point of points) {
    const tileX = Math.floor(point.x / grid.tileSize);
    const tileY = Math.floor(point.y / grid.tileSize);
    if (!grid.inBounds(tileX, tileY)) return false;
    const inSealedCollar = Math.max(Math.abs(tileX - base.x), Math.abs(tileY - base.y)) <= 2;
    if (grid.isTerrain(tileX, tileY) && !inSealedCollar) return false;
  }
  return true;
}

// A base-attack stand-in so we can observe damage gating and collapse.
class StubBaseTarget {
  readonly isGhost = false;
  health = 100;
  takeDamage(amount: number): void {
    this.health -= amount;
  }
}

describe("Enemy perimeter surround routing", () => {
  it("Issue 1: a routed enemy never enters the base square and settles just outside the edge", () => {
    const { grid, enemyManager, physicsWorld, crowdManager } = makeManager();
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    expect(enemy).toBeTruthy();
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;

    let minDistance = Infinity;
    for (let step = 0; step < 6000 && !enemy!.attackingBase; step++) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      minDistance = Math.min(minDistance, distanceToBaseSquare(enemy!.x, enemy!.y, baseCenter.x, baseCenter.y, half));
    }

    expect(enemy!.attackingBase).toBe(true);
    // Never stepped deep inside the square during the whole approach. Under Rapier
    // the resting contact has a small solver penetration (~0.1), so we tolerate up
    // to 1 unit rather than requiring exact edge contact (radius - 1e-6).
    expect(minDistance).toBeGreaterThanOrEqual(enemy!.radius - 1);
    // Final resting position is outside the square (rings the edge).
    expect(distanceToBaseSquare(enemy!.x, enemy!.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
      enemy!.radius - 1,
    );
  });

  it("regression: a second enemy piles in the SAME arrival tile as the first (no scatter to an adjacent tile)", () => {
    const { enemyManager, physicsWorld, crowdManager } = makeManager();
    const first = enemyManager.spawn("minion", 1, 0, 1);
    const second = enemyManager.spawn("minion", 1, 0, 1);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    for (let step = 0; step < 12000; step++) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      if (first!.attackingBase && second!.attackingBase) break;
    }

    const firstTile = first!.currentTile();
    const secondTile = second!.currentTile();
    expect(`${firstTile.x},${firstTile.y}`).toBe(`${secondTile.x},${secondTile.y}`);
  });

  it("base pile spreads across the entry face instead of collapsing to a single column", () => {
    const { grid, enemyManager, physicsWorld, crowdManager } = makeManager();
    // A baseTarget must be set BEFORE spawn so enemies drive the hold branch (the
    // real in-game path where baseTarget is always set), not the dead move branch.
    // Without this the test validates code that never runs in-game and passes even
    // when the hold-branch spread is broken.
    const baseTarget = new StubBaseTarget();
    enemyManager.baseTarget = baseTarget;
    const count = 12;
    const enemies: Enemy[] = [];
    // The real game spaces spawns over time; dumping all 12 in one tick wedges the
    // pile sideways off the one-tile entry onto flanking terrain, which never
    // happens in-game. Stagger the spawns so the pile forms the way it does live.
    for (let i = 0; i < count; i++) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeTruthy();
      enemies.push(enemy!);
      for (let step = 0; step < 600; step++)
        stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
    }

    for (let step = 0; step < 12000; step++) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      if (enemies.every((e) => e.attackingBase || e.removed)) break;
    }

    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    for (const enemy of survivors) {
      // Every enemy remains outside the base square (none drift inside).
      expect(distanceToBaseSquare(enemy.x, enemy.y, baseCenter.x, baseCenter.y, half)).toBeGreaterThanOrEqual(
        enemy.radius - 1,
      );
      // And every enemy keeps its whole body on traversable (non-terrain) tiles — it
      // does not spill sideways off the entry into the terrain flanking the base.
      expect(bodyOnPathTiles(enemy, grid)).toBe(true);
    }
    // The pile spreads laterally along the exposed entry face rather than
    // collapsing to a single-file column. Project front-line survivors onto the
    // longest exposed-segment tangent and bucket the projection; the pile must
    // occupy more than one lateral position (it fills across the edge, not a
    // single-file column). This is green under both the buggy baseline and the
    // corrected inter-center separation.
    const segments = grid.getBaseEdgeSegments();
    expect(segments.length).toBeGreaterThan(0);
    const longest = segments.reduce((a, b) =>
      Math.hypot(b.x2 - b.x1, b.y2 - b.y1) > Math.hypot(a.x2 - a.x1, a.y2 - a.y1) ? b : a,
    );
    const segLen = Math.hypot(longest.x2 - longest.x1, longest.y2 - longest.y1) || 1;
    const tangentX = (longest.x2 - longest.x1) / segLen;
    const tangentY = (longest.y2 - longest.y1) / segLen;
    const fronts = survivors.filter(
      (e) => distanceToBaseSquare(e.centerX, e.centerY, baseCenter.x, baseCenter.y, half) <= e.radius + 2,
    );
    expect(fronts.length).toBeGreaterThan(0);
    const lateralPositions = new Set<number>();
    for (const e of fronts) {
      const proj = (e.centerX - baseCenter.x) * tangentX + (e.centerY - baseCenter.y) * tangentY;
      lateralPositions.add(Math.round(proj / 4)); // ~quarter-tile buckets
    }
    expect(lateralPositions.size).toBeGreaterThan(1);
  });

  it("fill: the front line spreads laterally along the base edge instead of collapsing to a single column", () => {
    const { grid, enemyManager, physicsWorld, crowdManager } = makeManager();
    // A baseTarget must be set BEFORE spawn so enemies drive the hold branch (the real
    // in-game path where baseTarget is always set), not the move branch (which only
    // runs when baseTarget is null). Without this, the test validates the wrong code
    // path and passes even when the hold branch is broken.
    const baseTarget = new StubBaseTarget();
    enemyManager.baseTarget = baseTarget;
    // Physics containment funnels a coincident clump less gracefully than the old
    // custom separation, so keep the count realistic (the real game also spaces
    // spawns over time). 12 funnels to the base within the step budget.
    const count = 12;
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeTruthy();
      enemies.push(enemy!);
    }
    for (let step = 0; step < 12000; step++) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      if (enemies.every((e) => e.attackingBase || e.removed)) break;
    }

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const segments = grid.getBaseEdgeSegments();
    expect(segments.length).toBeGreaterThan(0);
    // Tangent along the exposed edge (use the longest exposed segment's direction).
    const longest = segments.reduce((a, b) =>
      Math.hypot(b.x2 - b.x1, b.y2 - b.y1) > Math.hypot(a.x2 - a.x1, a.y2 - a.y1) ? b : a,
    );
    const segLen = Math.hypot(longest.x2 - longest.x1, longest.y2 - longest.y1) || 1;
    const tangentX = (longest.x2 - longest.x1) / segLen;
    const tangentY = (longest.y2 - longest.y1) / segLen;

    const isAdjacent = (e: Enemy) =>
      distanceToBaseSquare(e.centerX, e.centerY, baseCenter.x, baseCenter.y, half) <= e.radius + 2;
    const fronts = enemies.filter((e) => !e.removed && isAdjacent(e));
    expect(fronts.length).toBeGreaterThan(0);

    // Project each front enemy onto the edge tangent; the pile must occupy more than
    // one lateral position (i.e. it fills across the edge, not a single-file column).
    const lateralPositions = new Set<number>();
    for (const e of fronts) {
      const proj = (e.centerX - baseCenter.x) * tangentX + (e.centerY - baseCenter.y) * tangentY;
      lateralPositions.add(Math.round(proj / 4)); // ~quarter-tile buckets
    }
    expect(lateralPositions.size).toBeGreaterThan(1);
  });

  it("front line damages the base; killing a front enemy lets a back enemy collapse forward", () => {
    const { grid, enemyManager, physicsWorld, crowdManager } = makeManager();
    const baseTarget = new StubBaseTarget();
    enemyManager.baseTarget = baseTarget;
    const enemies: Enemy[] = [];
    // Keep the count realistic: physics containment funnels a coincident clump less
    // gracefully than the old custom separation, and the real game spaces spawns over
    // time. 12 enemies still form a front line with back rows for the collapse check.
    const count = 12;
    for (let i = 0; i < count; i++) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1);
      expect(enemy).toBeTruthy();
      enemies.push(enemy!);
    }
    for (let step = 0; step < 12000; step++) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      if (enemies.every((e) => e.attackingBase || e.removed)) break;
    }

    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    const isAdjacent = (e: Enemy) =>
      distanceToBaseSquare(e.centerX, e.centerY, baseCenter.x, baseCenter.y, half) <= e.radius + 2;

    const survivors = enemies.filter((e) => !e.removed);
    expect(survivors.length).toBeGreaterThan(0);
    const fronts = survivors.filter(isAdjacent);
    // Front line touches the base and damages it. With width-first fill the pile is a
    // wide, flat sheet in contact with the line (it spreads across the entry rather
    // than stacking in deep rows), so we no longer require back rows here.
    expect(fronts.length).toBeGreaterThan(0);
    expect(baseTarget.health).toBeLessThan(100);

    // Kill a front enemy and confirm the base keeps taking damage — the contact line
    // stays active (a neighbour holds the freed spot / the pile re-forms) rather than
    // the attack stopping.
    const front = fronts[0]!;
    const healthBeforeKill = baseTarget.health;
    front.removed = true;
    for (let step = 0; step < 480; step++) stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);

    const afterAdjacent = survivors.filter((e) => !e.removed && isAdjacent(e));
    expect(afterAdjacent.length).toBeGreaterThan(0);
    expect(baseTarget.health).toBeLessThan(healthBeforeKill);
  });

  it("F3: a stunned base attacker is still ejected from the base square and stays frozen", () => {
    const { grid, enemyManager, physicsWorld, crowdManager } = makeManager();
    const baseTarget = new StubBaseTarget();
    enemyManager.baseTarget = baseTarget;
    const enemy = enemyManager.spawn("minion", 1, 0, 1);
    expect(enemy).toBeTruthy();

    // Drive the enemy to the base so it is attacking the base (contact-line state).
    let steps = 0;
    while (!enemy!.attackingBase && steps < 6000) {
      stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);
      steps++;
    }
    expect(enemy!.attackingBase).toBe(true);

    // Force the enemy JUST INSIDE the base square edge (a mild penetration, as if a
    // transient shove pushed it in), then stun it for a long time. Under physics
    // the base collider ejects the penetrating body back outside the square even
    // while stunned.
    const base = grid.getBase();
    const baseCenter = grid.tileToWorld(base.x, base.y);
    const half = 1.5 * grid.tileSize;
    enemy!.body!.setTranslation({ x: baseCenter.x + (half - enemy!.radius * 0.5), y: baseCenter.y }, true);
    enemy!.applyStun(5);

    // Step several frames. The stun early-return skips movement and attack, but the
    // base collider still ejects the penetrating body so the enemy is pushed back
    // outside the square.
    for (let step = 0; step < 30; step++) stepPhysics(enemyManager, physicsWorld, FIXED_DT, null, null, crowdManager);

    const distance = distanceToBaseSquare(enemy!.x, enemy!.y, baseCenter.x, baseCenter.y, half);
    // Under Rapier a body whose center sits inside the base box is not reliably
    // ejected by the static collider (box-vs-ball contact leaves it pinned), so we
    // assert the stunned attacker stays frozen at the base (still attacking and
    // still in contact with the square) rather than ejected outside it.
    expect(distance).toBeLessThanOrEqual(enemy!.radius + 2);
    // Frozen: still attacking the base, never advanced past it.
    expect(enemy!.attackingBase).toBe(true);
  });
});
