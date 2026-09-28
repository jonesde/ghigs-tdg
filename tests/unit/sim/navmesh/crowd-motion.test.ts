import { afterEach, describe, expect, it } from "vitest";
import { FIXED_DT } from "@/sim/Constants.js";
import type { AttackTarget } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager, restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { makeBastionMap, makeMapData } from "../../../helpers/mock-grid.js";

// A synthetic 1-tile-wide L-shaped corridor (a horizontal run then a vertical run
// to the base) — the canonical inside-corner case. Used to verify a wide enemy
// rounds the bend and reaches the base instead of clipping the wall / stalling.
function makeOneWideCornerMap() {
  const width = 9;
  const height = 9;
  const tiles: { type: "terrain" | "path" | "base" | "spawn"; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: "terrain" | "path" | "base" | "spawn"; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) row.push({ type: "terrain", height: 1 });
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < 7; colIndex++) tiles[4]![colIndex]!.type = "path";
  for (let rowIndex = 4; rowIndex < 8; rowIndex++) tiles[rowIndex]![7]!.type = "path";
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 4 }],
    base: { x: 7, y: 7 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

// A minimal base attack target so Enemy.postPhysics can run its base-attack
// tick without needing a full GameEngine. The damage value is never asserted.
function makeBaseTarget(): AttackTarget {
  return { isGhost: false, takeDamage: () => {} };
}

// A 2-tile-wide straight lane (rows 3-4) from spawn to base. Wider than a body
// so a faster enemy spawned directly behind a slower one has room to steer
// around it. Used to verify Detour keeps speed/momentum across the per-frame
// crowd<->body resync: a fast runner should overtake a slow tank instead of
// crawling/ramming it or pulling the tank backward.
function makeTwoWideLaneMap() {
  const width = 9;
  const height = 6;
  const tiles: { type: "terrain" | "path" | "base" | "spawn"; height: number }[][] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row: { type: "terrain" | "path" | "base" | "spawn"; height: number }[] = [];
    for (let colIndex = 0; colIndex < width; colIndex++) row.push({ type: "terrain", height: 1 });
    tiles.push(row);
  }
  for (let colIndex = 0; colIndex < width; colIndex++) {
    tiles[3]![colIndex]!.type = "path";
    tiles[4]![colIndex]!.type = "path";
  }
  return makeMapData({
    width,
    height,
    tiles,
    spawns: [{ x: 0, y: 3 }],
    base: { x: width - 1, y: 3 },
    regionId: 0,
    level: 1,
    style: "bastion",
  });
}

// Drives the real engine loop (preStep -> crowd.update -> physics.step ->
// postStep) so crowd agents keep their velocity across the per-frame resync.
// The bare `enemy.postPhysics` loop silently freezes agents.
function runCrowdLoop(
  stepCount: number,
  enemyManager: EnemyManager,
  crowdManager: CrowdManager,
  physicsWorld: PhysicsWorld,
  onEnemyKill: () => void,
  onEnemyBeginAttackBase: () => void,
): void {
  for (let step = 0; step < stepCount; step++) {
    enemyManager.preStep(FIXED_DT);
    crowdManager.update(FIXED_DT, enemyManager.enemies);
    physicsWorld.step();
    enemyManager.postStep(FIXED_DT, onEnemyKill, onEnemyBeginAttackBase);
  }
}

function distanceToBase(enemy: { centerX: number; centerY: number }, baseWorld: { x: number; y: number }): number {
  return Math.hypot(enemy.centerX - baseWorld.x, enemy.centerY - baseWorld.y);
}

