import type RAPIER from "@dimforge/rapier2d-compat";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { type ColliderTag, isColliderTag } from "./ColliderUserData.js";

export interface ProjectileHitEvent {
  projectileId: number;
  enemyId: number;
}

export interface ContactProcessorHooks {
  getEnemyById(enemyId: number): Enemy | null | undefined;
  getTowerById(towerId: string): Tower | null | undefined;
  onProjectileHit?(projectileId: number, enemyId: number): void;
}

// Drains Rapier collision events into gameplay flags: enemy↔base, enemy↔tower,
// projectile↔enemy. Maintains active contact sets so attack ticks only run while
// contact is live.
export class ContactProcessor {
  private hooks: ContactProcessorHooks;
  // enemyId → true while overlapping base collider
  private enemyBaseContact = new Set<number>();
  // enemyId → tower ids currently overlapping
  private enemyTowerContact = new Map<number, Set<string>>();
  // Accumulated projectile hits this step (consumed by ProjectileManager)
  private projectileHits: ProjectileHitEvent[] = [];

  constructor(hooks: ContactProcessorHooks) {
    this.hooks = hooks;
  }

  setHooks(hooks: ContactProcessorHooks): void {
    this.hooks = hooks;
  }

  clear(): void {
    this.enemyBaseContact.clear();
    this.enemyTowerContact.clear();
    this.projectileHits = [];
  }

  // Process one collision event pair. `started` true = begin contact.
  handleCollision(body1: RAPIER.RigidBody | null, body2: RAPIER.RigidBody | null, started: boolean): void {
    const tag1 = tagFromBody(body1);
    const tag2 = tagFromBody(body2);
    if (!tag1 || !tag2) return;

    this.handlePair(tag1, tag2, started);
    this.handlePair(tag2, tag1, started);
  }

  private handlePair(tagA: ColliderTag, tagB: ColliderTag, started: boolean): void {
    if (tagA.kind === "enemy" && tagB.kind === "base") {
      if (started) this.enemyBaseContact.add(tagA.enemyId);
      else this.enemyBaseContact.delete(tagA.enemyId);
      return;
    }
    if (tagA.kind === "enemy" && tagB.kind === "tower") {
      let towerIds = this.enemyTowerContact.get(tagA.enemyId);
      if (started) {
        if (!towerIds) {
          towerIds = new Set();
          this.enemyTowerContact.set(tagA.enemyId, towerIds);
        }
        towerIds.add(tagB.towerId);
      } else if (towerIds) {
        towerIds.delete(tagB.towerId);
        if (towerIds.size === 0) this.enemyTowerContact.delete(tagA.enemyId);
      }
      return;
    }
    if (tagA.kind === "projectile" && tagB.kind === "enemy" && started) {
      this.projectileHits.push({ projectileId: tagA.projectileId, enemyId: tagB.enemyId });
      this.hooks.onProjectileHit?.(tagA.projectileId, tagB.enemyId);
    }
  }

  isEnemyTouchingBase(enemyId: number): boolean {
    return this.enemyBaseContact.has(enemyId);
  }

  getEnemyTowerContact(enemyId: number): string | null {
    const towerIds = this.enemyTowerContact.get(enemyId);
    if (!towerIds || towerIds.size === 0) return null;
    const firstId = towerIds.values().next().value;
    return firstId ?? null;
  }

  getEnemyTowerContacts(enemyId: number): ReadonlySet<string> {
    return this.enemyTowerContact.get(enemyId) ?? emptyTowerIds;
  }

  // Project live contact sets onto enemy attack flags. Damage ticks run in
  // Enemy.postPhysics while these flags stay true. Cross-module: parks/unparks
  // crowd motion so the agent does not keep steering while overlapping the
  // objective, and re-issues a move target after contact ends.
  applyContactFlags(enemies: Enemy[]): void {
    for (const enemy of enemies) {
      if (enemy.removed) continue;

      const touchingBase = this.enemyBaseContact.has(enemy.id);
      // attackingBase latches for the life of the enemy: first overlap parks them
      // at the base and they keep attacking even if bounce/contact flicker drops
      // the overlap set. Only death (removed) or game-over clear ends it.
      if (touchingBase || enemy.attackingBase) {
        if (!enemy.attackingBase) {
          enemy.attackingBase = true;
          enemy.lastMoveTargetWorld = null;
          enemy.lastMoveTargetMode = null;
          enemy.agent?.resetMoveTarget();
        }
        enemy.motionLock = "park";
      }

      const tower = this.pickContactTower(enemy, this.enemyTowerContact.get(enemy.id));
      if (tower && !tower.isGhost) {
        enemy.blockedByTower = tower;
        if (enemy.routingMode === "siege" && !enemy.attackingBase) {
          enemy.motionLock = "park";
        }
      } else {
        enemy.blockedByTower = null;
        if (
          enemy.routingMode === "siege" &&
          enemy.motionLock === "park" &&
          enemy.stunTimer <= 0 &&
          !enemy.attackingBase
        ) {
          enemy.motionLock = "none";
        }
      }
    }
  }

  applyToEnemies(enemies: Enemy[]): ProjectileHitEvent[] {
    this.applyContactFlags(enemies);
    return this.drainProjectileHits();
  }

  drainProjectileHits(): ProjectileHitEvent[] {
    const hits = this.projectileHits;
    this.projectileHits = [];
    return hits;
  }

  private pickContactTower(enemy: Enemy, towerIds: Set<string> | undefined): Tower | null {
    if (!towerIds || towerIds.size === 0) return null;
    // Immune towers are terrain placements. Skipping them keeps a corner brush
    // from parking the enemy in a siege that can never destroy the tower.
    if (
      enemy.routingMode === "siege" &&
      enemy.siegeTower &&
      !enemy.siegeTower.isGhost &&
      !enemy.siegeTower.enemyAttackImmune
    ) {
      if (towerIds.has(enemy.siegeTower.id)) return enemy.siegeTower;
    }
    let lowestTower: Tower | null = null;
    for (const towerId of towerIds) {
      const tower = this.hooks.getTowerById(towerId);
      if (!tower || tower.isGhost || tower.enemyAttackImmune) continue;
      if (!lowestTower || tower.health < lowestTower.health) lowestTower = tower;
    }
    return lowestTower;
  }
}

const emptyTowerIds: ReadonlySet<string> = new Set();

function tagFromBody(body: RAPIER.RigidBody | null): ColliderTag | null {
  if (!body) return null;
  const userData = body.userData;
  return isColliderTag(userData) ? userData : null;
}
