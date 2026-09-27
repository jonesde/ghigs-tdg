import { GRID_TILE_SIZE } from "@/render/svg/types.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { ProjectileHitEvent } from "@/sim/physics/ContactProcessor.js";
import type { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { Tower } from "@/sim/towers/Tower.js";
import {
  MAX_PROJECTILE_AGE,
  PROJECTILE_HIT_THRESHOLD,
  PROJECTILE_RETARGET_CORRIDOR_TILE_FRACTION,
} from "./Constants.js";
import {
  ANTI_HEAL_DURATION,
  BOUNCE_DAMAGE_FALLOFF,
  BURN_CIRCUIT_DMG_MULT,
  BURN_CIRCUIT_DURATION,
  CHAIN_DAMAGE_FALLOFF,
  CHAIN_RANGE,
  KNOCKBACK_HP_DIVISOR,
  MARK_TARGET_DURATION,
  MARKSMAN_CHANCE,
  NAPALM_BURN_DPS_RATIO,
  NAPALM_BURN_DURATION,
  SPLASH_DAMAGE_RATIO,
  TOWER_BASE,
} from "./ConstantsTower.js";

export interface ProjectileGame {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  icon: string;
  damage: number;
  speed: number;
  range: number;
  towerType: string;
  towerLevel: number;
  targetId: number;
  targetX: number;
  targetY: number;
  splashRadius: number;
  maxHitCount: number;
  knockback: number;
  slowFactor: number;
  slowDuration: number;
  stunDuration: number;
  burnDps: number;
  burnDuration: number;
  critMultiplier: number;
  isCrit: boolean;
  marksman: boolean;
  active: boolean;
  age: number;
  hitCount: number;
  towerId: string;
  // Addon-driven effects
  critChance: number;
  goldOnCrit: number;
  bounceShot: boolean;
  bounceCount: number;
  splashStun: number;
  antiAir: boolean;
  armorPiercing: boolean;
  trueShot: number;
  markTarget: number;
  antiHeal: boolean;
  burnCircuit: boolean;
  pierceFalloff: number;
  // Fixed-aim tracking
  hitEnemyIds?: Set<number>;
  fixedAimHits?: number;
  fixedAim: boolean;
  // Last homing flight direction (unit); used to retarget along path when target dies.
  lastDirX: number;
  lastDirY: number;
}

interface LightningTarget {
  id: number;
  x: number;
  y: number;
  removed?: boolean;
  takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  applyStun?(duration: number): void;
  applyBurn?(dps: number, duration: number): void;
  applyKnockback?(amount: number): void;
}

interface GridRef {
  width: number;
  height: number;
  tileSize: number;
  tiles: { type: string; height: number }[][];
  blocked: Set<string>;
}

type CastEnemy = {
  id: number;
  type: string;
  x: number;
  y: number;
  radius?: number;
  hp: number;
  maxHp: number;
  removed: boolean;
  takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  applyBurn?(dps: number, duration: number): void;
  applySlow?(factor: number, duration: number): void;
  applyStun?(duration: number): void;
  applyMarkTarget?(mult: number, duration: number): void;
  applyAntiHeal?(duration: number): void;
  applyKnockback?(amount: number): void;
};

export interface EnemyManager {
  getEnemiesInRange(
    x: number,
    y: number,
    range: number,
  ): {
    id: number;
    type: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
    applyBurn?(dps: number, duration: number): void;
    applySlow?(factor: number, duration: number): void;
    applyStun?(duration: number): void;
    applyMarkTarget?(mult: number, duration: number): void;
    applyAntiHeal?(duration: number): void;
    applyKnockback?(amount: number): void;
  }[];
  forEachEnemyInRange(
    x: number,
    y: number,
    range: number,
    cb: (enemy: {
      id: number;
      type: string;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      removed: boolean;
      takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
      applySlow?(factor: number, duration: number): void;
      applyStun?(duration: number): void;
    }) => void,
  ): void;
  getEnemyById(
    id: number,
  ): {
    id: number;
    type: string;
    x: number;
    y: number;
    radius?: number;
    hp: number;
    maxHp: number;
    removed: boolean;
    takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  } | null;
  castShapePierce(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    maxHits: number,
    cb: (enemy: CastEnemy) => boolean,
  ): void;
  enemies: {
    id: number;
    type: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    removed: boolean;
    takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  }[];
}

export type OnStunEffectCallback = (x: number, y: number, duration: number) => void;
export type OnGoldRewardCallback = (amount: number) => void;

export interface LightningVisualEffect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StunVisualEffect {
  x: number;
  y: number;
}

export class ProjectileManager {
  private projectiles: ProjectileGame[];
  private enemyManager: EnemyManager;
  private particles: ParticleSpawner | null;
  private grid: GridRef | null;
  private physicsWorld: PhysicsWorld | null = null;
  private onStunEffect: OnStunEffectCallback | null;
  private onGoldReward: OnGoldRewardCallback | null;
  private nextProjectileId: number;
  private towerLookup: ((towerId: string) => Tower | null) | null = null;
  private pendingLightning: LightningVisualEffect[];
  private pendingStuns: StunVisualEffect[];
  private renderDataBuffer: Array<{ id: number; x: number; y: number; radius: number; color: string; icon: string }> =
    [];
  // Projectile ids that already have a Rapier body this frame.
  private bodyIds = new Set<number>();

  constructor(
    enemyManager: EnemyManager,
    particles: ParticleSpawner | null,
    towerLookup: ((towerId: string) => Tower | null) | null = null,
    grid: GridRef | null = null,
  ) {
    this.projectiles = [];
    this.enemyManager = enemyManager;
    this.particles = particles;
    this.grid = grid;
    this.onStunEffect = null;
    this.onGoldReward = null;
    this.nextProjectileId = 1;
    this.towerLookup = towerLookup;
    this.pendingLightning = [];
    this.pendingStuns = [];
  }

  setPhysicsWorld(physicsWorld: PhysicsWorld | null): void {
    this.physicsWorld = physicsWorld;
  }

  setOnGoldReward(callback: OnGoldRewardCallback | null): void {
    this.onGoldReward = callback;
  }

  setTowerLookup(callback: ((towerId: string) => Tower | null) | null): void {
    this.towerLookup = callback;
  }

  setOnStunEffect(callback: OnStunEffectCallback | null): void {
    this.onStunEffect = callback;
  }

  spawn(opts: {
    x: number;
    y: number;
    damage: number;
    speed: number;
    range: number;
    towerType: string;
    towerLevel: number;
    targetId: number;
    targetX?: number;
    targetY?: number;
    color?: string;
    icon?: string;
    slowAmt?: number;
    slowDur?: number;
    towerId?: string;
    napalm?: boolean;
    marksman?: boolean;
    knockbackBase?: number;
    knockbackScale?: number;
    variant?: "A" | "B" | null;
    critChance?: number;
    goldOnCrit?: number;
    bounceShot?: boolean;
    splashStun?: number;
    antiAir?: boolean;
    armorPiercing?: boolean;
    trueShot?: number;
    markTarget?: number;
    antiHeal?: boolean;
    pierce?: number;
    pierceFalloff?: number;
    stunDur?: number;
    splash?: number;
  }): void {
    const projectile: ProjectileGame = {
      id: this.nextProjectileId++,
      x: opts.x,
      y: opts.y,
      radius: opts.towerType === "cannon" ? 5 : 3,
      color: opts.color ?? "#ffcf4d",
      icon: opts.icon ?? "•",
      damage: opts.damage,
      speed: opts.speed,
      range: opts.range,
      towerType: opts.towerType,
      towerLevel: opts.towerLevel,
      targetId: opts.targetId,
      targetX: opts.targetX ?? 0,
      targetY: opts.targetY ?? 0,
      splashRadius: 0,
      maxHitCount: 0,
      knockback: 0,
      slowFactor: opts.slowAmt ?? 0,
      slowDuration: opts.slowDur ?? 0,
      stunDuration: opts.stunDur ?? 0,
      burnDps: 0,
      burnDuration: 0,
      critMultiplier: 2,
      isCrit: false,
      marksman: false,
      active: true,
      age: 0,
      hitCount: 0,
      towerId: opts.towerId ?? "",
      critChance: opts.critChance ?? 0,
      goldOnCrit: opts.goldOnCrit ?? 0,
      bounceShot: opts.bounceShot ?? false,
      bounceCount: 0,
      splashStun: opts.splashStun ?? 0,
      antiAir: opts.antiAir ?? false,
      armorPiercing: opts.armorPiercing ?? opts.antiAir ?? false,
      trueShot: opts.trueShot ?? 0,
      markTarget: opts.markTarget ?? 0,
      antiHeal: opts.antiHeal ?? false,
      burnCircuit: false,
      pierceFalloff: opts.pierceFalloff ?? 0,
      fixedAim: opts.targetId === 0,
      lastDirX: 0,
      lastDirY: 0,
    };

    // Roll crit only if tower has crit ability
    if (projectile.critChance > 0 && Math.random() < projectile.critChance) {
      projectile.isCrit = true;
    }

    const knockbackBase = opts.knockbackBase ?? TOWER_BASE[opts.towerType]?.knockbackBase ?? 0;
    const knockbackScale = opts.knockbackScale ?? TOWER_BASE[opts.towerType]?.knockbackScale ?? 0;

    this.applyProjectileEffects(
      projectile,
      opts.towerType,
      opts.towerLevel,
      opts.napalm ?? false,
      opts.marksman ?? false,
      knockbackBase,
      knockbackScale,
      opts.variant,
      opts.pierce,
      opts.splash,
    );

    this.projectiles.push(projectile);
    this.ensureProjectileBody(projectile);
  }

  private ensureProjectileBody(projectile: ProjectileGame): void {
    if (!this.physicsWorld || this.bodyIds.has(projectile.id)) return;
    const isPierce = projectile.maxHitCount > 1;
    this.physicsWorld.addProjectileBody({
      projectileId: projectile.id,
      x: projectile.x,
      y: projectile.y,
      radius: projectile.radius + PROJECTILE_HIT_THRESHOLD * 0.5,
      velocityX: 0,
      velocityY: 0,
      isSensor: isPierce,
      restitution: 0,
      collidesWithWalls: false,
    });
    this.bodyIds.add(projectile.id);
  }

  private applyProjectileEffects(
    projectile: ProjectileGame,
    towerType: string,
    towerLevel: number,
    napalm: boolean,
    marksman: boolean,
    knockbackBase: number,
    knockbackScale: number,
    variant?: "A" | "B" | null,
    pierce?: number,
    splash?: number,
  ): void {
    const tier = Math.max(0, towerLevel - 4);

    if (napalm) {
      projectile.burnDps = projectile.damage * NAPALM_BURN_DPS_RATIO;
      projectile.burnDuration = NAPALM_BURN_DURATION;
    }

    // Splash radius comes from the computed stats.splash (base + per-level scaling
    // + variant tier + addons), forwarded by Tower.fire. No hardcoded tower-type
    // override, so the visual circle matches the real AoE damage.
    projectile.splashRadius = splash ?? 0;

    if (towerType === "railgun") {
      projectile.maxHitCount = 1 + tier + (pierce ?? 0);
      projectile.stunDuration = 0.3;
    }

    // Knockback applies to any tower whose stats carry a knockback base. The
    // railgun falls back to its TOWER_BASE defaults when the caller (e.g. a
    // direct spawn without stats) omits the pair.
    if (knockbackBase > 0) {
      projectile.knockback = knockbackBase + knockbackScale * tier;
    }

    if (marksman) {
      projectile.marksman = Math.random() < MARKSMAN_CHANCE;
    }

    // Piercer: pierce through N enemies means N hits (not N-1).
    if (towerType === "sniper" && towerLevel >= 5 && variant === "B") {
      projectile.maxHitCount = pierce ?? 1;
    }
  }

  // Standalone update (tests / no split tick): castShape + manual integrate.
  // Engine uses prePhysics + postPhysics around world.step instead.
  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile) continue;
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
        continue;
      }
      projectile.age += dt;
      if (projectile.age > MAX_PROJECTILE_AGE) {
        this.removeProjectile(projectile, "expired");
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
        continue;
      }
      this.updateCircleProjectile(projectile, dt, false);
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // Before physics step: age cull + set kinematic velocities toward targets.
  prePhysics(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile) continue;
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
        continue;
      }
      projectile.age += dt;
      if (projectile.age > MAX_PROJECTILE_AGE) {
        this.removeProjectile(projectile, "expired");
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
        continue;
      }
      this.ensureProjectileBody(projectile);
      this.setProjectileBodyVelocity(projectile, dt);
    }
  }

  // After physics step: read body positions, process contact hits, castShape fallback.
  postPhysics(dt: number, contactHits: ProjectileHitEvent[]): void {
    // Sync body translations before contact resolution so impact FX use post-step
    // positions rather than the pre-physics frame.
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      const bodyPos = this.physicsWorld?.getProjectilePosition(projectile.id);
      if (bodyPos) {
        projectile.x = bodyPos.x;
        projectile.y = bodyPos.y;
      }
    }

    const hitByContact = new Set<number>();
    for (const hit of contactHits) {
      const projectile = this.projectiles.find((p) => p.id === hit.projectileId && p.active);
      const enemy = this.enemyManager.getEnemyById(hit.enemyId);
      if (!projectile || !enemy || enemy.removed) continue;
      if (projectile.hitEnemyIds?.has(enemy.id)) continue;
      this.hitCircleProjectile(projectile, enemy);
      if (!projectile.hitEnemyIds) projectile.hitEnemyIds = new Set();
      projectile.hitEnemyIds.add(enemy.id);
      hitByContact.add(projectile.id);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile) continue;
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
        continue;
      }
      const hasBody = this.bodyIds.has(projectile.id);
      const pierceRemaining = projectile.maxHitCount > 1 && projectile.hitCount < projectile.maxHitCount;
      // Traveling bodies that already resolved a hit this step skip the swept
      // cast unless they still have pierce remaining (same-tick multi-hit).
      const contactOwnedThisTick = hasBody && hitByContact.has(projectile.id) && !pierceRemaining;
      if (!contactOwnedThisTick) {
        this.updateCircleProjectile(projectile, dt, hasBody);
      }
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private setProjectileBodyVelocity(projectile: ProjectileGame, _dt: number): void {
    if (!this.physicsWorld || !this.bodyIds.has(projectile.id)) return;
    let dirX = 0;
    let dirY = 0;
    if (projectile.targetId === 0) {
      const targetDx = projectile.targetX - projectile.x;
      const targetDy = projectile.targetY - projectile.y;
      const targetDist = Math.hypot(targetDx, targetDy) || 1;
      dirX = targetDx / targetDist;
      dirY = targetDy / targetDist;
    } else {
      let enemy = this.enemyManager.getEnemyById(projectile.targetId);
      if (!enemy || enemy.removed) {
        if (!this.tryRetargetAlongPath(projectile)) {
          this.physicsWorld.setProjectileVelocity(projectile.id, 0, 0);
          return;
        }
        enemy = this.enemyManager.getEnemyById(projectile.targetId);
        if (!enemy || enemy.removed) {
          this.physicsWorld.setProjectileVelocity(projectile.id, 0, 0);
          return;
        }
      }
      const dx = enemy.x - projectile.x;
      const dy = enemy.y - projectile.y;
      const dist = Math.hypot(dx, dy) || 1;
      dirX = dx / dist;
      dirY = dy / dist;
      projectile.targetX = enemy.x;
      projectile.targetY = enemy.y;
      projectile.lastDirX = dirX;
      projectile.lastDirY = dirY;
    }
    const speed = projectile.speed;
    this.physicsWorld.setProjectileVelocity(projectile.id, dirX * speed, dirY * speed);
  }

  private destroyProjectileBody(projectileId: number): void {
    if (!this.bodyIds.has(projectileId)) return;
    this.physicsWorld?.removeProjectileBody(projectileId);
    this.bodyIds.delete(projectileId);
  }

  // `positionFromBody`: when true, body already advanced position this step — only
  // run hit casts and range checks, do not double-integrate translation.
  private updateCircleProjectile(projectile: ProjectileGame, dt: number, positionFromBody = false): void {
    // Fixed-aim: targetId === 0, travel straight toward aimed world position
    if (projectile.targetId === 0) {
      const hitThreshold = projectile.radius + PROJECTILE_HIT_THRESHOLD;
      if (projectile.hitEnemyIds === undefined) {
        projectile.hitEnemyIds = new Set<number>();
      }
      const hitSet = projectile.hitEnemyIds as Set<number>;
      if (projectile.fixedAimHits === undefined) {
        projectile.fixedAimHits = 0;
      }

      const targetDx = projectile.targetX - projectile.x;
      const targetDy = projectile.targetY - projectile.y;
      const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
      const moveAmount = projectile.speed * dt;
      const moveDist = Math.min(moveAmount, targetDist);
      const dirX = targetDist > 0 ? targetDx / targetDist : 0;
      const dirY = targetDist > 0 ? targetDy / targetDist : 0;
      const ballRadius = hitThreshold;
      const castLen = moveDist + ballRadius;
      const maxHits = projectile.maxHitCount > 0 ? projectile.maxHitCount : 1;

      this.enemyManager.castShapePierce(
        projectile.x,
        projectile.y,
        dirX,
        dirY,
        ballRadius,
        castLen,
        maxHits,
        (enemy) => {
          if (hitSet.has(enemy.id)) return true;
          this.hitCircleProjectile(projectile, enemy);
          hitSet.add(enemy.id);
          projectile.fixedAimHits = (projectile.fixedAimHits ?? 0) + 1;
          return projectile.active;
        },
      );
      if (!projectile.active) return;

      if (!positionFromBody && targetDist > 0) {
        projectile.x += (targetDx / targetDist) * moveDist;
        projectile.y += (targetDy / targetDist) * moveDist;
      }
      const finalDx = projectile.targetX - projectile.x;
      const finalDy = projectile.targetY - projectile.y;
      const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
      if (finalDist <= ballRadius) {
        this.removeProjectile(projectile, "reached-target");
      }
      return;
    }

    let enemy = this.enemyManager.getEnemyById(projectile.targetId);
    if (!enemy || enemy.removed) {
      if (!this.tryRetargetAlongPath(projectile)) {
        this.removeProjectile(projectile, "target-lost");
        return;
      }
      enemy = this.enemyManager.getEnemyById(projectile.targetId);
      if (!enemy || enemy.removed) {
        this.removeProjectile(projectile, "target-lost");
        return;
      }
    }

    const dx = enemy.x - projectile.x;
    const dy = enemy.y - projectile.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const maxRange = projectile.range * (this.grid?.tileSize ?? GRID_TILE_SIZE);
    if (dist > maxRange) {
      this.removeProjectile(projectile, "out-of-range");
      return;
    }

    const ballRadius = projectile.radius + PROJECTILE_HIT_THRESHOLD;
    const moveDist = projectile.speed * dt;
    const dirX = dist > 0 ? dx / dist : 1;
    const dirY = dist > 0 ? dy / dist : 0;
    projectile.targetX = enemy.x;
    projectile.targetY = enemy.y;
    projectile.lastDirX = dirX;
    projectile.lastDirY = dirY;
    if (projectile.hitEnemyIds === undefined) {
      projectile.hitEnemyIds = new Set<number>();
    }
    const homingHitSet = projectile.hitEnemyIds as Set<number>;
    const homingHits: CastEnemy[] = [];
    this.enemyManager.castShapePierce(
      projectile.x,
      projectile.y,
      dirX,
      dirY,
      ballRadius,
      moveDist + ballRadius,
      1,
      (candidate) => {
        if (homingHitSet.has(candidate.id)) return true;
        homingHits.push(candidate);
        return false;
      },
    );
    const hitEnemy = homingHits[0] ?? null;
    if (hitEnemy) {
      this.hitCircleProjectile(projectile, hitEnemy);
      homingHitSet.add(hitEnemy.id);
      return;
    }

    if (!positionFromBody && dist > 0) {
      projectile.x += (dx / dist) * moveDist;
      projectile.y += (dy / dist) * moveDist;
    }
  }

  // When the locked target dies/despawns, keep the projectile if another live enemy
  // lies ahead on roughly the same flight path and switch targetId to that enemy.
  private tryRetargetAlongPath(projectile: ProjectileGame): boolean {
    let dirX = projectile.lastDirX;
    let dirY = projectile.lastDirY;
    let dirLength = Math.hypot(dirX, dirY);
    if (dirLength < 1e-6) {
      dirX = projectile.targetX - projectile.x;
      dirY = projectile.targetY - projectile.y;
      dirLength = Math.hypot(dirX, dirY);
    }
    if (dirLength < 1e-6) return false;
    dirX /= dirLength;
    dirY /= dirLength;

    const tileSize = this.grid?.tileSize ?? GRID_TILE_SIZE;
    const hitBallRadius = projectile.radius + PROJECTILE_HIT_THRESHOLD;
    const corridorRadius = Math.max(hitBallRadius, PROJECTILE_RETARGET_CORRIDOR_TILE_FRACTION * tileSize);
    const maxDistance = projectile.range * tileSize;
    const hitSet = projectile.hitEnemyIds;
    const foundTargets: CastEnemy[] = [];

    this.enemyManager.castShapePierce(
      projectile.x,
      projectile.y,
      dirX,
      dirY,
      corridorRadius,
      maxDistance,
      1,
      (candidate) => {
        if (hitSet?.has(candidate.id)) return true;
        foundTargets.push(candidate);
        return false;
      },
    );

    const nextTarget = foundTargets[0];
    if (!nextTarget) return false;
    projectile.targetId = nextTarget.id;
    projectile.targetX = nextTarget.x;
    projectile.targetY = nextTarget.y;
    projectile.lastDirX = dirX;
    projectile.lastDirY = dirY;
    return true;
  }

  // Impact on the enemy silhouette edge facing the projectile (center − radius along
  // the approach vector). Used for hit particles and the projectile's final frame.
  private snapProjectileToEnemyImpact(projectile: ProjectileGame, enemy: CastEnemy): void {
    const deltaX = enemy.x - projectile.x;
    const deltaY = enemy.y - projectile.y;
    const distance = Math.hypot(deltaX, deltaY);
    const enemyRadius = enemy.radius ?? 0;
    if (distance <= 1e-6) {
      projectile.x = enemy.x;
      projectile.y = enemy.y;
      return;
    }
    projectile.x = enemy.x - (deltaX / distance) * enemyRadius;
    projectile.y = enemy.y - (deltaY / distance) * enemyRadius;
  }

  private hitCircleProjectile(projectile: ProjectileGame, enemy: CastEnemy): void {
    this.snapProjectileToEnemyImpact(projectile, enemy);

    const finalDamage = projectile.isCrit ? projectile.damage * projectile.critMultiplier : projectile.damage;
    // pierceFalloff <= 0 means no falloff (e.g. Rail Lance sets 0); else exponential per prior hit.
    const falloff = projectile.pierceFalloff > 0 ? projectile.pierceFalloff : 1;
    const scaledDamage = finalDamage * falloff ** projectile.hitCount;

    // True Shot: 20% chance to instant-kill non-boss enemies
    if (projectile.trueShot > 0 && enemy.type !== "boss" && Math.random() < projectile.trueShot) {
      const instantKillDamage = enemy.hp + 1;
      const dealtDamage = enemy.takeDamage(instantKillDamage, true) ?? instantKillDamage;
      this.recordDamage(projectile.towerId, dealtDamage);
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
        this.onGoldReward(projectile.goldOnCrit);
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    if (projectile.marksman && enemy.type !== "boss") {
      const instantKillDamage = enemy.hp + 1;
      const dealtDamage = enemy.takeDamage(instantKillDamage, true) ?? instantKillDamage;
      this.recordDamage(projectile.towerId, dealtDamage);
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
      }
      if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
        this.onGoldReward(projectile.goldOnCrit);
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    // Damage first so a marking shot does not multiply its own hit; mark after.
    const dealtDamage = enemy.takeDamage(scaledDamage, projectile.armorPiercing || projectile.antiAir) ?? 0;
    this.recordDamage(projectile.towerId, dealtDamage);

    if (projectile.markTarget > 0 && enemy.applyMarkTarget) {
      enemy.applyMarkTarget(projectile.markTarget, MARK_TARGET_DURATION);
    }

    // Anti-Heal: disable enemy healer auras
    if (projectile.antiHeal && enemy.applyAntiHeal) {
      enemy.applyAntiHeal(ANTI_HEAL_DURATION);
    }

    // Gold Rush: grant gold on critical hit
    if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
      this.onGoldReward(projectile.goldOnCrit);
    }

    if (projectile.burnDps > 0 && enemy.applyBurn) {
      enemy.applyBurn(projectile.burnDps, projectile.burnDuration);
    }

    if (projectile.slowFactor > 0 && enemy.applySlow) {
      enemy.applySlow(projectile.slowFactor, projectile.slowDuration);
    }

    if (projectile.stunDuration > 0) {
      if (enemy.applyStun) {
        enemy.applyStun(projectile.stunDuration);
      }
      if (this.onStunEffect) {
        this.onStunEffect(enemy.x, enemy.y, projectile.stunDuration);
      }
    }

    if (projectile.knockback > 0) {
      const knockAmount =
        projectile.knockback *
        (this.grid?.tileSize ?? GRID_TILE_SIZE) *
        Math.max(0.1, Math.min(2, KNOCKBACK_HP_DIVISOR / enemy.maxHp));
      if (knockAmount > 0 && enemy.applyKnockback) {
        enemy.applyKnockback(knockAmount);
      }
    }

    if (projectile.maxHitCount > 0) {
      projectile.hitCount++;
      if (projectile.hitCount < projectile.maxHitCount) {
        if (projectile.fixedAim) {
          // Fixed-aim projectiles travel toward a fixed world point, so they must
          // not re-home onto an enemy — keep travelling along the aim line so the
          // cast in the targetId === 0 branch can strike the next enemy.
          return;
        }
        const nextTarget = this.findNearestEnemy(
          projectile.x,
          projectile.y,
          projectile.range * (this.grid?.tileSize ?? 36),
          enemy.id,
        );
        if (nextTarget) {
          projectile.targetId = nextTarget.id;
          return;
        }
      }
    }

    if (projectile.splashRadius > 0 && this.particles) {
      const splashRadiusPx = projectile.splashRadius * (this.grid?.tileSize ?? 1);
      const splashEnemies = this.enemyManager.getEnemiesInRange(enemy.x, enemy.y, splashRadiusPx);
      const tileSize = this.grid?.tileSize ?? GRID_TILE_SIZE;
      for (const splashEnemy of splashEnemies) {
        if (splashEnemy.id === enemy.id) continue;
        const splashDamage = scaledDamage * SPLASH_DAMAGE_RATIO;
        const dealtSplash = splashEnemy.takeDamage(splashDamage, projectile.armorPiercing || projectile.antiAir) ?? 0;
        this.recordDamage(projectile.towerId, dealtSplash);

        if (projectile.markTarget > 0 && splashEnemy.applyMarkTarget) {
          splashEnemy.applyMarkTarget(projectile.markTarget, MARK_TARGET_DURATION);
        }
        if (projectile.burnDps > 0 && splashEnemy.applyBurn) {
          splashEnemy.applyBurn(projectile.burnDps, projectile.burnDuration);
        }
        if (projectile.slowFactor > 0 && splashEnemy.applySlow) {
          splashEnemy.applySlow(projectile.slowFactor, projectile.slowDuration);
        }
        if (projectile.knockback > 0 && splashEnemy.applyKnockback) {
          const knockAmount =
            projectile.knockback * tileSize * Math.max(0.1, Math.min(2, KNOCKBACK_HP_DIVISOR / splashEnemy.maxHp));
          if (knockAmount > 0) {
            splashEnemy.applyKnockback(knockAmount);
          }
        }
        // Stun Shell uses splashStun; otherwise projectile stun applies to splash too.
        const splashStunDuration = projectile.splashStun > 0 ? projectile.splashStun : projectile.stunDuration;
        if (splashStunDuration > 0 && splashEnemy.applyStun) {
          splashEnemy.applyStun(splashStunDuration);
        }
      }
    }

    // Bounce Shot: redirect projectile to 1 nearby enemy (max 1 bounce).
    // Fixed-aim projectiles keep their aim point instead of re-homing.
    if (projectile.bounceShot && projectile.bounceCount < 1 && !projectile.fixedAim) {
      const bounceTarget = this.findNearestEnemy(
        projectile.x,
        projectile.y,
        projectile.range * (this.grid?.tileSize ?? 36),
        enemy.id,
      );
      if (bounceTarget) {
        projectile.targetId = bounceTarget.id;
        projectile.damage *= BOUNCE_DAMAGE_FALLOFF;
        projectile.bounceCount++;
        return;
      }
    }

    if (this.particles) {
      this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, { speed: 30, life: 0.2 });
    }

    this.removeProjectile(projectile, "hit");
  }

  fireLightning(opts: {
    originX: number;
    originY: number;
    damage: number;
    towerLevel: number;
    targetId: number;
    stunDuration: number;
    towerId?: string;
    doubleDischarge?: number;
    antiAir?: boolean;
    burnCircuit?: boolean;
    critChance?: number;
    goldOnCrit?: number;
    range?: number;
    chain?: number;
    stormcall?: boolean;
    color?: string;
  }): void {
    let current: LightningTarget | null = this.enemyManager.getEnemyById(opts.targetId);
    if (!current || current.removed) return;

    const tier = Math.max(0, opts.towerLevel - 4);
    let remainingChains = opts.chain ?? 2 + tier;
    const critChance = opts.critChance ?? 0;
    const isCrit = critChance > 0 && Math.random() < critChance;
    const finalDamage = isCrit ? opts.damage * 2 : opts.damage;

    // Lightning strikes instantly: the initial target takes full damage, each
    // chained target takes reduced damage, and all enemies in the chain are
    // stunned. The tower->final-target flash fires once at the end.
    const chainTargets: LightningTarget[] = [];

    const primaryDealt = current.takeDamage(finalDamage) ?? finalDamage;
    this.recordDamage(opts.towerId, primaryDealt);
    // Gold Rush: grant gold on critical hit
    if (isCrit && (opts.goldOnCrit ?? 0) > 0 && this.onGoldReward) {
      this.onGoldReward(opts.goldOnCrit ?? 0);
    }
    chainTargets.push(current);
    if (this.particles) {
      this.particles.spawn(current.x, current.y, opts.color ?? "#ffcf4d", 3, { speed: 30, life: 0.2 });
    }

    const chainedIds = new Set<number>([current.id]);
    let chainsUsed = 0;
    while (remainingChains > 0) {
      const chainRangePx = CHAIN_RANGE * (this.grid?.tileSize ?? 1);
      const nextTarget = this.findNearestEnemy(current.x, current.y, chainRangePx, undefined, chainedIds);
      if (!nextTarget) break;

      const chainDamage = finalDamage * CHAIN_DAMAGE_FALLOFF ** (chainsUsed + 1);
      const chainDealt = nextTarget.takeDamage(chainDamage) ?? chainDamage;
      this.recordDamage(opts.towerId, chainDealt);
      chainTargets.push(nextTarget);
      chainedIds.add(nextTarget.id);
      if (this.particles) {
        this.particles.spawn(nextTarget.x, nextTarget.y, opts.color ?? "#ffcf4d", 3, { speed: 30, life: 0.2 });
      }
      // Burn Circuit: chained enemies take burn damage over time
      if (opts.burnCircuit && nextTarget.applyBurn) {
        nextTarget.applyBurn(chainDamage * BURN_CIRCUIT_DMG_MULT, BURN_CIRCUIT_DURATION);
      }
      this.pendingLightning.push({ x1: current.x, y1: current.y, x2: nextTarget.x, y2: nextTarget.y });
      chainsUsed++;
      remainingChains--;
      current = nextTarget;
    }

    // Stormcall (lightning B variant): strike random enemies in a wide area in
    // addition to the normal chain. Each random strike deals reduced damage, is
    // added to chainTargets so it also gets stunned, and fires a lightning flash.
    if (opts.stormcall) {
      const wideRangePx = CHAIN_RANGE * 3 * (this.grid?.tileSize ?? 1);
      const stormcallCount = 1 + tier;
      const stormcallChainedIds = new Set(chainTargets.map((target) => target.id));
      const wideEnemies = this.enemyManager
        .getEnemiesInRange(opts.originX, opts.originY, wideRangePx)
        .filter((enemy) => !stormcallChainedIds.has(enemy.id));
      for (let strike = 0; strike < stormcallCount && wideEnemies.length > 0; strike++) {
        const pickIndex = Math.floor(Math.random() * wideEnemies.length);
        const stormTarget = wideEnemies.splice(pickIndex, 1)[0]!;
        const stormDamage = finalDamage * CHAIN_DAMAGE_FALLOFF;
        const stormDealt = stormTarget.takeDamage(stormDamage) ?? stormDamage;
        this.recordDamage(opts.towerId, stormDealt);
        chainTargets.push(stormTarget);
        if (this.particles) {
          this.particles.spawn(stormTarget.x, stormTarget.y, opts.color ?? "#ffcf4d", 3, { speed: 30, life: 0.2 });
        }
        this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: stormTarget.x, y2: stormTarget.y });
      }
    }

    if (opts.stunDuration > 0) {
      for (const target of chainTargets) {
        if (target.applyStun) target.applyStun(opts.stunDuration);
        this.pendingStuns.push({ x: target.x, y: target.y });
      }
      this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: current.x, y2: current.y });
    }

    // Double Discharge: 10% chance to fire a second bolt to a different target
    if (opts.doubleDischarge && opts.doubleDischarge > 0 && Math.random() < opts.doubleDischarge) {
      const secondTarget = this.findNearestEnemy(
        opts.originX,
        opts.originY,
        (opts.range ?? CHAIN_RANGE) * (this.grid?.tileSize ?? 1),
        opts.targetId,
      );
      if (secondTarget) {
        const secondIsCrit = critChance > 0 && Math.random() < critChance;
        const secondDamage = finalDamage * 0.5 * (secondIsCrit ? 2 : 1);
        const secondDealt = secondTarget.takeDamage(secondDamage) ?? secondDamage;
        this.recordDamage(opts.towerId, secondDealt);
        // Gold Rush: grant gold on critical hit for second bolt
        if (secondIsCrit && (opts.goldOnCrit ?? 0) > 0 && this.onGoldReward) {
          this.onGoldReward(opts.goldOnCrit ?? 0);
        }
        if (opts.stunDuration > 0 && secondTarget.applyStun) {
          secondTarget.applyStun(opts.stunDuration);
        }
        this.pendingLightning.push({ x1: opts.originX, y1: opts.originY, x2: secondTarget.x, y2: secondTarget.y });
      }
    }
  }

  private recordDamage(towerId: string | undefined, amount: number): void {
    if (!towerId || !(amount > 0)) return;
    const tower = this.towerLookup?.(towerId);
    if (tower) {
      tower.totalDamageDealt += amount;
      tower.waveDamage += amount;
      // Intentionally do NOT clearStatsCache here. Tower.stats is keyed by
      // _computeCacheKey, which already encodes every runtime-mutable input:
      // totalDamageDealt (milestone tier), level, and variant. The other inputs
      // (general addons, terrain height, tower addons) are fixed for the run, so
      // the cache recomputes exactly when damage crosses a milestone threshold.
      // The previous per-hit clear forced a redundant _computeStats on the next
      // stats read (which, post-Finding 1, happens every frame for the selected
      // tower). doUpgrade/specialize still clear the cache where level/variant
      // change.
    }
  }

  private findNearestEnemy(
    x: number,
    y: number,
    range: number,
    excludeId?: number,
    excludeIds?: Set<number>,
  ): LightningTarget | null {
    // Allocation-free nearest-enemy search via the spatial-hash visitor. The
    // original built (up to 4) enemy arrays per call; here we scan incrementally
    // widening sub-ranges and stop at the first sub-range that yields a candidate
    // (any enemy found in a smaller sub-range is strictly closer than anything in
    // a larger one, so a later, wider scan cannot beat it). Strict `<` on squared
    // distance preserves the original first-found-wins tie-break exactly (cell
    // iteration order is unchanged from getEnemiesInRange).
    let best: LightningTarget | null = null;
    let bestDistSquared = Infinity;

    const tileSize = GRID_TILE_SIZE;
    const subRanges = [0.5 * tileSize, 0.25 * range, 0.5 * range, range];
    for (const subRange of subRanges) {
      this.enemyManager.forEachEnemyInRange(x, y, subRange, (enemy) => {
        if (enemy.id === excludeId) return;
        if (excludeIds?.has(enemy.id)) return;
        const deltaX = enemy.x - x;
        const deltaY = enemy.y - y;
        const distSquared = deltaX * deltaX + deltaY * deltaY;
        if (distSquared < bestDistSquared) {
          bestDistSquared = distSquared;
          best = enemy;
        }
      });
      if (best) return best;
    }
    return best;
  }

  private removeProjectile(projectile: ProjectileGame, _reason: string): void {
    projectile.active = false;
    this.destroyProjectileBody(projectile.id);
  }

  getRenderData(): Array<{ id: number; x: number; y: number; radius: number; color: string; icon: string }> {
    const result = this.renderDataBuffer;
    result.length = 0;
    for (const p of this.projectiles) {
      if (p.active) {
        result.push({ id: p.id, x: p.x, y: p.y, radius: p.radius, color: p.color, icon: p.icon });
      }
    }
    return result;
  }

  getRenderVisualEffects(): { lightning: LightningVisualEffect[]; stuns: StunVisualEffect[] } {
    return { lightning: [...this.pendingLightning], stuns: [...this.pendingStuns] };
  }

  consumeRenderVisualEffects(): { lightning: LightningVisualEffect[]; stuns: StunVisualEffect[] } {
    const effects = { lightning: [...this.pendingLightning], stuns: [...this.pendingStuns] };
    this.clearVisualEffects();
    return effects;
  }

  private clearVisualEffects(): void {
    this.pendingLightning = [];
    this.pendingStuns = [];
  }

  clear(): void {
    for (const projectileId of this.bodyIds) {
      this.physicsWorld?.removeProjectileBody(projectileId);
    }
    this.bodyIds.clear();
    this.projectiles = [];
    this.pendingLightning = [];
    this.pendingStuns = [];
  }
}