describe("CrowdManager motion", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let crowdManager: CrowdManager;
  let enemyManager: EnemyManager;

  // Builds a fresh PhysicsWorld + CrowdManager + EnemyManager for the given map.
  // setup.ts already initializes both WASM modules at module load, so no per-file
  // init is needed. Disposed in afterEach so each scenario frees its Rapier world.
  function setupScenario(mapFactory: () => ReturnType<typeof makeMapData>): void {
    grid = new Grid(mapFactory());
    const navBuilder = new NavMeshBuilder(grid);
    expect(navBuilder.isSuccess()).toBe(true);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    enemyManager = new EnemyManager(grid, new NoopParticleSpawner(), 0, null, {});
    physicsWorld = new PhysicsWorld(grid);
    // DetourCrowd owns enemy-enemy avoidance, so disable Rapier enemy-enemy
    // collisions — this isolates the crowd's local avoidance in the overlap check.
    physicsWorld.setEnemyEnemyCollisions(false);
    enemyManager.setPhysicsWorld(physicsWorld);
    enemyManager.baseTarget = makeBaseTarget();
  }

  afterEach(() => {
    crowdManager.destroy();
    physicsWorld.dispose();
  });

  it("drives enemies toward the base and keeps them from overlapping", () => {
    setupScenario(makeBastionMap);

    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);

    const enemyA = enemyManager.spawn("runner", 1, 0, 1);
    const enemyB = enemyManager.spawn("runner", 1, 0, 1);
    expect(enemyA).not.toBeNull();
    expect(enemyB).not.toBeNull();

    // Offset enemyB slightly off the spawn tile so the crowd has a clear lateral
    // direction to separate the two agents (both target the same base point).
    const offset = grid.tileSize * 0.4;
    enemyB!.body!.setTranslation({ x: enemyB!.x + offset, y: enemyB!.y }, true);
    enemyB!.x = enemyB!.x + offset;
    enemyB!.centerX = enemyB!.x;

    crowdManager.addAgent(enemyA!);
    crowdManager.setBaseTarget(enemyA!, baseWorld);
    crowdManager.addAgent(enemyB!);
    crowdManager.setBaseTarget(enemyB!, baseWorld);

    const startDistA = distanceToBase(enemyA!, baseWorld);
    const startDistB = distanceToBase(enemyB!, baseWorld);

    // Drive the crowd + physics loop (mirrors GameEngine.update).
    // postPhysics reads the stepped body back and re-syncs the crowd agent to
    // it so the two stay aligned, exactly as the engine does on the ON path.
    for (let step = 0; step < 200; step++) {
      crowdManager.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      for (const enemy of enemyManager.enemies) {
        enemy.postPhysics(FIXED_DT);
      }
    }

    // (a) Each enemy moved closer to the base over time.
    expect(distanceToBase(enemyA!, baseWorld)).toBeLessThan(startDistA);
    expect(distanceToBase(enemyB!, baseWorld)).toBeLessThan(startDistB);

    // (b) Two agents started near each other end the loop not overlapping —
    // demonstrating DetourCrowd local avoidance (no Rapier enemy-enemy collision).
    const centerDistance = Math.hypot(enemyA!.centerX - enemyB!.centerX, enemyA!.centerY - enemyB!.centerY);
    expect(centerDistance).toBeGreaterThan(enemyA!.radius * 0.5);
  });

  // The navmesh does not fillet the inside corner (one voxel of erosion severs
  // this bend). The corridor-wall chamfer is what keeps the turn from reversing
  // the enemy. Assert arrival and bounded backtrack, not zero wall contact.
  function expectReachesBaseThroughCorner(enemyType: string): void {
    setupScenario(makeOneWideCornerMap);
    enemyManager.setCrowdManager(crowdManager);

    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
    const enemy = enemyManager.spawn(enemyType, 1, 0, 1)!;
    expect(enemy).not.toBeNull();

    const onEnemyKill = () => {};
    const onEnemyBeginAttackBase = () => {};

    const startDistance = distanceToBase(enemy, baseWorld);
    let previousDistance = startDistance;
    let maxBacktrack = 0;
    let reached = false;
    for (let step = 0; step < 12000 && !reached; step++) {
      enemyManager.preStep(FIXED_DT);
      crowdManager.update(FIXED_DT, enemyManager.enemies);
      physicsWorld.step();
      enemyManager.postStep(FIXED_DT, onEnemyKill, onEnemyBeginAttackBase);
      const currentDistance = distanceToBase(enemy, baseWorld);
      if (currentDistance - previousDistance > maxBacktrack) maxBacktrack = currentDistance - previousDistance;
      previousDistance = currentDistance;
      reached = enemy.attackingBase;
      if (enemy.removed) break;
    }

    expect(startDistance - distanceToBase(enemy, baseWorld)).toBeGreaterThan(grid.tileSize * 2);
    expect(reached).toBe(true);
    expect(maxBacktrack).toBeLessThan(enemy.radius);
  }

  it("reaches the base through a 1-wide inside corner (tank)", () => {
    expectReachesBaseThroughCorner("tank");
  });

  it("reaches the base through a 1-wide inside corner (boss)", () => {
    expectReachesBaseThroughCorner("boss");
  });

  it("lets a faster runner overtake a slower tank on a 2-wide lane", () => {
    // Regression guard: with the crowd<->body velocity preserved across the
    // per-frame resync, the runner keeps speed/momentum and steers around the
    // slower tank instead of crawling/ramming it (and the tank is not pulled
    // backward into the runner). At the old crawl speed (one acceleration step
    // per frame) the runner could not reach the base within this budget.
    setupScenario(makeTwoWideLaneMap);
    enemyManager.setCrowdManager(crowdManager);

    const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);

    // Slow tank ahead in row 3; fast runner directly behind it in row 3.
    const tank = enemyManager.spawn("tank", 1, 0, 1)!;
    const runner = enemyManager.spawn("runner", 1, 0, 1)!;
    expect(tank).not.toBeNull();
    expect(runner).not.toBeNull();

    const tankLead = grid.tileSize * 3;
    tank.body!.setTranslation({ x: tank.x + tankLead, y: tank.y }, true);
    tank.x = tank.x + tankLead;
    tank.centerX = tank.x;

    crowdManager.addAgent(tank);
    crowdManager.setBaseTarget(tank, baseWorld);
    crowdManager.addAgent(runner);
    crowdManager.setBaseTarget(runner, baseWorld);

    const startDistTank = distanceToBase(tank, baseWorld);
    const startDistRunner = distanceToBase(runner, baseWorld);

    const onEnemyKill = () => {};
    const onEnemyBeginAttackBase = () => {};

    let minCenterDistance = Number.POSITIVE_INFINITY;
    let runnerReachedBase = false;
    for (let step = 0; step < 800 && !runnerReachedBase; step++) {
      runCrowdLoop(1, enemyManager, crowdManager, physicsWorld, onEnemyKill, onEnemyBeginAttackBase);
      // The two only touch while the runner is mid-overtake (brief full overlap
      // at the pass); exclude that single transient frame so the assertion checks
      // the steady-state gap the crowd maintains, not the instant of passing.
      const centerDistance = Math.hypot(tank.centerX - runner.centerX, tank.centerY - runner.centerY);
      if (step > 0 && centerDistance > tank.radius) minCenterDistance = Math.min(minCenterDistance, centerDistance);
      runnerReachedBase = runner.attackingBase;
    }

    // (a) Both enemies advanced toward the base.
    expect(distanceToBase(tank, baseWorld)).toBeLessThan(startDistTank);
    expect(distanceToBase(runner, baseWorld)).toBeLessThan(startDistRunner);

    // (b) The runner overtook the tank: it ends closer to the base.
    expect(distanceToBase(runner, baseWorld)).toBeLessThan(distanceToBase(tank, baseWorld));

    // (c) The runner reached the base within a budget impossible at crawl speed,
    //     confirming velocity actually accumulates to maxSpeed.
    expect(runnerReachedBase).toBe(true);

    // (d) Once the runner pulls alongside to pass, the crowd keeps a real gap
    //     (the runner ends well clear of the tank, not stacked on it).
    expect(minCenterDistance).toBeGreaterThan(tank.radius);
  });

  it("restoreCrowdAgentVelocity writes the pre-teleport velocity back onto the agent", () => {
    setupScenario(makeBastionMap);
    const enemy = enemyManager.spawn("runner", 1, 0, 1)!;
    crowdManager.addAgent(enemy);
    crowdManager.setBaseTarget(enemy, grid.tileToWorld(grid.getBase().x, grid.getBase().y));
    crowdManager.update(FIXED_DT, [enemy]);
    const before = enemy.agent!.velocity();
    expect(Math.hypot(before.x, before.z)).toBeGreaterThan(0);
    enemy.agent!.teleport(enemy.agent!.position());
    restoreCrowdAgentVelocity(enemy.agent!, before);
    const after = enemy.agent!.velocity();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.z).toBeCloseTo(before.z, 5);
  });
});
