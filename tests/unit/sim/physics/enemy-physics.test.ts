// @ts-nocheck
// Enemy ON-branch tests (body set) driven manually, unconditionally.
// We construct a PhysicsWorld + CrowdManager, addAgent so enemy.agent is non-null,
// then drive the enemy via computeIntent / crowd.update / step / postPhysics.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";

const FIXED_DT = 1 / 60;

function baseCenterOf(grid) {
  const base = grid.getBase();
  return grid.tileToWorld(base.x, base.y);
}

describe("Enemy ON branches (body set) driven manually", () => {
  let grid: Grid;
  let physicsWorld: PhysicsWorld;
  let crowdManager: CrowdManager;
  let enemy: Enemy;

  beforeAll(async () => {
    // setup.ts already initializes both WASM modules at module load.
  });

  beforeEach(() => {
    grid = new Grid(getMap(0));
    physicsWorld = new PhysicsWorld(grid);
    const navBuilder = new NavMeshBuilder(grid);
    crowdManager = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 10);
    enemy = new Enemy("minion", 1, 0, grid, 1);
    physicsWorld.addEnemy(enemy);
    crowdManager.addAgent(enemy);
    crowdManager.setBaseTarget(enemy, baseCenterOf(grid));
  });

  afterEach(() => {
    crowdManager.destroy();
    physicsWorld.dispose();
  });

  function drive(enemy: Enemy, frames: number): void {
    for (let i = 0; i < frames; i++) {
      enemy.computeIntent(FIXED_DT, null);
      crowdManager.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
    }
  }

  it("advances toward the base, stays in sync with its body, and reaches the base", () => {
    const baseCenter = baseCenterOf(grid);
    const startDist = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);

    // The corridor's first leg runs away from the base, so distance only starts
    // shrinking once the enemy rounds the first corner (~300 frames on map 0).
    drive(enemy, 600);

    const endDist = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);
    expect(endDist).toBeLessThan(startDist);

    const bodyPos = physicsWorld.getEnemyPosition(enemy);
    expect(Math.abs(enemy.x - bodyPos.x)).toBeLessThan(1e-6);
    expect(Math.abs(enemy.y - bodyPos.y)).toBeLessThan(1e-6);

    // Continue until it reaches the base (generous budget; loop breaks early).
    let reached = enemy.attackingBase;
    for (let i = 0; i < 12000 && !reached; i++) {
      enemy.computeIntent(FIXED_DT, null);
      crowdManager.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
      reached = enemy.attackingBase;
    }
    expect(reached).toBe(true);
  });

  it("knockback impulse pushes the body backward and enters ballistic mode", () => {
    // Advance past the first corner so the enemy is on a leg where a shove
    // moves it unambiguously away from the base.
    drive(enemy, 600);
    const startDist = Math.hypot(enemy.centerX - baseCenterOf(grid).x, enemy.centerY - baseCenterOf(grid).y);
    expect(startDist).toBeGreaterThan(0);

    const baseCenter = baseCenterOf(grid);
    const before = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);

    enemy.applyKnockback(2 * grid.tileSize);
    expect(enemy.ballisticTimer).toBeGreaterThan(0);
    // During ballistic, crowd must not overwrite linvel.
    crowdManager.update(FIXED_DT, [enemy]);
    physicsWorld.step();
    enemy.postPhysics(FIXED_DT);

    const after = Math.hypot(enemy.centerX - baseCenter.x, enemy.centerY - baseCenter.y);
    expect(after).toBeGreaterThan(before);
  });

  it("preserves moveAngle at low speed (no garbage overwrite)", () => {
    // Drive to the base and pin there so the body's linvel is near zero.
    let reached = false;
    for (let i = 0; i < 12000 && !reached; i++) {
      enemy.computeIntent(FIXED_DT, null);
      crowdManager.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
      reached = enemy.attackingBase;
    }
    expect(reached).toBe(true);

    const beforeAngle = enemy.moveAngle;
    enemy.computeIntent(FIXED_DT, null);
    crowdManager.update(FIXED_DT, [enemy]);
    physicsWorld.step();
    enemy.postPhysics(FIXED_DT);

    expect(Number.isFinite(enemy.moveAngle)).toBe(true);
    expect(Math.abs(enemy.moveAngle - beforeAngle)).toBeLessThan(0.05);
  });

  it("attacks its base target at most at attackSpeed (throttled, not every frame)", () => {
    let totalDamage = 0;
    let hits = 0;
    const fakeTarget = {
      isGhost: false,
      takeDamage(amount: number) {
        totalDamage += amount;
        hits++;
      },
    };
    enemy.baseTarget = fakeTarget as unknown as Enemy["baseTarget"];

    // Drive until it is in contact with the base.
    let reached = false;
    for (let i = 0; i < 12000 && !reached; i++) {
      enemy.computeIntent(FIXED_DT, null);
      crowdManager.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
      reached = enemy.attackingBase;
    }
    expect(reached).toBe(true);

    // Two seconds of contact — an unthrottled tick would call takeDamage ~120×.
    for (let i = 0; i < 120; i++) {
      enemy.computeIntent(FIXED_DT, null);
      crowdManager.update(FIXED_DT, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(FIXED_DT);
    }

    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(20); // throttle holds: ~attackSpeed hits, not 120
    expect(totalDamage).toBeCloseTo(hits * enemy.attackDamage, 6);
  });

  it("decrements stunTimer by exactly dt per frame (no double decrement)", () => {
    drive(enemy, 50);
    expect(enemy.stunTimer).toBe(0);

    enemy.applyStun(1.0);
    drive(enemy, 30);
    // 30 frames * (1/60)s = 0.5s elapsed, so ~0.5s of stun remaining.
    expect(enemy.stunTimer).toBeCloseTo(1.0 - 30 * FIXED_DT, 6);
    expect(enemy.stunTimer).toBeGreaterThan(0.4);
  });

  it("stun zeroes velocity and barely moves the body", () => {
    drive(enemy, 50);
    const beforeX = enemy.centerX;
    const beforeY = enemy.centerY;

    enemy.applyStun(1.0);
    enemy.computeIntent(FIXED_DT, null);
    crowdManager.update(FIXED_DT, [enemy]);
    physicsWorld.step();
    enemy.postPhysics(FIXED_DT);

    const linvel = enemy.body.linvel();
    expect(Math.hypot(linvel.x, linvel.y)).toBeLessThan(1e-3);
    expect(Math.abs(enemy.centerX - beforeX)).toBeLessThan(1e-2);
    expect(Math.abs(enemy.centerY - beforeY)).toBeLessThan(1e-2);
  });
});
