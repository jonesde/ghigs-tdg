// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTILE_HIT_SLOP } from "@/sim/Constants.js";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import {
  BOUNCE_DAMAGE_FALLOFF,
  CHAIN_DAMAGE_FALLOFF,
  NAPALM_BURN_DPS_RATIO,
  NAPALM_BURN_DURATION,
  SPLASH_DAMAGE_RATIO,
} from "@/sim/ConstantsTower.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { Grid } from "@/sim/grid/Grid.js";
import {
  computeMaxHitCount,
  MAX_PENDING_LIGHTNING_EFFECTS,
  MAX_PENDING_STUN_EFFECTS,
  ProjectileManager,
} from "@/sim/ProjectileManager.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid.js";
import { makeParticleSystem } from "../helpers/mock-managers.js";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

interface MockEnemy {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius?: number;
  removed: boolean;
  flyingHeight?: number;
  takeDamage: (dmg: number) => void;
  applyBurn?: (dps: number, duration: number) => void;
  applySlow?: (factor: number, duration: number) => void;
  applyStun?: (duration: number) => void;
  applyKnockback?: (amount: number) => void;
}

interface MockEnemyManager {
  enemies: MockEnemy[];
  getEnemiesInRange: (x: number, y: number, range: number) => MockEnemy[];
  forEachEnemyInRange: (x: number, y: number, range: number, cb: (enemy: MockEnemy) => void) => void;
  getEnemyById: (id: number) => MockEnemy | null;
  castShapePierce: (
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    maxHits: number,
    cb: (enemy: MockEnemy) => boolean,
    groundOnly?: boolean,
  ) => void;
}

interface MockParticleSystem {
  spawns: Array<{ x: number; y: number; color: string; count: number; speed: number; life: number }>;
  spawn: (x: number, y: number, color: string, count: number, opts: { speed: number; life: number }) => void;
}

function createMockEnemy(
  opts: Partial<MockEnemy> & { id: number; x: number; y: number; hp: number; maxHp: number },
): MockEnemy {
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    hp: opts.hp,
    maxHp: opts.maxHp,
    radius: opts.radius,
    removed: opts.removed ?? false,
    flyingHeight: opts.flyingHeight,
    takeDamage: opts.takeDamage ?? vi.fn(),
    applyBurn: opts.applyBurn,
    applySlow: opts.applySlow,
    applyStun: opts.applyStun,
    applyKnockback: opts.applyKnockback,
  };
}

function createMockEnemyManager(enemies: MockEnemy[]): MockEnemyManager {
  return {
    enemies,
    getEnemiesInRange(x, y, range) {
      return enemies.filter((e) => {
        const dx = e.x - x;
        const dy = e.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= range;
      });
    },
    forEachEnemyInRange(x, y, range, cb) {
      for (const enemy of enemies) {
        if (enemy.removed) continue;
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        if (dx * dx + dy * dy <= range * range) cb(enemy);
      }
    },
    getEnemyById(id) {
      return enemies.find((e) => e.id === id) ?? null;
    },
    castShapePierce(originX, originY, dirX, dirY, ballRadius, maxDistance, maxHits, cb, groundOnly = false) {
      const length = Math.hypot(dirX, dirY) || 1;
      const unitX = dirX / length;
      const unitY = dirY / length;
      const candidates: { enemy: MockEnemy; projection: number }[] = [];
      for (const enemy of enemies) {
        if (enemy.removed) continue;
        if (groundOnly && (enemy.flyingHeight ?? 0) > 0) continue;
        const apx = enemy.x - originX;
        const apy = enemy.y - originY;
        const projection = Math.max(0, Math.min(maxDistance, apx * unitX + apy * unitY));
        const closestX = originX + unitX * projection;
        const closestY = originY + unitY * projection;
        const dist = Math.hypot(enemy.x - closestX, enemy.y - closestY);
        if (dist <= ballRadius + (enemy.radius ?? 0)) candidates.push({ enemy, projection });
      }
      candidates.sort((a, b) => a.projection - b.projection);
      let hits = 0;
      for (const candidate of candidates) {
        if (hits >= maxHits) break;
        hits++;
        if (!cb(candidate.enemy)) break;
      }
    },
  };
}

function createMockParticleSystem(): MockParticleSystem {
  const spawns: MockParticleSystem["spawns"] = [];
  return {
    spawns,
    spawn(x, y, color, count, opts) {
      spawns.push({ x, y, color, count, ...opts });
    },
  };
}

