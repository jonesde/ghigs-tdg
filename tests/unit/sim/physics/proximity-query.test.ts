// @ts-nocheck
// Proximity queries backed by Rapier (replaces the deleted spatial hash).

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Enemy } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import { getMap } from "@/sim/grid/Map.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../../../helpers/mock-grid.js";
import { makeParticleSystem } from "../../../helpers/mock-managers.js";
import { mockDefaultTheme } from "../../../helpers/mock-stores.js";

describe("PhysicsWorld proximity queries", () => {
  let grid: Grid;
  let pw: PhysicsWorld;
  beforeEach(() => {
    grid = new Grid(getMap(0));
    pw = new PhysicsWorld(grid);
  });
  afterEach(() => {
    pw.dispose();
  });

  function addEnemyAt(x: number, y: number): Enemy {
    const e = new Enemy("minion", 1, 0, grid, 1);
    e.x = x;
    e.y = y;
    e.centerX = x;
    e.centerY = y;
    pw.addEnemy(e);
    return e;
  }

  it("queryEnemiesInRange returns only enemies within center-distance range", () => {
    const a = addEnemyAt(100, 100);
    const b = addEnemyAt(120, 100);
    addEnemyAt(1000, 1000);
    pw.step();
    const near = pw.queryEnemiesInRange(100, 100, 50);
    expect(near).toContain(a);
    expect(near).toContain(b);
    expect(near).toHaveLength(2);
    expect(pw.queryEnemiesInRange(500, 500, 5)).toHaveLength(0);
  });

  it("forEachEnemyInRange visits the same set as queryEnemiesInRange", () => {
    addEnemyAt(100, 100);
    addEnemyAt(120, 100);
    addEnemyAt(1000, 1000);
    pw.step();
    const arr = pw.queryEnemiesInRange(100, 100, 50);
    const via: Enemy[] = [];
    pw.forEachEnemyInRange(100, 100, 50, (e) => via.push(e));
    expect(via.map((e) => e.id).sort()).toEqual(arr.map((e) => e.id).sort());
  });

  it("never returns removed enemies (Risk 5)", () => {
    const e = addEnemyAt(100, 100);
    pw.step();
    expect(pw.queryEnemiesInRange(100, 100, 50)).toContain(e);
    e.removed = true;
    pw.step();
    expect(pw.queryEnemiesInRange(100, 100, 50)).not.toContain(e);
    pw.removeEnemy(e);
    pw.step();
    expect(pw.queryEnemiesInRange(100, 100, 50)).toHaveLength(0);
  });
});

describe("EnemyManager proximity delegate", () => {
  let manager: EnemyManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;
  let pw: PhysicsWorld;
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

  it("getEnemiesInRange reads enemy.x/y and excludes removed", () => {
    const enemy = manager.spawn("minion", 1, 0, 1)!;
    pw.step();
    const placedX = enemy.x;
    const placedY = enemy.y;
    expect(manager.getEnemiesInRange(placedX, placedY, 50)).toContain(enemy);
    // The rigid body stays at the spawn point. The range walk must follow the
    // gameplay position postStep publishes, not the collider.
    enemy.x = placedX + 1000;
    enemy.y = placedY + 1000;
    expect(manager.getEnemiesInRange(placedX, placedY, 50)).not.toContain(enemy);
    expect(manager.getEnemiesInRange(enemy.x, enemy.y, 50)).toContain(enemy);
    enemy.removed = true;
    expect(manager.getEnemiesInRange(enemy.x, enemy.y, 50)).not.toContain(enemy);
  });
});
