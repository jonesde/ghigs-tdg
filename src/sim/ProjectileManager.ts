import { GRID_TILE_SIZE } from "@/render/svg/types.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import type { ProjectileHitEvent } from "@/sim/physics/ContactProcessor.js";
import type { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { MAX_PROJECTILE_AGE, PROJECTILE_HIT_SLOP, PROJECTILE_RETARGET_CORRIDOR_TILE_FRACTION } from "./Constants.js";
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

export interface DamageCreditTarget {
  totalDamageDealt: number;
  waveDamage: number;
}

// Sub-range widening fractions for the nearest-enemy search. Index 0 scales by
// tileSize (covers the local neighborhood before any range is applied), the
// rest scale by the caller's range. Module constant so the array is not rebuilt
// per search call.
const NEAREST_SEARCH_FRACTIONS = [0.5, 0.25, 0.5, 1] as const;

// Impact bursts read as hit feedback on top of the enemy sprites, so they
// render dimmed (stun-ring precedent); death/build/ghost bursts stay full.
const HIT_PARTICLE_OPACITY_SCALE = 0.5;

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
  groundOnly: boolean;
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
  cacheId?: number;
  // Last homing flight direction (unit); used to retarget along path when target dies.
  lastDirX: number;
  lastDirY: number;
  // Pre-step position. The body-path hit cast sweeps from here through the post-step point.
  sweepOriginX: number;
  sweepOriginY: number;
}

// Single source of truth for projectile pierce totals, used by every tower path.
// Rules:
// - railgun: 1 base hit + variant tier + forwarded `pierce` (Multi-Pierce addon);
// - sniper variant B from level 5: `pierce ?? 1` (the Piercer statOp sets 3);
// - every other path: 0, meaning a single hit (hitCircleProjectile treats 0 as
//   "no pierce"). Keep this helper in sync with Tower.fire forwarding.
export function computeMaxHitCount(
  towerType: string,
  towerLevel: number,
  variant: "A" | "B" | null | undefined,
  pierce: number | undefined,
): number {
  if (towerType === "railgun") return 1 + Math.max(0, towerLevel - 4) + (pierce ?? 0);
  if (towerType === "sniper" && towerLevel >= 5 && variant === "B") return pierce ?? 1;
  return 0;
}