describe("ProjectileManager", () => {
  let manager: ProjectileManager;
  let enemyManager: MockEnemyManager;
  let particles: MockParticleSystem;

  beforeEach(() => {
    enemyManager = createMockEnemyManager([]);
    particles = createMockParticleSystem();
    manager = new ProjectileManager(enemyManager, particles);
  });

  describe("spawn()", () => {
    it("adds a projectile", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 200,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const renderData = manager.getRenderData();
      expect(renderData).toHaveLength(1);
    });

    it("sets initial position on the projectile", () => {
      manager.spawn({ x: 50, y: 75, damage: 10, speed: 200, range: 5, towerType: "arrow", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.x).toBe(50);
      expect(renderData[0]!.y).toBe(75);
    });

    it("sets radius based on tower type", () => {
      manager.spawn({ x: 0, y: 0, damage: 10, speed: 200, range: 5, towerType: "cannon", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(5);
    });

    it("sets default radius of 3 for other types", () => {
      manager.spawn({ x: 0, y: 0, damage: 10, speed: 200, range: 5, towerType: "arrow", towerLevel: 1, targetId: 1 });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(3);
    });
  });

  describe("tower damage credit", () => {
    it("creditDamage adds to the looked-up tower's totals", () => {
      const tower = { totalDamageDealt: 0, waveDamage: 0 };
      manager = new ProjectileManager(enemyManager, particles, (towerId) =>
        towerId === "tower-9" ? (tower as never) : null,
      );
      manager.creditDamage("tower-9", 12.5);
      expect(tower.totalDamageDealt).toBeCloseTo(12.5, 6);
      expect(tower.waveDamage).toBeCloseTo(12.5, 6);
      manager.creditDamage("missing", 5);
      expect(tower.totalDamageDealt).toBeCloseTo(12.5, 6);
    });
  });

  describe("circle projectile update", () => {
    it("moves toward target each frame", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const initialX = 100;
      manager.update(0.5);

      const renderData = manager.getRenderData();
      expect(renderData[0]!.x).toBeGreaterThan(initialX);
      expect(renderData[0]!.x).toBeLessThan(200);
    });

    it("removes projectile when target is removed and nothing ahead on path", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100, removed: true });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes projectile when target id not found and nothing ahead on path", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 999,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("retargets to enemy ahead on path when locked target is removed", () => {
      const deadTarget = createMockEnemy({ id: 1, x: 200, y: 200, hp: 0, maxHp: 100, removed: true });
      const aheadEnemy = createMockEnemy({ id: 2, x: 250, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([deadTarget, aheadEnemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 10,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.016);
      const renderData = manager.getRenderData();
      expect(renderData).toHaveLength(1);
      expect(renderData[0]!.x).toBeGreaterThan(100);
      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      expect(proj.targetId).toBe(2);
    });

    it("removes projectile when alternate enemy is behind the flight path", () => {
      const deadTarget = createMockEnemy({ id: 1, x: 200, y: 200, hp: 0, maxHp: 100, removed: true });
      const behindEnemy = createMockEnemy({ id: 2, x: 50, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([deadTarget, behindEnemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 10,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes projectile when alternate enemy is far off the flight path", () => {
      const deadTarget = createMockEnemy({ id: 1, x: 200, y: 200, hp: 0, maxHp: 100, removed: true });
      const offPathEnemy = createMockEnemy({ id: 2, x: 200, y: 400, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([deadTarget, offPathEnemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 10,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("skips already-hit enemies when retargeting along path", () => {
      const deadTarget = createMockEnemy({ id: 1, x: 200, y: 200, hp: 0, maxHp: 100, removed: true });
      const alreadyHit = createMockEnemy({ id: 2, x: 220, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([deadTarget, alreadyHit]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 10,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        targetX: 200,
        targetY: 200,
      });
      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.hitEnemyIds = new Set([2]);

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("hits target and removes projectile when close enough", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        critChance: 0,
      });

      manager.update(0.016);

      expect(takeDamage).toHaveBeenCalledWith(10, false);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("spawns particles on hit", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(particles.spawns).toHaveLength(1);
      expect(particles.spawns[0]!.count).toBe(3);
      expect(particles.spawns[0]!.speed).toBe(30);
      expect(particles.spawns[0]!.life).toBe(0.2);
    });

    it("applies crit damage when isCrit is true", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
        critChance: 1,
      });

      manager.update(0.016);

      expect(takeDamage).toHaveBeenCalledWith(20, false);
    });

    it("pierces to next target when maxHitCount > 0", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const enemy2 = createMockEnemy({ id: 2, x: 108, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      const takeDamage2 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 50,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
        pierce: 1,
        critChance: 0,
      });

      manager.update(0.016);
      expect(takeDamage1).toHaveBeenCalledWith(10, false);

      for (let step = 0; step < 20 && manager.getRenderData().length > 0; step++) {
        manager.update(0.016);
      }
      expect(takeDamage2).toHaveBeenCalled();
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes after piercing all targets", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemyManager = createMockEnemyManager([enemy1]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
        pierce: 0,
        critChance: 0,
      });

      manager.update(0.016);

      expect(takeDamage1).toHaveBeenCalledWith(10, false);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes projectile when target is beyond max range (no grid)", () => {
      const enemy = createMockEnemy({ id: 1, x: 5000, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("removes projectile when target is beyond max range (with grid)", () => {
      const enemy = createMockEnemy({ id: 1, x: 5000, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles, null, {
        width: 20,
        height: 20,
        tileSize: 36,
        tiles: [],
        blocked: new Set(),
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("keeps projectile when target is within max range", () => {
      const enemy = createMockEnemy({ id: 1, x: 260, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(1);
    });

    it("keeps projectile when target is exactly at max range boundary", () => {
      const enemy = createMockEnemy({ id: 1, x: 280, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(1);
    });
  });

  describe("lightning chain", () => {
    it("chains damage through nearest enemies and emits a flash per hop", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 1000, maxHp: 1000 });
      const enemy2 = createMockEnemy({ id: 2, x: 108, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamage1 = vi.fn();
      const takeDamage2 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      // Force non-crit so damage values are deterministic (injected rng, not Math.random)
      manager = new ProjectileManager(
        enemyManager,
        particles,
        null,
        { width: 10, height: 10, tileSize: 36, tiles: [], blocked: new Set() },
        () => 0.99,
      );

      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 1, targetId: 1, stunDuration: 0.1 });

      // enemy1: initial target, full damage (no ping-pong re-hit)
      expect(takeDamage1).toHaveBeenCalledWith(20);
      // enemy2: single chain hop from enemy1 (falloff applied once); not re-chained
      expect(takeDamage2).toHaveBeenCalledWith(20 * 0.8 ** 1);
      const effects = manager.getRenderVisualEffects();
      // 1 tower->target flash + 1 chain hop flash
      expect(effects.lightning).toHaveLength(2);
    });

    it("chains more hops at higher tower level", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 10000, maxHp: 10000 });
      const enemy2 = createMockEnemy({ id: 2, x: 135, y: 200, hp: 10000, maxHp: 10000 });
      const enemy3 = createMockEnemy({ id: 3, x: 165, y: 200, hp: 10000, maxHp: 10000 });
      const enemy4 = createMockEnemy({ id: 4, x: 195, y: 200, hp: 10000, maxHp: 10000 });
      enemyManager = createMockEnemyManager([enemy1, enemy2, enemy3, enemy4]);
      manager = new ProjectileManager(enemyManager, particles, null, {
        width: 10,
        height: 10,
        tileSize: 36,
        tiles: [],
        blocked: new Set(),
      });

      // Level 1 -> tier 0 -> 2 chain hops (origin flash + 2 hops = 3 sparks)
      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 1, targetId: 1, stunDuration: 0.1 });
      expect(manager.getRenderVisualEffects().lightning).toHaveLength(3);
      manager.clear();

      // Level 5 -> tier 1 -> 3 chain hops (origin flash + 3 hops = 4 sparks)
      manager.fireLightning({ originX: 100, originY: 200, damage: 20, towerLevel: 5, targetId: 1, stunDuration: 0.1 });
      expect(manager.getRenderVisualEffects().lightning).toHaveLength(4);
    });
  });

  describe("napalm burn", () => {
    it("applies burn to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applyBurn = vi.fn();
      enemy.applyBurn = applyBurn;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 100,
        speed: 100,
        range: 5,
        towerType: "cannon",
        towerLevel: 1,
        targetId: 1,
        napalm: true,
      });

      manager.update(0.016);

      expect(applyBurn).toHaveBeenCalledWith(100 * NAPALM_BURN_DPS_RATIO, NAPALM_BURN_DURATION, "");
    });
  });

  describe("railgun knockback and stun", () => {
    it("applies knockback to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemy.applyKnockback = (amount) => {
        enemy.x -= amount;
      };
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 5,
        targetId: 1,
        knockbackBase: 0.5,
        knockbackScale: 0.2,
      });

      const initialX = enemy.x;
      manager.update(0.016);

      expect(enemy.x).not.toBe(initialX);
    });

    it("applies stun to target", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applyStun = vi.fn();
      enemy.applyStun = applyStun;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(applyStun).toHaveBeenCalledWith(0.3);
    });
  });

  describe("getRenderData()", () => {
    it("returns an inactive projectile still in the list as the impact frame", () => {
      const enemy = createMockEnemy({ id: 1, x: 200, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.active = false;

      expect(manager.getRenderData()).toHaveLength(1);
      expect(manager.getRenderData()[0]!.x).toBe(100);

      manager.update(0.016);
      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("includes radius and color", () => {
      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      const renderData = manager.getRenderData();
      expect(renderData[0]!.radius).toBe(3);
      expect(renderData[0]!.color).toBe("#ffcf4d");
    });
  });

  describe("clear()", () => {
    it("removes all projectiles", () => {
      enemyManager = createMockEnemyManager([
        { id: 1, x: 200, y: 200, hp: 100, maxHp: 100, removed: false, takeDamage: vi.fn() },
      ]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });
      manager.spawn({
        x: 150,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
      });

      manager.clear();

      expect(manager.getRenderData()).toHaveLength(0);
    });
  });

  describe("no particle system", () => {
    it("does not crash when particles is null", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, null);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      expect(() => manager.update(0.016)).not.toThrow();
    });
  });

  describe("ice slow", () => {
    it("applies slow to enemy on hit", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applySlow = vi.fn();
      enemy.applySlow = applySlow;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 4,
        speed: 100,
        range: 5,
        towerType: "ice",
        towerLevel: 1,
        targetId: 1,
        slowAmt: 0.45,
        slowDur: 1.5,
      });

      // biome-ignore lint/suspicious/noExplicitAny: tests access private projectiles array
      const proj = (manager as any).projectiles[0]!;
      proj.isCrit = false;

      manager.update(0.016);

      expect(applySlow).toHaveBeenCalledWith(0.45, 1.5);
    });

    it("does not apply slow when slowAmt is 0", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applySlow = vi.fn();
      enemy.applySlow = applySlow;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "arrow",
        towerLevel: 1,
        targetId: 1,
      });

      manager.update(0.016);

      expect(applySlow).not.toHaveBeenCalled();
    });
  });

  describe("bounce shot status falloff", () => {
    it("scales burn, slow, and stun magnitudes by BOUNCE_DAMAGE_FALLOFF on the bounced hit", () => {
      const firstApplyBurn = vi.fn();
      const secondApplyBurn = vi.fn();
      const secondApplySlow = vi.fn();
      const secondApplyStun = vi.fn();
      const enemy1 = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100, applyBurn: firstApplyBurn });
      const enemy2 = createMockEnemy({
        id: 2,
        x: 115,
        y: 200,
        hp: 100,
        maxHp: 100,
        applyBurn: secondApplyBurn,
        applySlow: secondApplySlow,
        applyStun: secondApplyStun,
      });
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "cannon",
        towerLevel: 1,
        targetId: 1,
        napalm: true,
        slowAmt: 0.5,
        slowDur: 1,
        stunDur: 0.4,
        bounceShot: true,
      });

      for (let step = 0; step < 30 && manager.getRenderData().length > 0; step++) {
        manager.update(0.016);
      }

      const burnDps = 10 * NAPALM_BURN_DPS_RATIO;
      expect(firstApplyBurn).toHaveBeenCalledWith(burnDps, NAPALM_BURN_DURATION, "");
      expect(secondApplyBurn).toHaveBeenCalledWith(burnDps * BOUNCE_DAMAGE_FALLOFF, NAPALM_BURN_DURATION, "");
      expect(secondApplySlow).toHaveBeenCalledWith(0.5 * BOUNCE_DAMAGE_FALLOFF, 1);
      expect(secondApplyStun).toHaveBeenCalledWith(0.4 * BOUNCE_DAMAGE_FALLOFF);
    });
  });

  describe("stun-triggered lightning flash gating", () => {
    it("fires lightning flash for lightning tower stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.fireLightning({ originX: 100, originY: 200, damage: 4, towerLevel: 1, targetId: 1, stunDuration: 0.1 });

      const effects = manager.getRenderVisualEffects();
      // Tower->target flash originates from the tower (origin), not the enemy pos
      const stunFlash = effects.lightning.find((spark) => spark.x1 === 100 && spark.y1 === 200);
      expect(stunFlash).toBeDefined();
    });

    it("does not fire lightning flash for railgun stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 104,
        y: 200,
        damage: 10,
        speed: 100,
        range: 5,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
        critChance: 0,
      });

      manager.update(0.016);

      const effects = manager.getRenderVisualEffects();
      const stunFlash = effects.lightning.find((spark) => spark.x1 === 104 && spark.y1 === 200);
      expect(stunFlash).toBeUndefined();
    });

    it("does not fire lightning flash for sniper stun", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 104,
        y: 200,
        damage: 32,
        speed: 100,
        range: 5,
        towerType: "sniper",
        towerLevel: 5,
        targetId: 1,
        critChance: 0,
      });

      manager.update(0.016);

      const effects = manager.getRenderVisualEffects();
      const stunFlash = effects.lightning.find((spark) => spark.x1 === 104 && spark.y1 === 200);
      expect(stunFlash).toBeUndefined();
    });
  });

  describe("sniper stun", () => {
    it("sniper projectile applies stun to enemy on hit", () => {
      const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100 });
      const applyStun = vi.fn();
      enemy.applyStun = applyStun;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 32,
        speed: 100,
        range: 5,
        towerType: "sniper",
        towerLevel: 1,
        targetId: 1,
        stunDur: 0.2,
      });

      manager.update(0.016);

      expect(applyStun).toHaveBeenCalledWith(0.2);
    });
  });

  describe("fixed-aim projectile (targetId === 0)", () => {
    it("travels toward target position without enemy lookup", () => {
      enemyManager = createMockEnemyManager([]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 200,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 300,
        targetY: 200,
      });

      manager.update(0.5);

      const renderData = manager.getRenderData();
      expect(renderData).toHaveLength(1);
      expect(renderData[0]!.x).toBeCloseTo(200, 0);
      expect(renderData[0]!.y).toBe(200);
    });

    it("does not get removed on frame one when no enemy has id 0", () => {
      enemyManager = createMockEnemyManager([]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 200,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 300,
        targetY: 200,
      });

      manager.update(0.016);

      expect(manager.getRenderData()).toHaveLength(1);
    });

    it("hits enemy along the path", () => {
      const enemy = createMockEnemy({ id: 1, x: 180, y: 200, hp: 100, maxHp: 100 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 25,
        speed: 160,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 400,
        targetY: 200,
      });

      manager.update(0.5);

      expect(takeDamage).toHaveBeenCalled();
      expect(takeDamage.mock.calls[0][0]).toBe(25);
    });

    it("pierces through multiple enemies along the path", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      const enemy2 = createMockEnemy({ id: 2, x: 180, y: 200, hp: 100, maxHp: 100 });
      const takeDamage2 = vi.fn();
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 20,
        speed: 160,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 400,
        targetY: 200,
        pierce: 2,
      });

      manager.update(0.5);

      expect(takeDamage1).toHaveBeenCalled();
      expect(takeDamage1.mock.calls[0][0]).toBe(20);
      expect(takeDamage2).toHaveBeenCalled();
      expect(takeDamage2.mock.calls[0][0]).toBe(20);
    });

    it("expires at target position when no enemies in path", () => {
      enemyManager = createMockEnemyManager([]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 200,
        targetY: 200,
      });

      manager.update(0.5);

      expect(manager.getRenderData()).toHaveLength(0);
    });

    it("stops after piercing through all allowed targets", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      const enemy2 = createMockEnemy({ id: 2, x: 180, y: 200, hp: 100, maxHp: 100 });
      const takeDamage2 = vi.fn();
      enemy2.takeDamage = takeDamage2;
      const enemy3 = createMockEnemy({ id: 3, x: 300, y: 200, hp: 100, maxHp: 100 });
      const takeDamage3 = vi.fn();
      enemy3.takeDamage = takeDamage3;
      enemyManager = createMockEnemyManager([enemy1, enemy2, enemy3]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 20,
        speed: 160,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 500,
        targetY: 200,
        pierce: 1,
      });

      manager.update(0.5);

      expect(takeDamage1).toHaveBeenCalled();
      expect(takeDamage1.mock.calls[0][0]).toBe(20);
      expect(takeDamage2).toHaveBeenCalled();
      expect(takeDamage2.mock.calls[0][0]).toBe(20);
      expect(takeDamage3).not.toHaveBeenCalled();
    });
  });

  describe("splash forwarding (C2)", () => {
    it("applies splash damage to nearby enemies using the forwarded splash radius", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      const enemy2 = createMockEnemy({ id: 2, x: 130, y: 200, hp: 100, maxHp: 100 });
      const takeDamage2 = vi.fn();
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles, null, {
        width: 10,
        height: 10,
        tileSize: 36,
        tiles: [],
        blocked: new Set(),
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "ice",
        towerLevel: 1,
        targetId: 1,
        splash: 1,
      });

      manager.update(0.5);

      expect(takeDamage1).toHaveBeenCalledWith(10, false);
      // splash radius = 1 * tileSize(36) = 36px; enemy2 at 30px away is within it.
      // Splash damage must forward the projectile's armorPiercing flag,
      // which is false here — consistency with the primary target.
      expect(takeDamage2).toHaveBeenCalledWith(10 * SPLASH_DAMAGE_RATIO, false);
    });

    it("forwards the armorPiercing flag to splash secondary targets", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100 });
      const enemy2 = createMockEnemy({ id: 2, x: 130, y: 200, hp: 100, maxHp: 100 });
      const takeDamage2 = vi.fn();
      enemy2.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([enemy1, enemy2]);
      manager = new ProjectileManager(enemyManager, particles, null, {
        width: 10,
        height: 10,
        tileSize: 36,
        tiles: [],
        blocked: new Set(),
      });

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "ice",
        towerLevel: 1,
        targetId: 1,
        splash: 1,
        armorPiercing: true,
      });

      manager.update(0.5);

      // Shielded/secondary enemies must have shields bypassed, matching the primary.
      expect(takeDamage2).toHaveBeenCalledWith(10 * SPLASH_DAMAGE_RATIO, true);
    });
  });

  describe("ground-only projectiles (flying enemies)", () => {
    const grid = { width: 10, height: 10, tileSize: 36, tiles: [], blocked: new Set() };

    it("a ground-only projectile's contact hit passes over a flying enemy", () => {
      const flyer = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100, flyingHeight: 2 });
      const takeDamage = vi.fn();
      flyer.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([flyer]);
      manager = new ProjectileManager(enemyManager, particles, null, grid);

      manager.spawn({
        x: 90,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "cannon",
        towerLevel: 1,
        targetId: 0,
        targetX: 200,
        targetY: 200,
        groundOnly: true,
      });
      const projectileId = manager.getRenderData()[0].id;

      manager.postPhysics(0.016, [{ projectileId, enemyId: flyer.id }]);

      expect(takeDamage).not.toHaveBeenCalled();
    });

    it("an air-capable projectile's contact hit still damages a flying enemy", () => {
      const flyer = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100, flyingHeight: 2 });
      const takeDamage = vi.fn();
      flyer.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([flyer]);
      manager = new ProjectileManager(enemyManager, particles, null, grid);

      manager.spawn({
        x: 90,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "basic",
        towerLevel: 1,
        targetId: 0,
        targetX: 200,
        targetY: 200,
      });
      const projectileId = manager.getRenderData()[0].id;

      manager.postPhysics(0.016, [{ projectileId, enemyId: flyer.id }]);

      expect(takeDamage).toHaveBeenCalled();
    });

    it("splash from a ground-only projectile skips a flying enemy in the radius", () => {
      const ground = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100, flyingHeight: 0 });
      const takeDamage1 = vi.fn();
      ground.takeDamage = takeDamage1;
      const flyer = createMockEnemy({ id: 2, x: 130, y: 200, hp: 100, maxHp: 100, flyingHeight: 2 });
      const takeDamage2 = vi.fn();
      flyer.takeDamage = takeDamage2;
      enemyManager = createMockEnemyManager([ground, flyer]);
      manager = new ProjectileManager(enemyManager, particles, null, grid);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "cannon",
        towerLevel: 1,
        targetId: 1,
        splash: 1,
        groundOnly: true,
      });

      manager.update(0.5);

      expect(takeDamage1).toHaveBeenCalledWith(10, false);
      expect(takeDamage2).not.toHaveBeenCalled();
    });

    it("pierce re-targeting skips a flying enemy and holds out for a ground enemy", () => {
      const target = createMockEnemy({ id: 1, x: 105, y: 200, hp: 100, maxHp: 100, flyingHeight: 0 });
      const flyer = createMockEnemy({ id: 2, x: 108, y: 200, hp: 100, maxHp: 100, flyingHeight: 5 });
      const takeDamage2 = vi.fn();
      flyer.takeDamage = takeDamage2;
      const behind = createMockEnemy({ id: 3, x: 140, y: 200, hp: 100, maxHp: 100, flyingHeight: 0 });
      const takeDamage3 = vi.fn();
      behind.takeDamage = takeDamage3;
      enemyManager = createMockEnemyManager([target, flyer, behind]);
      manager = new ProjectileManager(enemyManager, particles, null, grid);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 100,
        range: 50,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 1,
        pierce: 1,
        critChance: 0,
        groundOnly: true,
      });

      manager.update(0.016);
      for (let step = 0; step < 40 && manager.getRenderData().length > 0; step++) {
        manager.update(0.016);
      }

      expect(takeDamage3).toHaveBeenCalled();
      expect(takeDamage2).not.toHaveBeenCalled();
    });

    it("fixed-aim pierce spends every hit slot on ground enemies and skips flyers", () => {
      const ground1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100, flyingHeight: 0 });
      const flyer = createMockEnemy({ id: 2, x: 140, y: 200, hp: 100, maxHp: 100, flyingHeight: 5 });
      const takeDamage2 = vi.fn();
      flyer.takeDamage = takeDamage2;
      const ground2 = createMockEnemy({ id: 3, x: 180, y: 200, hp: 100, maxHp: 100, flyingHeight: 0 });
      const takeDamage3 = vi.fn();
      ground2.takeDamage = takeDamage3;
      enemyManager = createMockEnemyManager([ground1, flyer, ground2]);
      manager = new ProjectileManager(enemyManager, particles, null, grid);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 20,
        speed: 160,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 500,
        targetY: 200,
        pierce: 1,
        groundOnly: true,
      });

      manager.update(0.5);

      expect(ground1.takeDamage).toHaveBeenCalled();
      expect(takeDamage3).toHaveBeenCalled();
      expect(takeDamage2).not.toHaveBeenCalled();
    });
  });

  describe("instant-kill armor piercing (H2)", () => {
    it("passes armorPiercing to takeDamage for trueShot", () => {
      const enemy = createMockEnemy({ id: 1, x: 100, y: 200, hp: 50, maxHp: 50 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      // Force the trueShot roll to succeed via injected rng (not Math.random)
      manager = new ProjectileManager(enemyManager, particles, null, null, () => 0);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "sniper",
        towerLevel: 1,
        targetId: 1,
        trueShot: 1,
      });
      manager.update(0.5);

      expect(takeDamage).toHaveBeenCalledWith(51, true);
    });

    it("passes armorPiercing to takeDamage for marksman", () => {
      const enemy = createMockEnemy({ id: 1, x: 100, y: 200, hp: 50, maxHp: 50 });
      const takeDamage = vi.fn();
      enemy.takeDamage = takeDamage;
      enemyManager = createMockEnemyManager([enemy]);
      // Force the marksman roll to succeed via injected rng (not Math.random)
      manager = new ProjectileManager(enemyManager, particles, null, null, () => 0);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 10,
        speed: 1000,
        range: 5,
        towerType: "sniper",
        towerLevel: 1,
        targetId: 1,
        marksman: true,
      });
      manager.update(0.5);

      expect(takeDamage).toHaveBeenCalledWith(51, true);
    });
  });

  describe("fixed-aim pierce keeps aim (H3)", () => {
    it("does not re-home onto an off-axis enemy while piercing", () => {
      const enemy1 = createMockEnemy({ id: 1, x: 100, y: 200, hp: 100, maxHp: 100 });
      const takeDamage1 = vi.fn();
      enemy1.takeDamage = takeDamage1;
      const enemy2 = createMockEnemy({ id: 2, x: 180, y: 200, hp: 100, maxHp: 100 });
      const takeDamage2 = vi.fn();
      enemy2.takeDamage = takeDamage2;
      // Off-axis enemy near enemy2 but not on the straight aim line y=200
      const enemy3 = createMockEnemy({ id: 3, x: 180, y: 260, hp: 100, maxHp: 100 });
      const takeDamage3 = vi.fn();
      enemy3.takeDamage = takeDamage3;
      enemyManager = createMockEnemyManager([enemy1, enemy2, enemy3]);
      manager = new ProjectileManager(enemyManager, particles);

      manager.spawn({
        x: 100,
        y: 200,
        damage: 20,
        speed: 160,
        range: 10,
        towerType: "railgun",
        towerLevel: 1,
        targetId: 0,
        targetX: 500,
        targetY: 200,
        pierce: 1,
      });

      manager.update(0.5);

      expect(takeDamage1).toHaveBeenCalled();
      expect(takeDamage2).toHaveBeenCalled();
      // enemy3 is off the aim line; fixed-aim must not re-home onto it
      expect(takeDamage3).not.toHaveBeenCalled();
    });
  });

  describe("findNearestEnemy nearest-in-ring (H4)", () => {
    it("targets the closest enemy for the first chain hop when >8 enemies are in range", () => {
      const target = createMockEnemy({ id: 1, x: 102, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamageTarget = vi.fn();
      target.takeDamage = takeDamageTarget;
      // The nearest enemy lives alone in the innermost ring (<=18px)
      const near = createMockEnemy({ id: 2, x: 107, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamageNear = vi.fn();
      near.takeDamage = takeDamageNear;
      // A farther enemy outside both inner rings but still in chain range
      const far = createMockEnemy({ id: 3, x: 162, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamageFar = vi.fn();
      far.takeDamage = takeDamageFar;

      const enemies = [target, near, far];
      // Filler enemies (8) sit in the outer inner ring (~26px) to force the >8 branch
      for (let i = 4; i <= 11; i++) {
        enemies.push(createMockEnemy({ id: i, x: 128, y: 200, hp: 1000, maxHp: 1000 }));
      }
      const takeDamageFiller = enemies.slice(3).map((e) => {
        const fn = vi.fn();
        e.takeDamage = fn;
        return fn;
      });

      enemyManager = createMockEnemyManager(enemies);
      manager = new ProjectileManager(
        enemyManager,
        particles,
        null,
        { width: 10, height: 10, tileSize: 36, tiles: [], blocked: new Set() },
        () => 0.99,
      );

      // chain:1 -> a single chain hop that must target the nearest (enemy2)
      manager.fireLightning({
        originX: 100,
        originY: 200,
        damage: 20,
        towerLevel: 1,
        targetId: 1,
        stunDuration: 0,
        chain: 1,
      });

      expect(takeDamageNear).toHaveBeenCalledWith(20 * CHAIN_DAMAGE_FALLOFF);
      expect(takeDamageFar).not.toHaveBeenCalled();
      expect(takeDamageFiller.every((fn) => fn.mock.calls.length === 0)).toBe(true);
    });
  });

  describe("lightning chain + stormcall forwarding (C3)", () => {
    it("honors a forwarded chain count instead of the default", () => {
      const enemies = [createMockEnemy({ id: 1, x: 102, y: 200, hp: 10000, maxHp: 10000 })];
      for (let i = 2; i <= 7; i++) {
        enemies.push(createMockEnemy({ id: i, x: 100 + i * 2, y: 200, hp: 10000, maxHp: 10000 }));
      }
      enemyManager = createMockEnemyManager(enemies);
      manager = new ProjectileManager(enemyManager, particles, null, {
        width: 10,
        height: 10,
        tileSize: 36,
        tiles: [],
        blocked: new Set(),
      });

      // chain:5 at tier 0 -> 5 chain hops + 1 tower->target flash = 6 sparks
      manager.fireLightning({
        originX: 100,
        originY: 200,
        damage: 20,
        towerLevel: 1,
        targetId: 1,
        stunDuration: 0.1,
        chain: 5,
      });
      expect(manager.getRenderVisualEffects().lightning).toHaveLength(6);
    });

    it("stormcall strikes a random enemy in a wide area", () => {
      const target = createMockEnemy({ id: 1, x: 100, y: 200, hp: 1000, maxHp: 1000 });
      const chainEnemy = createMockEnemy({ id: 2, x: 110, y: 200, hp: 1000, maxHp: 1000 });
      const wideEnemy = createMockEnemy({ id: 3, x: 250, y: 200, hp: 1000, maxHp: 1000 });
      const takeDamageWide = vi.fn();
      wideEnemy.takeDamage = takeDamageWide;
      const applyStunWide = vi.fn();
      wideEnemy.applyStun = applyStunWide;

      enemyManager = createMockEnemyManager([target, chainEnemy, wideEnemy]);
      manager = new ProjectileManager(
        enemyManager,
        particles,
        null,
        { width: 10, height: 10, tileSize: 36, tiles: [], blocked: new Set() },
        () => 0.99,
      );

      manager.fireLightning({
        originX: 100,
        originY: 200,
        damage: 20,
        towerLevel: 1,
        targetId: 1,
        stunDuration: 0.1,
        stormcall: true,
      });

      // wideEnemy is outside chain range (CHAIN_RANGE*36 = 72px) but within the
      // stormcall wide range (3*72 = 216px), so it must be struck.
      expect(takeDamageWide).toHaveBeenCalledWith(20 * CHAIN_DAMAGE_FALLOFF);
      expect(applyStunWide).toHaveBeenCalledWith(0.1);
      const effects = manager.getRenderVisualEffects();
      // chain hop flash + stormcall flash + tower->target flash = 3 lightning bolts
      expect(effects.lightning).toHaveLength(3);
      // stun effect on wideEnemy
      expect(effects.stuns).toHaveLength(3);
      expect(effects.stuns.map((s) => s.x).includes(wideEnemy.x)).toBe(true);
      expect(effects.stuns.map((s) => s.y).includes(wideEnemy.y)).toBe(true);
    });
  });

  describe("findNearestEnemy visitor equivalence (Finding 5)", () => {
    // Uses a REAL EnemyManager so the spatial-hash iteration order is exercised,
    // and compares findNearestEnemy (visitor-based) against an independent
    // getEnemiesInRange + reduce reference — the old array-returning path.
    let manager: ProjectileManager;
    let enemyManager: EnemyManager;
    let grid: Grid;

    beforeEach(() => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const themeStore = useMapThemeStore();
      themeStore.defaultTheme = mockDefaultTheme;
      themeStore.activeTheme = mockDefaultTheme;

      // Deterministic enemy ids (1,2,3,...) so getEnemyById resolves after spawn.
      resetEnemyId();
      const map = makeBastionMap();
      grid = new Grid(map);
      const particles = makeParticleSystem();
      enemyManager = new EnemyManager(grid, particles, 0);
      manager = new ProjectileManager(enemyManager, particles);
    });

    // Spawn an enemy and place it at an explicit position. Enemy ids are assigned
    // naturally (1,2,3,...) because beforeEach resets the module id counter, so
    // getEnemyById resolves correctly. This EnemyManager has no physics world, so
    // range queries read enemy.x/enemy.y directly and no re-hash step is needed.
    function makeEnemy(x: number, y: number) {
      const enemy = enemyManager.spawn("minion", 1, 0, 1)!;
      enemy.x = x;
      enemy.y = y;
      enemy.takeDamage = vi.fn();
      return enemy;
    }

    function expectedNearest(originX: number, originY: number, range: number, excludeId: number) {
      const inRange = enemyManager.getEnemiesInRange(originX, originY, range);
      let best: { id: number; x: number; y: number } | null = null;
      let bestDistSquared = Infinity;
      for (const e of inRange) {
        if (e.id === excludeId) continue;
        const dx = e.x - originX;
        const dy = e.y - originY;
        const d = dx * dx + dy * dy;
        if (d < bestDistSquared) {
          bestDistSquared = d;
          best = e;
        }
      }
      return best;
    }

    function chainRangePx(): number {
      // CHAIN_RANGE (from ProjectileManager) * GRID_TILE_SIZE (36).
      return 2 * 36;
    }

    it("selects the same nearest enemy as the getEnemiesInRange reference", () => {
      const origin = { x: 100, y: 200 };
      const target = makeEnemy(102, 200);
      const near = makeEnemy(107, 200);
      const far = makeEnemy(162, 200);

      const expected = expectedNearest(target.x, target.y, chainRangePx(), target.id);
      expect(expected?.id).toBe(near.id);

      // Force non-crit via injected rng (not Math.random)
      manager.setRng(() => 0.99);
      manager.fireLightning({
        originX: origin.x,
        originY: origin.y,
        damage: 20,
        towerLevel: 1,
        targetId: target.id,
        stunDuration: 0,
        chain: 1,
      });

      expect(near.takeDamage).toHaveBeenCalledWith(16);
      expect(far.takeDamage).not.toHaveBeenCalled();
    });

    it("honors the equal-distance tie-break (first-found wins via strict <)", () => {
      const origin = { x: 100, y: 200 };
      const target = makeEnemy(102, 200);
      // Two enemies at exactly equal distance (5px) from the target.
      const left = makeEnemy(97, 200);
      const right = makeEnemy(107, 200);

      const expected = expectedNearest(target.x, target.y, chainRangePx(), target.id);
      // First-found in spatial-hash order wins; the reference reduce must agree.
      expect(expected?.id).toBe(left.id);

      // Force non-crit via injected rng (not Math.random)
      manager.setRng(() => 0.99);
      manager.fireLightning({
        originX: origin.x,
        originY: origin.y,
        damage: 20,
        towerLevel: 1,
        targetId: target.id,
        stunDuration: 0,
        chain: 1,
      });

      expect(left.takeDamage).toHaveBeenCalledWith(16);
      expect(right.takeDamage).not.toHaveBeenCalled();
    });
  });
});

const HIT_STEP_DT = 0.02;
const HIT_STEP_SPEED = 100;
const HIT_MOVE_DIST = HIT_STEP_SPEED * HIT_STEP_DT;
const GLYPH_RADIUS = 3;

function configuredColliderRadius(enemyType: string): number {
  return ENEMY_TYPES[enemyType].radius * 36 * 0.5;
}

function hitReach(enemyRadius: number): number {
  return GLYPH_RADIUS + PROJECTILE_HIT_SLOP + enemyRadius + HIT_MOVE_DIST;
}

function shotDamagedEnemy(enemyRadius: number, gap: number, fixedAim: boolean): boolean {
  const enemy = createMockEnemy({ id: 1, x: gap, y: 0, hp: 100, maxHp: 100, radius: enemyRadius });
  const takeDamage = vi.fn();
  enemy.takeDamage = takeDamage;
  const shotManager = new ProjectileManager(createMockEnemyManager([enemy]), makeParticleSystem());
  shotManager.spawn({
    x: 0,
    y: 0,
    damage: 10,
    speed: HIT_STEP_SPEED,
    range: 30,
    towerType: "basic",
    towerLevel: 1,
    targetId: fixedAim ? 0 : 1,
    targetX: 1000,
    targetY: 0,
    critChance: 0,
  });
  shotManager.update(HIT_STEP_DT);
  return takeDamage.mock.calls.length > 0;
}

describe("projectile hit reach uses the enemy radius", () => {
  const runnerRadius = configuredColliderRadius("runner");
  const bossRadius = configuredColliderRadius("boss");

  for (const fixedAim of [false, true]) {
    const aimLabel = fixedAim ? "fixed-aim" : "homing";

    it(`${aimLabel} misses a runner outside glyph + radius + slop + step`, () => {
      expect(shotDamagedEnemy(runnerRadius, hitReach(runnerRadius) + 0.25, fixedAim)).toBe(false);
    });

    it(`${aimLabel} hits a runner once the step meets that reach`, () => {
      expect(shotDamagedEnemy(runnerRadius, hitReach(runnerRadius) - 0.05, fixedAim)).toBe(true);
    });

    it(`${aimLabel} hit gap grows with the boss radius instead of a shared pad`, () => {
      const between = (hitReach(runnerRadius) + hitReach(bossRadius)) / 2;
      expect(between - hitReach(runnerRadius)).toBeCloseTo((bossRadius - runnerRadius) / 2, 5);
      expect(shotDamagedEnemy(runnerRadius, between, fixedAim)).toBe(false);
      expect(shotDamagedEnemy(bossRadius, between, fixedAim)).toBe(true);
    });
  }

  it("postPhysics keeps the snapped glyph until the next prePhysics", () => {
    const enemyRadius = runnerRadius;
    const gap = hitReach(enemyRadius) - 0.05;
    const enemy = createMockEnemy({ id: 1, x: gap, y: 0, hp: 100, maxHp: 100, radius: enemyRadius });
    const shotManager = new ProjectileManager(createMockEnemyManager([enemy]), makeParticleSystem());
    shotManager.spawn({
      x: 0,
      y: 0,
      damage: 10,
      speed: HIT_STEP_SPEED,
      range: 30,
      towerType: "basic",
      towerLevel: 1,
      targetId: 1,
      targetX: gap,
      targetY: 0,
      critChance: 0,
    });

    shotManager.postPhysics(HIT_STEP_DT, []);
    const renderData = shotManager.getRenderData();
    expect(renderData).toHaveLength(1);
    expect(renderData[0]!.x).toBeCloseTo(gap - enemyRadius, 5);

    shotManager.prePhysics(HIT_STEP_DT);
    expect(shotManager.getRenderData()).toHaveLength(0);
  });
});

describe("pending visual-effect caps (Block D2)", () => {
  it("caps lightning/stun buffers with a drop-oldest policy under a long stall", () => {
    const enemy = createMockEnemy({ id: 1, x: 105, y: 200, hp: 1e9, maxHp: 1e9 });
    const manager = new ProjectileManager(createMockEnemyManager([enemy]), createMockParticleSystem());

    for (let call = 0; call < MAX_PENDING_LIGHTNING_EFFECTS + 20; call++) {
      manager.fireLightning({ originX: 100, originY: 200, damage: 1, towerLevel: 1, targetId: 1, stunDuration: 0.1 });
    }

    const effects = manager.getRenderVisualEffects();
    expect(effects.lightning).toHaveLength(MAX_PENDING_LIGHTNING_EFFECTS);
    expect(effects.stuns).toHaveLength(MAX_PENDING_STUN_EFFECTS);
  });
});

describe("computeMaxHitCount (Block E1 pierce centralization)", () => {
  it("reproduces the railgun total (1 + tier + pierce)", () => {
    expect(computeMaxHitCount("railgun", 1, null, 0)).toBe(1);
    expect(computeMaxHitCount("railgun", 5, "A", 0)).toBe(2);
    expect(computeMaxHitCount("railgun", 7, "B", 2)).toBe(6);
    expect(computeMaxHitCount("railgun", 6, "B", undefined)).toBe(3);
  });

  it("reproduces the sniper Piercer total (pierce ?? 1 from level 5)", () => {
    expect(computeMaxHitCount("sniper", 4, "B", 3)).toBe(0);
    expect(computeMaxHitCount("sniper", 5, "B", 3)).toBe(3);
    expect(computeMaxHitCount("sniper", 7, "B", undefined)).toBe(1);
    expect(computeMaxHitCount("sniper", 5, "A", 3)).toBe(0);
  });

  it("returns 0 (single hit) for every other tower path", () => {
    for (const towerType of ["basic", "ice", "cannon", "lightning", "sturdyWall", "shotgunTank"]) {
      expect(computeMaxHitCount(towerType, 7, "B", 2)).toBe(0);
    }
  });
});
