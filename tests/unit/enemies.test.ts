// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { Detour } from "recast-navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIFFICULTY_MULT_TICK } from "@/sim/Constants.js";
import {
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  enemyLevelBounty,
  MIN_SLOW_FACTOR,
} from "@/sim/ConstantsEnemy.js";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { Grid } from "@/sim/grid/Grid.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
import { fromRecast } from "@/sim/navmesh/coords.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap, makeOneWideCornerMap } from "../helpers/mock-grid";
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

    it("applies bounty level growth, full through wave 10 and discounted after", () => {
      const early = new Enemy("minion", 4, 0, grid, 10, 0);
      const late = new Enemy("minion", 4, 0, grid, 11, 0);
      expect(early.bounty).toBe(enemyLevelBounty(ENEMY_TYPES.minion.bounty, 4, 10));
      expect(late.bounty).toBe(enemyLevelBounty(ENEMY_TYPES.minion.bounty, 4, 11));
      expect(late.bounty).toBeLessThan(early.bounty);
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

    it("sets knockResist from the type table (boss 0.8, tank 0.3)", () => {
      const boss = new Enemy("boss", 1, 0, grid, 1, 0);
      const tank = new Enemy("tank", 1, 0, grid, 1, 0);
      const minion = new Enemy("minion", 1, 0, grid, 1, 0);
      expect(boss.knockResist).toBe(0.8);
      expect(tank.knockResist).toBe(0.3);
      expect(minion.knockResist).toBe(0);
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

    it("returns the total damage applied including shield absorption", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 100;
      const damage = enemy.takeDamage(5);
      expect(damage).toBe(5);
      expect((enemy as { shield: number }).shield).toBe(95);
      expect(enemy.hp).toBe(enemy.maxHp);
    });

    it("returns absorbed plus HP damage on a partial shield hit", () => {
      const enemy = new Enemy("shielded", 1, 0, grid, 1, 0);
      (enemy as { shield: number }).shield = 3;
      const damage = enemy.takeDamage(10);
      expect(damage).toBeCloseTo(10, 4);
      expect((enemy as { shield: number }).shield).toBe(0);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
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

  describe("applyKnockback", () => {
    it("scales the impulse by (1 - knockResist)", () => {
      const minion = spawn("minion", 1, 0, 1);
      minion.moveAngle = 0;
      minion.applyKnockback(1);
      expect(minion.body!.linvel().x).toBeCloseTo(-8, 3);

      const tank = spawn("tank", 1, 0, 1);
      tank.moveAngle = 0;
      tank.applyKnockback(1);
      expect(tank.body!.linvel().x).toBeCloseTo(-8 * (1 - 0.3), 3);

      const boss = spawn("boss", 1, 0, 1);
      boss.moveAngle = 0;
      boss.applyKnockback(1);
      expect(boss.body!.linvel().x).toBeCloseTo(-8 * (1 - 0.8), 3);
    });

    it("does nothing when knockResist fully absorbs the impulse", () => {
      const minion = spawn("minion", 1, 0, 1);
      minion.knockResist = 1;
      minion.moveAngle = 0;
      minion.applyKnockback(1);
      expect(minion.body!.linvel().x).toBe(0);
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

    it("tracks the inflicting tower id on the stack", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(5, 3.0, "tower-3");
      expect(enemy.burnStack[0]!.sourceTowerId).toBe("tower-3");
    });

    it("updates the source tower when refreshing a similar stack", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(5, 1.0, "tower-a");
      enemy.applyBurn(5, 3.0, "tower-b");
      expect(enemy.burnStack).toHaveLength(1);
      expect(enemy.burnStack[0]!.timer).toBeCloseTo(3.0, 4);
      expect(enemy.burnStack[0]!.sourceTowerId).toBe("tower-b");
    });

    it("keeps the previous source when refreshing without a source id", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      enemy.applyBurn(5, 1.0, "tower-a");
      enemy.applyBurn(5, 3.0);
      expect(enemy.burnStack[0]!.sourceTowerId).toBe("tower-a");
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

    it("credits burn damage to the inflicting tower", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.hp = 100;
      enemy.applyBurn(5, 2.0, "tower-credit");
      const credits: { towerId: string; amount: number }[] = [];
      const enemyManager = {
        enemies: [enemy],
        getEnemiesInRange: () => [],
        forEachEnemyInRange: () => {},
        creditDamage: (towerId: string, amount: number) => credits.push({ towerId, amount }),
      };
      enemy.computeIntent(1.0, enemyManager);
      expect(credits).toHaveLength(1);
      expect(credits[0]!.towerId).toBe("tower-credit");
      expect(credits[0]!.amount).toBeCloseTo(5, 4);
    });

    it("ticks burn through shields but still applies resist", () => {
      const boss = new Enemy("boss", 1, 0, grid, 1, 0);
      boss.shield = 100;
      boss.applyBurn(10, 1.0, "tower-boss");
      const creditedAmounts: number[] = [];
      const enemyManager = {
        enemies: [boss],
        getEnemiesInRange: () => [],
        forEachEnemyInRange: () => {},
        creditDamage: (_towerId: string, amount: number) => creditedAmounts.push(amount),
      };
      boss.computeIntent(1.0, enemyManager);
      expect(boss.shield).toBe(100);
      expect(boss.hp).toBeCloseTo(boss.maxHp - 10 * (1 - boss.resist), 4);
      expect(creditedAmounts[0]).toBeCloseTo(10 * (1 - boss.resist), 4);
    });

    it("ticks burn without credit when the stack has no source tower", () => {
      const enemy = spawn("minion", 1, 0, 1);
      enemy.hp = 100;
      enemy.applyBurn(5, 2.0);
      const credit = vi.fn();
      const enemyManager = {
        enemies: [enemy],
        getEnemiesInRange: () => [],
        forEachEnemyInRange: () => {},
        creditDamage: credit,
      };
      enemy.computeIntent(1.0, enemyManager);
      expect(enemy.hp).toBeCloseTo(95, 4);
      expect(credit).not.toHaveBeenCalled();
    });

    it("integrates kinematically in postPhysics without a physics body", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const startX = enemy.x;
      const startY = enemy.y;
      enemy.lastMoveTargetWorld = { x: startX + grid.tileSize * 10, y: startY };
      expect(() => enemy.postPhysics(0.5)).not.toThrow();
      expect(enemy.x).toBeCloseTo(startX + enemy.speed * grid.tileSize * 0.5, 4);
      expect(enemy.y).toBeCloseTo(startY, 4);
      expect(enemy.moveAngle).toBeCloseTo(0, 4);
    });

    it("holds position in kinematic postPhysics while stunned", () => {
      const enemy = new Enemy("minion", 1, 0, grid, 1, 0);
      const startX = enemy.x;
      enemy.applyStun(1.0);
      enemy.lastMoveTargetWorld = { x: startX + grid.tileSize * 10, y: enemy.y };
      enemy.postPhysics(0.5);
      expect(enemy.x).toBe(startX);
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

  describe("lightning stun at a corner", () => {
    const fixedDt = 1 / 60;

    function assertCrowdTargetHeld(enemy: Enemy): void {
      expect(enemy.agent.state()).toBe(Detour.DT_CROWDAGENT_STATE_WALKING);
      const targetState = enemy.agent.raw.get_targetState();
      expect(targetState).not.toBe(Detour.DT_CROWDAGENT_TARGET_NONE);
      expect(targetState).not.toBe(Detour.DT_CROWDAGENT_TARGET_FAILED);
    }

    it("keeps the corridor while a neighbor has the rear enemy slowed, then walks the turn", () => {
      const grid = new Grid(makeOneWideCornerMap());
      const navBuilder = new NavMeshBuilder(grid);
      const physicsWorld = new PhysicsWorld(grid);
      physicsWorld.setEnemyEnemyCollisions(false);
      const crowd = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 4);
      try {
        const front = new Enemy("runner", 1, 0, grid, 1);
        const rear = new Enemy("runner", 1, 0, grid, 1);
        physicsWorld.addEnemy(front);
        physicsWorld.addEnemy(rear);
        crowd.addAgent(front);
        crowd.addAgent(rear);
        const spawnWorld = grid.tileToWorld(0, 4);
        const seat = (enemy: Enemy, worldX: number, worldY: number) => {
          enemy.body!.setTranslation({ x: worldX, y: worldY }, true);
          enemy.x = worldX;
          enemy.y = worldY;
          enemy.centerX = worldX;
          enemy.centerY = worldY;
          crowd.teleportAgent(enemy, { x: worldX, y: worldY });
        };
        // Centers sit inside the two runner radii so Detour separation is active.
        seat(front, spawnWorld.x + 4, spawnWorld.y);
        seat(rear, spawnWorld.x + 1, spawnWorld.y);

        const step = () => {
          front.computeIntent(fixedDt, null);
          rear.computeIntent(fixedDt, null);
          crowd.update(fixedDt, [front, rear]);
          physicsWorld.step();
          front.postPhysics(fixedDt);
          rear.postPhysics(fixedDt);
        };

        const approach = grid.tileToWorld(5, 4);
        let guard = 0;
        while (rear.x < approach.x && guard < 900) {
          step();
          guard++;
        }
        expect(guard).toBeLessThan(900);
        assertCrowdTargetHeld(rear);

        rear.applyStun(0.4);
        const stunX = rear.x;
        const stunY = rear.y;
        const stunnedSteps = Math.floor(0.35 / fixedDt);
        for (let stepIndex = 0; stepIndex < stunnedSteps; stepIndex++) step();

        expect(Math.hypot(rear.x - stunX, rear.y - stunY)).toBeLessThan(1);
        assertCrowdTargetHeld(rear);
        const agentPosition = fromRecast(rear.agent.position());
        const resyncThreshold = Math.max(rear.radius * 0.25, grid.tileSize * 0.15);
        expect(Math.hypot(rear.x - agentPosition.x, rear.y - agentPosition.y)).toBeLessThan(resyncThreshold);

        const resumeSteps = Math.ceil(0.5 / fixedDt) + Math.round(2 / fixedDt);
        for (let stepIndex = 0; stepIndex < resumeSteps; stepIndex++) step();
        expect(rear.agent.state()).toBe(Detour.DT_CROWDAGENT_STATE_WALKING);
        expect(rear.y).toBeGreaterThan(stunY + grid.tileSize * 0.5);
      } finally {
        crowd.destroy();
        navBuilder.destroy();
        physicsWorld.dispose();
      }
    });

    it("resyncs a body that sits off the navmesh without dropping the move target", () => {
      const grid = new Grid(makeOneWideCornerMap());
      const navBuilder = new NavMeshBuilder(grid);
      const physicsWorld = new PhysicsWorld(grid);
      physicsWorld.setEnemyEnemyCollisions(false);
      const crowd = new CrowdManager(navBuilder.getNavMesh()!, grid.tileSize, 4);
      try {
        const enemy = new Enemy("runner", 1, 0, grid, 1);
        physicsWorld.addEnemy(enemy);
        crowd.addAgent(enemy);
        for (let stepIndex = 0; stepIndex < 5; stepIndex++) {
          enemy.computeIntent(fixedDt, null);
          crowd.update(fixedDt, [enemy]);
          physicsWorld.step();
          enemy.postPhysics(fixedDt);
        }
        assertCrowdTargetHeld(enemy);

        const tile = enemy.currentTile();
        const northOfTile = grid.worldOriginY + tile.y * grid.tileSize - 10;
        enemy.body!.setTranslation({ x: enemy.x, y: northOfTile }, true);
        enemy.postPhysics(fixedDt);

        assertCrowdTargetHeld(enemy);
      } finally {
        crowd.destroy();
        navBuilder.destroy();
        physicsWorld.dispose();
      }
    });
  });
});