interface LightningTarget {
  id: number;
  x: number;
  y: number;
  removed?: boolean;
  flyingHeight?: number;
  takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  applyStun?(duration: number): void;
  applyBurn?(dps: number, duration: number, sourceTowerId?: string): void;
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
  flyingHeight?: number;
  takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
  applyBurn?(dps: number, duration: number, sourceTowerId?: string): void;
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
    flyingHeight?: number;
    takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
    applyBurn?(dps: number, duration: number, sourceTowerId?: string): void;
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
      flyingHeight?: number;
      takeDamage(dmg: number, armorPiercing?: boolean): number | undefined;
      applyBurn?(dps: number, duration: number, sourceTowerId?: string): void;
      applySlow?(factor: number, duration: number): void;
      applyStun?(duration: number): void;
      applyMarkTarget?(mult: number, duration: number): void;
      applyAntiHeal?(duration: number): void;
      applyKnockback?(amount: number): void;
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
    flyingHeight?: number;
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
    groundOnly?: boolean,
  ): void;
  enemies: {
    id: number;
    type: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    removed: boolean;
    flyingHeight?: number;
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

// Drop-oldest caps for the per-tick visual-effect buffers. Effects are only
// cleared after a successful snapshot post, so a long stall (renderer not
// draining) would otherwise grow them without bound. The render pools only draw
// the 20 newest lightning bolts / 50 stun marks anyway, so older entries are
// invisible and safe to evict.
export const MAX_PENDING_LIGHTNING_EFFECTS = 256;
export const MAX_PENDING_STUN_EFFECTS = 256;

export class ProjectileManager {
  private projectiles: ProjectileGame[];
  private enemyManager: EnemyManager;
  private particles: ParticleSpawner | null;
  private grid: GridRef | null;
  private physicsWorld: PhysicsWorld | null = null;
  private onStunEffect: OnStunEffectCallback | null;
  private onGoldReward: OnGoldRewardCallback | null;
  private onCacheHit: ((cacheId: number, damage: number) => void) | null = null;
  private nextProjectileId: number;
  private towerLookup: ((towerId: string) => DamageCreditTarget | null) | null = null;
  private pendingLightning: LightningVisualEffect[];
  private pendingStuns: StunVisualEffect[];
  private renderDataBuffer: Array<{ id: number; x: number; y: number; radius: number; color: string; icon: string }> =
    [];
  // Seeded combat-roll source, forked per run by GameEngine from (map seed, runId).
  // Defaults to Math.random only so render-side / legacy test constructions keep
  // working; the sim hot path always runs on the injected fork for replay determinism.
  private rng: () => number = Math.random;
  // Projectile ids that already have a Rapier body this frame.
  private bodyIds = new Set<number>();
  // Live projectile lookup by id for contact-event resolution. Mirrors
  // `projectiles`, including inactive impact-frame retention entries (they stay
  // until the next prePhysics splice), so a contact can never resolve the wrong
  // projectile by position scan.
  private projectilesById = new Map<number, ProjectileGame>();
  // Reused scratch state for findNearestEnemy: the widening sub-range values and
  // a stable visitor, so the chain/bounce/stormcall search allocates nothing.
  private nearestSearchX: number = 0;
  private nearestSearchY: number = 0;
  private nearestSearchExcludeId: number | undefined;
  private nearestSearchExcludeIds: Set<number> | undefined;
  private nearestSearchGroundOnly: boolean = false;
  private nearestSearchBest: LightningTarget | null = null;
  private nearestSearchBestDistSquared: number = Infinity;
  private nearestSearchSubRanges: number[] = [0, 0, 0, 0];
  private readonly nearestSearchVisitor = (enemy: LightningTarget): void => {
    if (enemy.id === this.nearestSearchExcludeId) return;
    if (this.nearestSearchExcludeIds?.has(enemy.id)) return;
    if (this.nearestSearchGroundOnly && (enemy.flyingHeight ?? 0) > 0) return;
    const deltaX = enemy.x - this.nearestSearchX;
    const deltaY = enemy.y - this.nearestSearchY;
    const distSquared = deltaX * deltaX + deltaY * deltaY;
    if (distSquared < this.nearestSearchBestDistSquared) {
      this.nearestSearchBestDistSquared = distSquared;
      this.nearestSearchBest = enemy;
    }
  };

  constructor(
    enemyManager: EnemyManager,
    particles: ParticleSpawner | null,
    towerLookup: ((towerId: string) => DamageCreditTarget | null) | null = null,
    grid: GridRef | null = null,
    rng: (() => number) | null = null,
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
    if (rng) this.rng = rng;
  }

  // Cross-module: GameEngine injects its per-run seeded fork here after construct.
  setRng(rng: () => number): void {
    this.rng = rng;
  }

  setPhysicsWorld(physicsWorld: PhysicsWorld | null): void {
    this.physicsWorld = physicsWorld;
  }

  setOnGoldReward(callback: OnGoldRewardCallback | null): void {
    this.onGoldReward = callback;
  }

  // Cross-module: GameEngine applies the hit to mapCaches when the shot arrives.
  setOnCacheHit(callback: ((cacheId: number, damage: number) => void) | null): void {
    this.onCacheHit = callback;
  }

  setTowerLookup(callback: ((towerId: string) => DamageCreditTarget | null) | null): void {
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
    groundOnly?: boolean;
    armorPiercing?: boolean;
    trueShot?: number;
    markTarget?: number;
    antiHeal?: boolean;
    pierce?: number;
    pierceFalloff?: number;
    stunDur?: number;
    splash?: number;
    cacheId?: number;
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
      groundOnly: opts.groundOnly ?? false,
      armorPiercing: opts.armorPiercing ?? false,
      trueShot: opts.trueShot ?? 0,
      markTarget: opts.markTarget ?? 0,
      antiHeal: opts.antiHeal ?? false,
      burnCircuit: false,
      pierceFalloff: opts.pierceFalloff ?? 0,
      fixedAim: opts.targetId === 0,
      ...(opts.cacheId !== undefined ? { cacheId: opts.cacheId } : {}),
      lastDirX: 0,
      lastDirY: 0,
      sweepOriginX: opts.x,
      sweepOriginY: opts.y,
    };

    if (projectile.cacheId !== undefined) {
      // No body: a sensor would still register enemy contacts on the way to the cache.
      this.projectiles.push(projectile);
      this.projectilesById.set(projectile.id, projectile);
      return;
    }

    // Roll crit only if tower has crit ability
    if (projectile.critChance > 0 && this.rng() < projectile.critChance) {
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
    this.projectilesById.set(projectile.id, projectile);
    this.ensureProjectileBody(projectile);
  }

  // Single removal point for the projectile list so the id index cannot drift.
  private removeProjectileAt(index: number): void {
    const projectile = this.projectiles[index];
    if (projectile) this.projectilesById.delete(projectile.id);
    this.projectiles.splice(index, 1);
  }

  private ensureProjectileBody(projectile: ProjectileGame): void {
    if (!this.physicsWorld || this.bodyIds.has(projectile.id)) return;
    // Sensor, including non-pierce shots. The ball is kinematic and its radius
    // includes the hit threshold, so a solid body spawned at the barrel overlaps
    // a melee target and Rapier shoves that enemy off the tower. Contact events
    // still register the hit; the hit handler removes the body.
    this.physicsWorld.addProjectileBody({
      projectileId: projectile.id,
      x: projectile.x,
      y: projectile.y,
      radius: projectile.radius + PROJECTILE_HIT_SLOP,
      velocityX: 0,
      velocityY: 0,
      isSensor: true,
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
      projectile.maxHitCount = computeMaxHitCount(towerType, towerLevel, variant, pierce);
      projectile.stunDuration = 0.3;
    }

    // Knockback applies to any tower whose stats carry a knockback base. The
    // railgun falls back to its TOWER_BASE defaults when the caller (e.g. a
    // direct spawn without stats) omits the pair.
    if (knockbackBase > 0) {
      projectile.knockback = knockbackBase + knockbackScale * tier;
    }

    if (marksman) {
      projectile.marksman = this.rng() < MARKSMAN_CHANCE;
    }

    // Piercer: pierce through N enemies means N hits (not N-1).
    if (towerType === "sniper" && towerLevel >= 5 && variant === "B") {
      projectile.maxHitCount = computeMaxHitCount(towerType, towerLevel, variant, pierce);
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
        this.removeProjectileAt(i);
        continue;
      }
      projectile.age += dt;
      if (projectile.age > MAX_PROJECTILE_AGE) {
        this.removeProjectile(projectile, "expired");
        this.destroyProjectileBody(projectile.id);
        this.removeProjectileAt(i);
        continue;
      }
      this.updateCircleProjectile(projectile, dt, false);
      if (!projectile.active) {
        this.destroyProjectileBody(projectile.id);
        this.removeProjectileAt(i);
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
        this.removeProjectileAt(i);
        continue;
      }
      projectile.age += dt;
      if (projectile.age > MAX_PROJECTILE_AGE) {
        this.removeProjectile(projectile, "expired");
        this.destroyProjectileBody(projectile.id);
        this.removeProjectileAt(i);
        continue;
      }
      this.ensureProjectileBody(projectile);
      this.setProjectileBodyVelocity(projectile, dt);
    }
  }

  // After physics step: read body positions, process contact hits, castShape fallback.
  postPhysics(dt: number, contactHits: ProjectileHitEvent[]): void {
    // x/y is still the pre-step point: prePhysics sets velocity and does not integrate.
    // The hit cast sweeps that segment. Starting at the post-step point looks one step
    // ahead and removes the glyph short of the enemy. Impact FX then use the post-step
    // point, or the snapped surface if this step hit.
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.sweepOriginX = projectile.x;
      projectile.sweepOriginY = projectile.y;
      const bodyPosition = this.physicsWorld?.getProjectilePosition(projectile.id);
      if (bodyPosition) {
        projectile.x = bodyPosition.x;
        projectile.y = bodyPosition.y;
      }
    }

    const hitByContact = new Set<number>();
    for (const hit of contactHits) {
      const projectile = this.projectilesById.get(hit.projectileId);
      const enemy = this.enemyManager.getEnemyById(hit.enemyId);
      if (!projectile?.active || !enemy || enemy.removed) continue;
      if (projectile.groundOnly && (enemy.flyingHeight ?? 0) > 0) continue;
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
        // Stay in the list so the snapshot after this tick still draws the snapped glyph.
        // prePhysics splices inactive projectiles on the next tick, before another cast.
        this.destroyProjectileBody(projectile.id);
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
      }
    }
  }

  private setProjectileBodyVelocity(projectile: ProjectileGame, _dt: number): void {
    if (!this.physicsWorld || !this.bodyIds.has(projectile.id)) return;
    // Known one-tick gap (documented, behavior-identical by design): homing aims
    // at the enemy's pre-step x/y because this runs before world.step moves bodies.
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

  private glyphHitRadius(projectile: ProjectileGame): number {
    return projectile.radius + PROJECTILE_HIT_SLOP;
  }

  // Center travel for this step only. The cast ball is the glyph, so this length must
  // not also include that radius: the old threshold did, and every enemy was struck
  // about a boss-width before the glyph arrived. A body has already moved, so the
  // segment starts at the pre-step point saved in postPhysics. The manual path has
  // not integrated yet, so the segment is the step about to be taken.
  private stepCast(
    projectile: ProjectileGame,
    dt: number,
    positionFromBody: boolean,
    aimX: number,
    aimY: number,
    clampToAim: boolean,
  ): {
    originX: number;
    originY: number;
    directionX: number;
    directionY: number;
    castLength: number;
    moveDist: number;
  } {
    if (positionFromBody) {
      const originX = projectile.sweepOriginX;
      const originY = projectile.sweepOriginY;
      const traveledX = projectile.x - originX;
      const traveledY = projectile.y - originY;
      const traveled = Math.hypot(traveledX, traveledY);
      if (traveled > 1e-6) {
        return {
          originX,
          originY,
          directionX: traveledX / traveled,
          directionY: traveledY / traveled,
          castLength: traveled,
          moveDist: traveled,
        };
      }
      const aimDeltaX = aimX - originX;
      const aimDeltaY = aimY - originY;
      const aimDistance = Math.hypot(aimDeltaX, aimDeltaY) || 1;
      return {
        originX,
        originY,
        directionX: aimDeltaX / aimDistance,
        directionY: aimDeltaY / aimDistance,
        castLength: 0,
        moveDist: 0,
      };
    }
    const originX = projectile.x;
    const originY = projectile.y;
    const aimDeltaX = aimX - originX;
    const aimDeltaY = aimY - originY;
    const aimDistance = Math.hypot(aimDeltaX, aimDeltaY);
    const stepDistance = projectile.speed * dt;
    const moveDist = clampToAim ? Math.min(stepDistance, aimDistance) : stepDistance;
    const directionX = aimDistance > 0 ? aimDeltaX / aimDistance : 1;
    const directionY = aimDistance > 0 ? aimDeltaY / aimDistance : 0;
    return { originX, originY, directionX, directionY, castLength: moveDist, moveDist };
  }

  // `positionFromBody`: when true, body already advanced position this step — only
  // run hit casts and range checks, do not double-integrate translation.
  private advanceCacheShot(projectile: ProjectileGame, dt: number, positionFromBody: boolean): void {
    const cacheId = projectile.cacheId;
    if (cacheId === undefined) return;
    const ballRadius = this.glyphHitRadius(projectile);
    const segment = this.stepCast(projectile, dt, positionFromBody, projectile.targetX, projectile.targetY, true);
    if (!positionFromBody && segment.moveDist > 0) {
      projectile.x += segment.directionX * segment.moveDist;
      projectile.y += segment.directionY * segment.moveDist;
    }
    const finalDeltaX = projectile.targetX - projectile.x;
    const finalDeltaY = projectile.targetY - projectile.y;
    if (Math.hypot(finalDeltaX, finalDeltaY) > ballRadius) return;
    this.onCacheHit?.(cacheId, projectile.damage);
    this.removeProjectile(projectile, "reached-target");
  }

  private updateCircleProjectile(projectile: ProjectileGame, dt: number, positionFromBody = false): void {
    if (projectile.targetId === 0) {
      if (projectile.cacheId !== undefined) {
        this.advanceCacheShot(projectile, dt, positionFromBody);
        return;
      }
      const ballRadius = this.glyphHitRadius(projectile);
      if (projectile.hitEnemyIds === undefined) {
        projectile.hitEnemyIds = new Set<number>();
      }
      const hitSet = projectile.hitEnemyIds as Set<number>;
      if (projectile.fixedAimHits === undefined) {
        projectile.fixedAimHits = 0;
      }

      const segment = this.stepCast(projectile, dt, positionFromBody, projectile.targetX, projectile.targetY, true);
      const maxHits = projectile.maxHitCount > 0 ? projectile.maxHitCount : 1;

      this.enemyManager.castShapePierce(
        segment.originX,
        segment.originY,
        segment.directionX,
        segment.directionY,
        ballRadius,
        segment.castLength,
        maxHits,
        (enemy) => {
          if (hitSet.has(enemy.id)) return true;
          this.hitCircleProjectile(projectile, enemy);
          hitSet.add(enemy.id);
          projectile.fixedAimHits = (projectile.fixedAimHits ?? 0) + 1;
          return projectile.active;
        },
        projectile.groundOnly,
      );
      if (!projectile.active) return;

      if (!positionFromBody && segment.moveDist > 0) {
        projectile.x += segment.directionX * segment.moveDist;
        projectile.y += segment.directionY * segment.moveDist;
      }
      const finalDeltaX = projectile.targetX - projectile.x;
      const finalDeltaY = projectile.targetY - projectile.y;
      const finalDistance = Math.hypot(finalDeltaX, finalDeltaY);
      if (finalDistance <= ballRadius) {
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

    const deltaX = enemy.x - projectile.x;
    const deltaY = enemy.y - projectile.y;
    const distance = Math.hypot(deltaX, deltaY);

    const maxRange = projectile.range * (this.grid?.tileSize ?? GRID_TILE_SIZE);
    if (distance > maxRange) {
      this.removeProjectile(projectile, "out-of-range");
      return;
    }

    const ballRadius = this.glyphHitRadius(projectile);
    projectile.targetX = enemy.x;
    projectile.targetY = enemy.y;
    projectile.lastDirX = distance > 0 ? deltaX / distance : 1;
    projectile.lastDirY = distance > 0 ? deltaY / distance : 0;
    const segment = this.stepCast(projectile, dt, positionFromBody, enemy.x, enemy.y, false);
    if (projectile.hitEnemyIds === undefined) {
      projectile.hitEnemyIds = new Set<number>();
    }
    const homingHitSet = projectile.hitEnemyIds as Set<number>;
    const homingHits: CastEnemy[] = [];
    this.enemyManager.castShapePierce(
      segment.originX,
      segment.originY,
      segment.directionX,
      segment.directionY,
      ballRadius,
      segment.castLength,
      1,
      (candidate) => {
        if (homingHitSet.has(candidate.id)) return true;
        homingHits.push(candidate);
        return false;
      },
      projectile.groundOnly,
    );
    const hitEnemy = homingHits[0] ?? null;
    if (hitEnemy) {
      this.hitCircleProjectile(projectile, hitEnemy);
      homingHitSet.add(hitEnemy.id);
      return;
    }

    if (!positionFromBody && segment.moveDist > 0) {
      projectile.x += segment.directionX * segment.moveDist;
      projectile.y += segment.directionY * segment.moveDist;
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
    const corridorRadius = PROJECTILE_RETARGET_CORRIDOR_TILE_FRACTION * tileSize;
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
      projectile.groundOnly,
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
    if (projectile.trueShot > 0 && enemy.type !== "boss" && this.rng() < projectile.trueShot) {
      const instantKillDamage = enemy.hp + 1;
      const dealtDamage = enemy.takeDamage(instantKillDamage, true) ?? instantKillDamage;
      this.recordDamage(projectile.towerId, dealtDamage);
      if (this.particles) {
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, {
          speed: 30,
          life: 0.2,
          opacity: HIT_PARTICLE_OPACITY_SCALE,
        });
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
        this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, {
          speed: 30,
          life: 0.2,
          opacity: HIT_PARTICLE_OPACITY_SCALE,
        });
      }
      if (projectile.isCrit && projectile.goldOnCrit > 0 && this.onGoldReward) {
        this.onGoldReward(projectile.goldOnCrit);
      }
      this.removeProjectile(projectile, "hit");
      return;
    }

    // Damage first so a marking shot does not multiply its own hit; mark after.
    const dealtDamage = enemy.takeDamage(scaledDamage, projectile.armorPiercing) ?? 0;
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
      enemy.applyBurn(projectile.burnDps, projectile.burnDuration, projectile.towerId);
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
          undefined,
          projectile.groundOnly,
        );
        if (nextTarget) {
          projectile.targetId = nextTarget.id;
          return;
        }
      }
    }

    if (projectile.splashRadius > 0 && this.particles) {
      const splashRadiusPx = projectile.splashRadius * (this.grid?.tileSize ?? 1);
      const tileSize = this.grid?.tileSize ?? GRID_TILE_SIZE;
      const splashDamage = scaledDamage * SPLASH_DAMAGE_RATIO;
      // Visitor scan: no per-hit in-range array. Visitor order matches
      // getEnemiesInRange's array order (one shape query, same filter), so the
      // damage application order to multiple splash targets is unchanged.
      this.enemyManager.forEachEnemyInRange(enemy.x, enemy.y, splashRadiusPx, (splashEnemy) => {
        if (splashEnemy.id === enemy.id) return;
        if (projectile.groundOnly && (splashEnemy.flyingHeight ?? 0) > 0) return;
        const dealtSplash = splashEnemy.takeDamage(splashDamage, projectile.armorPiercing) ?? 0;
        this.recordDamage(projectile.towerId, dealtSplash);

        if (projectile.markTarget > 0 && splashEnemy.applyMarkTarget) {
          splashEnemy.applyMarkTarget(projectile.markTarget, MARK_TARGET_DURATION);
        }
        if (projectile.burnDps > 0 && splashEnemy.applyBurn) {
          splashEnemy.applyBurn(projectile.burnDps, projectile.burnDuration, projectile.towerId);
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
      });
    }

    // Bounce Shot: redirect projectile to 1 nearby enemy (max 1 bounce).
    // Fixed-aim projectiles keep their aim point instead of re-homing.
    if (projectile.bounceShot && projectile.bounceCount < 1 && !projectile.fixedAim) {
      const bounceTarget = this.findNearestEnemy(
        projectile.x,
        projectile.y,
        projectile.range * (this.grid?.tileSize ?? 36),
        enemy.id,
        undefined,
        projectile.groundOnly,
      );
      if (bounceTarget) {
        projectile.targetId = bounceTarget.id;
        // Uniform bounce falloff: damage and applied status magnitudes scale by
        // the same factor so a bounced shot is weaker across the board. Stun is
        // duration-only, so its "magnitude" is the duration itself.
        projectile.damage *= BOUNCE_DAMAGE_FALLOFF;
        projectile.burnDps *= BOUNCE_DAMAGE_FALLOFF;
        projectile.slowFactor *= BOUNCE_DAMAGE_FALLOFF;
        projectile.stunDuration *= BOUNCE_DAMAGE_FALLOFF;
        projectile.splashStun *= BOUNCE_DAMAGE_FALLOFF;
        projectile.bounceCount++;
        return;
      }
    }

    if (this.particles) {
      this.particles.spawn(projectile.x, projectile.y, projectile.color, 3, {
        speed: 30,
        life: 0.2,
        opacity: HIT_PARTICLE_OPACITY_SCALE,
      });
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
    const isCrit = critChance > 0 && this.rng() < critChance;
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
      this.particles.spawn(current.x, current.y, opts.color ?? "#ffcf4d", 3, {
        speed: 30,
        life: 0.2,
        opacity: HIT_PARTICLE_OPACITY_SCALE,
      });
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
        this.particles.spawn(nextTarget.x, nextTarget.y, opts.color ?? "#ffcf4d", 3, {
          speed: 30,
          life: 0.2,
          opacity: HIT_PARTICLE_OPACITY_SCALE,
        });
      }
      // Burn Circuit: chained enemies take burn damage over time
      if (opts.burnCircuit && nextTarget.applyBurn) {
        nextTarget.applyBurn(chainDamage * BURN_CIRCUIT_DMG_MULT, BURN_CIRCUIT_DURATION, opts.towerId);
      }
      this.bufferLightningEffect({ x1: current.x, y1: current.y, x2: nextTarget.x, y2: nextTarget.y });
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
        const pickIndex = Math.floor(this.rng() * wideEnemies.length);
        const stormTarget = wideEnemies.splice(pickIndex, 1)[0]!;
        const stormDamage = finalDamage * CHAIN_DAMAGE_FALLOFF;
        const stormDealt = stormTarget.takeDamage(stormDamage) ?? stormDamage;
        this.recordDamage(opts.towerId, stormDealt);
        chainTargets.push(stormTarget);
        if (this.particles) {
          this.particles.spawn(stormTarget.x, stormTarget.y, opts.color ?? "#ffcf4d", 3, {
            speed: 30,
            life: 0.2,
            opacity: HIT_PARTICLE_OPACITY_SCALE,
          });
        }
        this.bufferLightningEffect({ x1: opts.originX, y1: opts.originY, x2: stormTarget.x, y2: stormTarget.y });
      }
    }

    if (opts.stunDuration > 0) {
      for (const target of chainTargets) {
        if (target.applyStun) target.applyStun(opts.stunDuration);
        this.bufferStunEffect({ x: target.x, y: target.y });
      }
      this.bufferLightningEffect({ x1: opts.originX, y1: opts.originY, x2: current.x, y2: current.y });
    }

    // Double Discharge: 10% chance to fire a second bolt to a different target
    if (opts.doubleDischarge && opts.doubleDischarge > 0 && this.rng() < opts.doubleDischarge) {
      const secondTarget = this.findNearestEnemy(
        opts.originX,
        opts.originY,
        (opts.range ?? CHAIN_RANGE) * (this.grid?.tileSize ?? 1),
        opts.targetId,
      );
      if (secondTarget) {
        const secondIsCrit = critChance > 0 && this.rng() < critChance;
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
        this.bufferLightningEffect({ x1: opts.originX, y1: opts.originY, x2: secondTarget.x, y2: secondTarget.y });
      }
    }
  }

  // Public entry for out-of-band damage sources (EnemyManager burn ticks) so they
  // credit the inflicting tower's totals exactly like a resolved hit.
  creditDamage(towerId: string, amount: number): void {
    this.recordDamage(towerId, amount);
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
    groundOnly = false,
  ): LightningTarget | null {
    // Allocation-free nearest-enemy search via the spatial-hash visitor. The
    // original built (up to 4) enemy arrays per call; here we scan incrementally
    // widening sub-ranges and stop at the first sub-range that yields a candidate
    // (any enemy found in a smaller sub-range is strictly closer than anything in
    // a larger one, so a later, wider scan cannot beat it). Strict `<` on squared
    // distance preserves the original first-found-wins tie-break exactly (visitor
    // iteration order is unchanged from getEnemiesInRange).
    this.nearestSearchX = x;
    this.nearestSearchY = y;
    this.nearestSearchExcludeId = excludeId;
    this.nearestSearchExcludeIds = excludeIds;
    this.nearestSearchGroundOnly = groundOnly;
    this.nearestSearchBest = null;
    this.nearestSearchBestDistSquared = Infinity;

    // Grid tile size, not the render constant: a non-36px map's first sub-range
    // must cover the same tile neighborhood the tower stats did.
    const tileSize = this.grid?.tileSize ?? GRID_TILE_SIZE;
    const subRanges = this.nearestSearchSubRanges;
    for (let index = 0; index < NEAREST_SEARCH_FRACTIONS.length; index++) {
      subRanges[index] = NEAREST_SEARCH_FRACTIONS[index]! * (index === 0 ? tileSize : range);
    }
    for (const subRange of subRanges) {
      this.enemyManager.forEachEnemyInRange(x, y, subRange, this.nearestSearchVisitor);
      if (this.nearestSearchBest) return this.nearestSearchBest;
    }
    return this.nearestSearchBest;
  }

  private removeProjectile(projectile: ProjectileGame, _reason: string): void {
    projectile.active = false;
    this.destroyProjectileBody(projectile.id);
  }

  getRenderData(): Array<{ id: number; x: number; y: number; radius: number; color: string; icon: string }> {
    const result = this.renderDataBuffer;
    result.length = 0;
    // Inactive entries are the impact frame postPhysics left for this snapshot.
    // prePhysics and update() splice them before the next cast.
    for (const projectile of this.projectiles) {
      result.push({
        id: projectile.id,
        x: projectile.x,
        y: projectile.y,
        radius: projectile.radius,
        color: projectile.color,
        icon: projectile.icon,
      });
    }
    return result;
  }

  getRenderVisualEffects(): { lightning: LightningVisualEffect[]; stuns: StunVisualEffect[] } {
    return { lightning: [...this.pendingLightning], stuns: [...this.pendingStuns] };
  }

  // Bounded buffer writes: newest effects are the ones a fresh snapshot still
  // draws, so evict the oldest when the cap is hit.
  private bufferLightningEffect(effect: LightningVisualEffect): void {
    if (this.pendingLightning.length >= MAX_PENDING_LIGHTNING_EFFECTS) {
      this.pendingLightning.shift();
    }
    this.pendingLightning.push(effect);
  }

  private bufferStunEffect(effect: StunVisualEffect): void {
    if (this.pendingStuns.length >= MAX_PENDING_STUN_EFFECTS) {
      this.pendingStuns.shift();
    }
    this.pendingStuns.push(effect);
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
    this.projectilesById.clear();
    this.pendingLightning = [];
    this.pendingStuns = [];
  }
}
