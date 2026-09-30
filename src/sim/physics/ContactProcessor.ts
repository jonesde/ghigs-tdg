import type RAPIER from "@dimforge/rapier2d-compat";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { type ColliderTag, parseColliderTag } from "./ColliderUserData.js";

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
  // enemyId → started-corridor-contact count this run. Counter-only wall-pin metric:
  // corridor walls emit COLLISION_EVENTS but never park or damage; Enemy.postPhysics
  // drift resync owns wall-shove recovery. Pruned alongside the other sets.
  private corridorPinCount = new Map<number, number>();
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
    this.corridorPinCount.clear();
    this.projectileHits = [];
  }

  // Drops every contact record for one enemy. Call when the enemy body is destroyed
  // (PhysicsWorld.removeEnemy, which EnemyManager.removeDeadEnemy funnels through)
  // because Rapier emits no end-events for removed bodies — without this the sets
  // grow unbounded and a dead id can collide with a recycled one.
  removeEnemy(enemyId: number): void {
    this.enemyBaseContact.delete(enemyId);
    this.enemyTowerContact.delete(enemyId);
    this.corridorPinCount.delete(enemyId);
  }

  // Drops one tower from every enemy contact set. Call for each tower id that
  // disappears in PhysicsWorld.rebuildTowers (sold/ghosted) for the same no-end-event
  // reason: otherwise the survivor set keeps parking enemies against air.
  removeTower(towerId: string): void {
    for (const [enemyId, towerIds] of this.enemyTowerContact) {
      towerIds.delete(towerId);
      if (towerIds.size === 0) this.enemyTowerContact.delete(enemyId);
    }
  }

  // Drops all tower contacts while keeping base contacts and pin metrics.
  clearTowerContacts(): void {
    this.enemyTowerContact.clear();
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
      return;
    }
    if (tagA.kind === "enemy" && tagB.kind === "corridor" && started) {
      this.corridorPinCount.set(tagA.enemyId, (this.corridorPinCount.get(tagA.enemyId) ?? 0) + 1);
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

  getCorridorPinCount(enemyId: number): number {
    return this.corridorPinCount.get(enemyId) ?? 0;
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

      // Flyers are not pushed by tower cuboids. Assigning blockedByTower from a
      // contact that is not there, or clearing a flight siege park when the set
      // is empty, would drop both the strafe and the commanded siege.
      if (enemy.flyingHeight > 0) continue;

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
      // Equal-health tie-break by towerId string compare so multi-tower contact is
      // deterministic regardless of Rapier event arrival order.
      if (
        !lowestTower ||
        tower.health < lowestTower.health ||
        (tower.health === lowestTower.health && tower.id < lowestTower.id)
      ) {
        lowestTower = tower;
      }
    }
    return lowestTower;
  }
}

const emptyTowerIds: ReadonlySet<string> = new Set();

function tagFromBody(body: RAPIER.RigidBody | null): ColliderTag | null {
  if (!body) return null;
  // Strict per-kind validation: malformed tags are dropped instead of planting contacts.
  return parseColliderTag(body.userData);
}
