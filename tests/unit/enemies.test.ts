// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  MIN_SLOW_FACTOR,
} from "@/sim/ConstantsEnemy.js";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { mockDefaultTheme } from "../helpers/mock-stores.js";
import { orderedPath } from "../helpers/navmesh-test-utils.js";

describe("Enemy", () => {
  let grid: Grid;
  let map: ReturnType<typeof makeBastionMap>;
  let physicsWorld: PhysicsWorld;
  let navBuilder: NavMeshBuilder;
  let crowd: CrowdManager;
  let spawn: (type: string, level?: number, spawnIndex?: number, wave?: number) => Enemy;
  let tickEnemy: (enemy: Enemy, dt: number) => void;

  beforeEach(() => {
    resetEnemyId();
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;
    map = makeBastionMap();
    grid = new Grid(map);
    physicsWorld = new PhysicsWorld(grid);
    navBuilder = new NavMeshBuilder(grid);
    crowd = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 50);
    spawn = (type, level = 1, spawnIndex = 0, wave = 1) => {
      const enemy = new Enemy(type, level, spawnIndex, grid, wave);
      physicsWorld.addEnemy(enemy);
      crowd.addAgent(enemy);
      crowd.setBaseTarget(enemy, grid.tileToWorld(grid.getBase().x, grid.getBase().y));
      return enemy;
    };
    tickEnemy = (enemy, dt) => {
      enemy.computeIntent(dt, null);
      crowd.update(dt, [enemy]);
      physicsWorld.step();
      enemy.postPhysics(dt);
    };
  });

  afterEach(() => {
    crowd.destroy();
    physicsWorld.dispose();
  });

  describe("constructor", () => {
    it("assigns incrementing IDs", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1);
      const enemy2 = new Enemy("minion", 1, 0, grid, 1);
      expect(enemy2.id).toBe(enemy1.id + 1);
    });

    it("sets type, level, and meta", () => {
      const enemy = new Enemy("tank", 3, 0, grid, 10);
      expect(enemy.type).toBe("tank");
      expect(enemy.level).toBe(3);
      expect(enemy.meta).toBe(ENEMY_TYPES.tank);
    });

    it("computes HP using the formula", () => {
      const wave = 10;
      const level = 2;
      const diffTick = 0;
      const enemy = new Enemy("minion", level, 0, grid, wave, diffTick);
      const waveMult = 1 + ENEMY_WAVE_DAMAGE_MULT * (wave - 1);
      const diffMult = 1 + DIFFICULTY_MULT_TICK * diffTick;
      const expected = ENEMY_TYPES.minion.baseHp * ENEMY_LEVEL_HP_MULT(level) * waveMult * diffMult;
      expect(enemy.maxHp).toBeCloseTo(expected, 4);
      expect(enemy.hp).toBe(enemy.maxHp);
    });

    it("scales HP with wave number", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 1, 0, grid, 11, 0);
      const expectedRatio = (1 + ENEMY_WAVE_DAMAGE_MULT * 10) / (1 + ENEMY_WAVE_DAMAGE_MULT * 0);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("scales HP with enemy level", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 3, 0, grid, 1, 0);
      const expectedRatio = ENEMY_LEVEL_HP_MULT(3) / ENEMY_LEVEL_HP_MULT(1);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("scales HP with difficulty tick", () => {
      const enemy1 = new Enemy("minion", 1, 0, grid, 1, 0);
      const enemy2 = new Enemy("minion", 1, 0, grid, 1, 4);
      const expectedRatio = (1 + DIFFICULTY_MULT_TICK * 4) / (1 + DIFFICULTY_MULT_TICK * 0);
      expect(enemy2.maxHp / enemy1.maxHp).toBeCloseTo(expectedRatio, 4);
    });

    it("computes bounty using level scaling", () => {
      const level = 3;
      const enemy = new Enemy("minion", level, 0, grid, 1, 0);
      const expected = Math.ceil(ENEMY_TYPES.minion.bounty * (1 + 0.5 * (level - 1)));
      expect(enemy.bounty).toBe(expected);
    });

    it("sets shield for shielded enemies", () => {
      const enemy = new Enemy("shielded", 2, 0, grid, 1, 0);
      expect((enemy as { shield: number }).shield).toBe(ENEMY_TYPES.shielded.shield! * 2);
      expect((enemy as { maxShield: number }).maxShield).toBe((enemy as { shield: number }).shield);
    });

    it("has zero shield for non-shielded types", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect((enemy as { shield: number }).shield).toBe(0);
    });

    it("sets speed from meta", () => {
      const enemy = new Enemy("runner", 1, 0, grid, 1, 0);
      expect(enemy.speed).toBe(ENEMY_TYPES.runner.speed);
    });

    it("sets radius from meta and grid.tileSize", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(enemy.radius).toBe(ENEMY_TYPES.minion.radius * grid.tileSize * 0.5);
    });

    it("sets heal and healRange for healer type", () => {
      const enemy = new Enemy("healer", 1, 0, grid, 1, 0);
      expect((enemy as { heal: number }).heal).toBe(ENEMY_TYPES.healer.heal!);
      expect((enemy as { healRange: number }).healRange).toBe(ENEMY_TYPES.healer.healRange! * grid.tileSize);
    });

    it("sets resist and slowResist for boss", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      expect((enemy as { resist: number }).resist).toBe(ENEMY_TYPES.boss.resist);
      expect((enemy as { slowResist: number }).slowResist).toBe(ENEMY_TYPES.boss.slowResist);
    });

    it("initializes status effects to zero", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(enemy.slowFactor).toBe(1);
      expect(enemy.slowStack).toHaveLength(0);
      expect(enemy.stunTimer).toBe(0);
      expect(enemy.attackingBase).toBe(false);
      expect(enemy.removed).toBe(false);
      expect(enemy.burnStack).toHaveLength(0);
    });

    it("spawns at the first corridor tile (spawn tile center)", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const firstTile = orderedPath(grid, 0)[0]!;
      const firstCenter = grid.tileToWorld(firstTile.x, firstTile.y);
      expect(enemy.x).toBeCloseTo(firstCenter.x, 5);
      expect(enemy.y).toBeCloseTo(firstCenter.y, 5);
    });

    it("keeps a navmesh route from spawn to base", () => {
      expect(navBuilder.isSuccess()).toBe(true);
      const spawnPoint = grid.spawns[0]!;
      const base = grid.getBase();
      const corridor = navBuilder.findPath(
        grid.tileToWorld(spawnPoint.x, spawnPoint.y),
        grid.tileToWorld(base.x, base.y),
      );
      expect(corridor.length).toBeGreaterThan(0);
    });
  });

  describe("takeDamage", () => {
    it("reduces HP by damage amount", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const initialHp = enemy.hp;
      enemy.takeDamage(5);
      expect(enemy.hp).toBeCloseTo(initialHp - 5, 4);
    });

    it("marks enemy as removed when HP <= 0", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 10;
      enemy.takeDamage(10);
      expect(enemy.removed).toBe(true);
    });

    it("does not remove when HP > 0 after damage", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.hp = 10;
      enemy.takeDamage(5);
      expect(enemy.removed).toBe(false);
    });

    it("absorbs damage with shield before reducing HP", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      const initialShield = (enemy as { shield: number }).shield;
      enemy.takeDamage(10);
      expect((enemy as { shield: number }).shield).toBeCloseTo(initialShield - 10, 4);
      expect(enemy.hp).toBe(enemy.maxHp);
    });

    it("depletes shield before damaging HP", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 5;
      enemy.takeDamage(10);
      expect((enemy as { shield: number }).shield).toBe(0);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    it("does not use shield when armorPiercing is true", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      const initialShield = (enemy as { shield: number }).shield;
      enemy.takeDamage(10, true);
      expect((enemy as { shield: number }).shield).toBe(initialShield);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    it("returns the actual damage dealt", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const damage = enemy.takeDamage(7);
      expect(damage).toBe(7);
    });

    it("returns 0 when damage is fully absorbed by shield", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 100;
      const damage = enemy.takeDamage(5);
      expect(damage).toBe(0);
    });
  });

  describe("applySlow", () => {
    it("adds a slow entry to the stack", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 2.0);
      expect(enemy.slowStack).toHaveLength(1);
      expect(enemy.slowStack[0].eff).toBe(0.5);
      expect(enemy.slowStack[0].remaining).toBe(2.0);
    });

    it("respects slowResist", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      enemy.applySlow(0.5, 2.0);
      const expectedEff = 0.5 * (1 - enemy.slowResist);
      expect(enemy.slowStack[0].eff).toBeCloseTo(expectedEff, 4);
    });

    it("keeps distinct strengths as separate multiplicative entries", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.3, 1.0);
      enemy.applySlow(0.4, 2.0);
      expect(enemy.slowStack).toHaveLength(2);
      expect(enemy.slowFactor).toBeCloseTo(0.7 * 0.6, 4);
    });

    it("refreshes duration of an existing entry with the same strength", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.3, 1.0);
      enemy.applySlow(0.3, 2.0);
      expect(enemy.slowStack).toHaveLength(1);
      expect(enemy.slowStack[0].remaining).toBe(2.0);
    });

    it("clamps slowFactor to MIN_SLOW_FACTOR", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0.95, 10.0);
      expect(enemy.slowFactor).toBeGreaterThanOrEqual(MIN_SLOW_FACTOR);
    });

    it("does nothing for zero or negative eff", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applySlow(0, 1.0);
      expect(enemy.slowStack).toHaveLength(0);
    });
  });

  describe("applyStun", () => {
    it("sets stunTimer to the given duration", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyStun(0.5);
      expect(enemy.stunTimer).toBe(0.5);
    });

    it("does not reduce existing stun timer", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyStun(1.0);
      enemy.applyStun(0.5);
      expect(enemy.stunTimer).toBe(1.0);
    });

    it("reduces duration for boss by BOSS_STUN_REDUCTION", () => {
      const enemy = new Enemy("boss", 1, 0, grid, 1, 0);
      enemy.applyStun(1.0);
      expect(enemy.stunTimer).toBeCloseTo(1.0 * BOSS_STUN_REDUCTION, 4);
    });
  });

  describe("applyBurn", () => {
    it("adds a burn entry", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(5, 3.0);
      expect(enemy.burnStack).toHaveLength(1);
      expect(enemy.burnStack[0]!.dps).toBe(5);
      expect(enemy.burnStack[0]!.timer).toBeCloseTo(3.0, 4);
    });

    it("stacks independent burns instead of overwriting", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(10, 5.0);
      enemy.applyBurn(5, 3.0);
      expect(enemy.burnStack).toHaveLength(2);
      const totalDps = enemy.burnStack.reduce((sum, burnEntry) => sum + burnEntry.dps, 0);
      expect(totalDps).toBe(15);
    });
  });

  describe("update", () => {
    it("does nothing when removed", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.removed = true;
      tickEnemy(enemy, 0.1);
      expect(enemy.removed).toBe(true);
    });

    it("keeps attacking the base without being removed once it reaches the base", () => {
      const enemy = spawn("minion", 1, 0, 1);
      const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
      enemy.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);
      tickEnemy(enemy, 0.01);
      expect(enemy.attackingBase).toBe(true);
      for (let tick = 0; tick < 50; tick++) tickEnemy(enemy, 0.05);
      expect(enemy.removed).toBe(false);
    });

    it("reduces stunTimer each tick", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.applyStun(1.0);
      tickEnemy(enemy, 0.5);
      expect(enemy.stunTimer).toBeCloseTo(0.5, 4);
    });

    it("does not move while stunned", () => {
      const enemy = spawn("minion", 1, 0, 1);
      const startX = enemy.x;
      enemy.applyStun(1.0);
      tickEnemy(enemy, 0.5);
      expect(enemy.x).toBe(startX);
    });

    it("moves toward the base", () => {
      const enemy = spawn("minion", 1, 0, 1);
      const startX = enemy.x;
      const startY = enemy.y;
      tickEnemy(enemy, 1.0);
      const distMoved = Math.hypot(enemy.x - startX, enemy.y - startY);
      expect(distMoved).toBeGreaterThan(0);
    });

    it("reaches and attacks the base when placed at it", () => {
      const enemy = spawn("minion", 1, 0, 1);
      const baseCenter = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
      enemy.body!.setTranslation({ x: baseCenter.x, y: baseCenter.y }, true);
      tickEnemy(enemy, 0.01);
      expect(enemy.attackingBase).toBe(true);
      expect(enemy.removed).toBe(false);
    });

    it("reduces slow stack remaining time each tick", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.applySlow(0.5, 2.0);
      tickEnemy(enemy, 1.0);
      expect(enemy.slowStack[0].remaining).toBeCloseTo(1.0, 4);
    });

    it("removes expired slow entries", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.applySlow(0.5, 0.5);
      tickEnemy(enemy, 1.0);
      expect(enemy.slowStack).toHaveLength(0);
      expect(enemy.slowFactor).toBe(1);
    });

    it("applies burn damage each tick", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.hp = 20;
      enemy.applyBurn(5, 2.0);
      const hpBefore = enemy.hp;
      tickEnemy(enemy, 1.0);
      expect(enemy.hp).toBeLessThan(hpBefore);
    });

    it("stops burning when burnTimer expires", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.hp = 20;
      enemy.applyBurn(5, 0.5);
      tickEnemy(enemy, 1.0);
      const hpAfterExpiry = enemy.hp;
      tickEnemy(enemy, 1.0);
      expect(enemy.hp).toBe(hpAfterExpiry);
    });

    it("does not move after burn damage kills it", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.hp = 5;
      enemy.applyBurn(100, 1.0);
      const startX = enemy.x;
      const startY = enemy.y;
      tickEnemy(enemy, 1.0);
      expect(enemy.removed).toBe(true);
      expect(enemy.x).toBe(startX);
      expect(enemy.y).toBe(startY);
    });
  });

  describe("sealed return lane", () => {
    const fixedDt = 1 / 60;
    const sealedRows = ["S######.", "......#.", "WWWWWW#.", "#.......", "##B.....", "........"];

    function makeSealedGrid() {
      const height = sealedRows.length;
      const width = sealedRows[0].length;
      const tiles = sealedRows.map((row) =>
        [...row].map((symbol) => {
          const type = symbol === "B" ? "base" : symbol === "S" ? "spawn" : symbol === "." ? "terrain" : "path";
          return { type, height: 1 };
        }),
      );
      const grid = new Grid({ width, height, tiles, spawns: [{ x: 3, y: 0 }], base: { x: 2, y: 4 } });
      for (let tileX = 0; tileX <= 5; tileX++) grid.registerTower(tileX, 2);
      return grid;
    }

    it("walks toward the wall face instead of the tile nearest the base", () => {
      const grid = makeSealedGrid();
      const navBuilder = new NavMeshBuilder(grid);
      for (let tileX = 0; tileX <= 5; tileX++) navBuilder.addTowerObstacle(tileX, 2);
      const physicsWorld = new PhysicsWorld(grid);
      const crowd = new CrowdManager(navBuilder.getNavMesh(), grid.tileSize, 4);
      const field = new NavDistanceField(grid, navBuilder);
      field.rebuild();
      try {
        const enemy = new Enemy("minion", 1, 0, grid, 1);
        physicsWorld.addEnemy(enemy);
        crowd.addAgent(enemy);
        const manager = { blockedApproach: (tileX, tileY) => field.getBlockedApproach(tileX, tileY) };
        enemy.computeIntent(fixedDt, manager);
        const approach = field.getBlockedApproach(3, 0);
        expect(approach).not.toBeNull();
        expect(enemy.lastMoveTargetWorld.x).toBeCloseTo(approach.approachWorld.x, 4);
        expect(enemy.lastMoveTargetWorld.y).toBeCloseTo(approach.approachWorld.y, 4);

        const startX = enemy.x;
        for (let step = 0; step < 180; step++) {
          enemy.computeIntent(fixedDt, manager);
          crowd.update(fixedDt, [enemy]);
          physicsWorld.step();
          enemy.postPhysics(fixedDt);
        }
        expect(enemy.x).toBeGreaterThan(startX + grid.tileSize);
      } finally {
        crowd.destroy();
        navBuilder.destroy();
        physicsWorld.dispose();
      }
    });

    it("with the seal removed, computeIntent without a lookup still targets the base", () => {
      const grid = makeSealedGrid();
      for (let tileX = 0; tileX <= 5; tileX++) grid.unregisterTower(tileX, 2);
      const navBuilder = new NavMeshBuilder(grid);
      const physicsWorld = new PhysicsWorld(grid);
      const crowd = new CrowdManager(navBuilder.getNavMesh(), grid.tileSize, 4);
      try {
        const enemy = new Enemy("minion", 1, 0, grid, 1);
        physicsWorld.addEnemy(enemy);
        crowd.addAgent(enemy);
        enemy.computeIntent(fixedDt, null);
        const baseWorld = grid.tileToWorld(grid.getBase().x, grid.getBase().y);
        expect(enemy.lastMoveTargetWorld.x).toBeCloseTo(baseWorld.x, 4);
        expect(enemy.lastMoveTargetWorld.y).toBeCloseTo(baseWorld.y, 4);
      } finally {
        crowd.destroy();
        navBuilder.destroy();
        physicsWorld.dispose();
      }
    });
  });
});
