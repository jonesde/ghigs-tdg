import type RAPIER from "@dimforge/rapier2d-compat";
import { ActiveEvents, EventQueue } from "@dimforge/rapier2d-compat";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { ColliderTag } from "./ColliderUserData.js";
import { ContactProcessor } from "./ContactProcessor.js";
import { buildCorridorSegments } from "./corridorWalls.js";
import { getRapier } from "./rapierContext.js";

// Collision groups: membership << 16 | filter.
// Enemies: group 1, filter everything except other enemies when enemyEnemyCollisions is false.
// Projectiles: group 2, filter only enemies (group 1).
// Static world (base/towers/walls): default (all groups).
const ENEMY_GROUP = 0x0001;
const PROJECTILE_GROUP = 0x0002;
const ALL_GROUPS = 0xffff;

export interface ProjectileBodyOptions {
  projectileId: number;
  x: number;
  y: number;
  radius: number;
  velocityX: number;
  velocityY: number;
  // Sensor: collision events still fire, but the kinematic ball does not shove
  // the enemy. Solid resolve is what pushed melee targets off a blocking tower.
  isSensor?: boolean;
  restitution?: number;
  collidesWithWalls?: boolean;
}

// Wraps one Rapier2d world: enemy motion, static geometry, projectile bodies,
// contact events, impulses, and mass/CCD. Always on after getRapier() resolves.
export class PhysicsWorld {
  private grid: Grid;
  private world: RAPIER.World;
  private eventQueue: EventQueue;
  private baseBody: RAPIER.RigidBody | null = null;
  private towerBodies: RAPIER.RigidBody[] = [];
  private corridorBodies: RAPIER.RigidBody[] = [];
  private enemyByHandle: Map<number, Enemy> = new Map();
  private towerById: Map<string, Tower> = new Map();
  private projectileBodies: Map<number, RAPIER.RigidBody> = new Map();
  private auraSensors: Map<string, { body: RAPIER.RigidBody; radius: number }> = new Map();
  private contactProcessor: ContactProcessor;
  // When false, DetourCrowd owns enemy-enemy avoidance (GameEngine sets this).
  enemyEnemyCollisions = true;

  constructor(grid: Grid) {
    const RAPIER = getRapier();
    this.grid = grid;
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = FIXED_DT;
    // Pixel-space world: typical enemy diameter is a fraction of a tile. Rapier
    // scales solver slop / CCD / sleep thresholds by lengthUnit.
    this.world.lengthUnit = grid.tileSize * 0.25;
    this.eventQueue = new EventQueue(true);
    this.contactProcessor = new ContactProcessor({
      getEnemyById: (enemyId) => this.findEnemyById(enemyId),
      getTowerById: (towerId) => this.towerById.get(towerId) ?? null,
    });
    this.buildBase();
    this.rebuildCorridor();
  }

  setContactProcessor(contactProcessor: ContactProcessor | null): void {
    this.contactProcessor =
      contactProcessor ??
      new ContactProcessor({
        getEnemyById: (enemyId) => this.findEnemyById(enemyId),
        getTowerById: (towerId) => this.towerById.get(towerId) ?? null,
      });
  }

  getContactProcessor(): ContactProcessor {
    return this.contactProcessor;
  }

  private findEnemyById(enemyId: number): Enemy | null {
    for (const enemy of this.enemyByHandle.values()) {
      if (enemy.id === enemyId && !enemy.removed) return enemy;
    }
    return null;
  }

  buildBase(): void {
    const RAPIER = getRapier();
    this.dropBase();
    const baseCenter = this.grid.tileToWorld(this.grid.getBase().x, this.grid.getBase().y);
    const half = 1.5 * this.grid.tileSize;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(baseCenter.x, baseCenter.y)
      .setUserData({ kind: "base" } satisfies ColliderTag);
    this.baseBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(half, half).setActiveEvents(ActiveEvents.COLLISION_EVENTS);
    this.world.createCollider(colliderDesc, this.baseBody);
  }

  rebuildTowers(towerManager: TowerManager): void {
    const RAPIER = getRapier();
    this.dropBodies(this.towerBodies);
    this.towerById.clear();
    for (const tower of towerManager.towers) {
      if (tower.isGhost) continue;
      this.towerById.set(tower.id, tower);
      const centerX = tower.x ?? this.grid.tileToWorld(tower.tileX, tower.tileY).x;
      const centerY = tower.y ?? this.grid.tileToWorld(tower.tileX, tower.tileY).y;
      const half = this.grid.tileSize / 2;
      const tag: ColliderTag = { kind: "tower", towerId: tower.id, tileX: tower.tileX, tileY: tower.tileY };
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY).setUserData(tag),
      );
      const colliderDesc = RAPIER.ColliderDesc.cuboid(half, half).setActiveEvents(ActiveEvents.COLLISION_EVENTS);
      this.world.createCollider(colliderDesc, body);
      this.towerBodies.push(body);
    }
  }

  rebuildCorridor(): void {
    const RAPIER = getRapier();
    this.dropBodies(this.corridorBodies);
    const segments = buildCorridorSegments(this.grid);
    const halfThickness = this.grid.tileSize * 0.05;
    const corridorTag: ColliderTag = { kind: "corridor" };
    for (const segment of segments) {
      const centerX = (segment.x1 + segment.x2) / 2;
      const centerY = (segment.y1 + segment.y2) / 2;
      const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
      const angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY).setRotation(angle).setUserData(corridorTag),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(length / 2, halfThickness), body);
      this.corridorBodies.push(body);
    }
  }

  debugRenderVertices(): number[] {
    const buffers = this.world.debugRender();
    return Array.from(buffers.vertices);
  }

  syncAuraSensors(specs: { sensorId: string; x: number; y: number; radius: number }[]): void {
    const RAPIER = getRapier();
    const liveIds = new Set(specs.map((spec) => spec.sensorId));
    for (const [sensorId, entry] of this.auraSensors) {
      if (liveIds.has(sensorId)) continue;
      this.world.removeRigidBody(entry.body);
      this.auraSensors.delete(sensorId);
    }
    for (const spec of specs) {
      const existing = this.auraSensors.get(spec.sensorId);
      if (existing && Math.abs(existing.radius - spec.radius) < 1e-6) {
        existing.body.setTranslation({ x: spec.x, y: spec.y }, true);
        continue;
      }
      if (existing) {
        this.world.removeRigidBody(existing.body);
        this.auraSensors.delete(spec.sensorId);
      }
      const tag: ColliderTag = { kind: "sensor", sensorId: spec.sensorId };
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(spec.x, spec.y).setUserData(tag),
      );
      const colliderDesc = RAPIER.ColliderDesc.ball(spec.radius).setSensor(true);
      this.world.createCollider(colliderDesc, body);
      this.auraSensors.set(spec.sensorId, { body, radius: spec.radius });
    }
  }

  forEachSensorHits(sensorId: string, callback: (enemy: Enemy) => void): void {
    const entry = this.auraSensors.get(sensorId);
    if (!entry) return;
    const collider = entry.body.collider(0);
    if (!collider) return;
    this.world.intersectionPairsWith(collider, (other) => {
      const enemy = this.enemyFromCollider(other);
      if (enemy) callback(enemy);
    });
  }

  // Density scales with radius so tanks resist push more than runners.
  private enemyDensity(enemy: Enemy): number {
    const radiusFactor = Math.max(0.05, enemy.radius / (this.grid.tileSize * 0.14));
    // Default Rapier ball density is 1.0; scale around that.
    return Math.max(0.25, radiusFactor * radiusFactor);
  }

  addEnemy(enemy: Enemy): void {
    const RAPIER = getRapier();
    const enableCcd = enemy.speed >= 2.0;
    const tag: ColliderTag = { kind: "enemy", enemyId: enemy.id };
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(enemy.x, enemy.y)
      .lockRotations()
      .setLinearDamping(0.9)
      .setCcdEnabled(enableCcd)
      .setUserData(tag);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(enemy.radius).setRestitution(0).setDensity(this.enemyDensity(enemy));
    // ActiveEvents set after create so default solid collision path matches pre-plan behavior.
    colliderDesc.setActiveEvents(ActiveEvents.COLLISION_EVENTS);
    if (!this.enemyEnemyCollisions) {
      // Membership enemy group; filter all except enemy group.
      colliderDesc.setCollisionGroups((ENEMY_GROUP << 16) | (ALL_GROUPS & ~ENEMY_GROUP));
    }
    this.world.createCollider(colliderDesc, body);
    enemy.body = body;
    this.enemyByHandle.set(body.handle, enemy);
  }

  setEnemyEnemyCollisions(enabled: boolean): void {
    this.enemyEnemyCollisions = enabled;
  }

  removeEnemy(enemy: Enemy): void {
    if (enemy.body) {
      this.enemyByHandle.delete(enemy.body.handle);
      this.world.removeRigidBody(enemy.body);
      enemy.body = null;
    }
  }

  applyImpulse(enemy: Enemy, impulseX: number, impulseY: number): void {
    if (!enemy.body) return;
    enemy.body.applyImpulse({ x: impulseX, y: impulseY }, true);
  }

  addProjectileBody(options: ProjectileBodyOptions): RAPIER.RigidBody {
    const RAPIER = getRapier();
    this.removeProjectileBody(options.projectileId);
    const tag: ColliderTag = { kind: "projectile", projectileId: options.projectileId };
    // Kinematic velocity-based: we set linvel each tick for homing; solid or sensor.
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased()
      .setTranslation(options.x, options.y)
      .lockRotations()
      .setLinvel(options.velocityX, options.velocityY)
      .setCcdEnabled(true)
      .setUserData(tag);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(options.radius)
      .setRestitution(options.restitution ?? 0)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS);
    if (options.isSensor) colliderDesc.setSensor(true);
    if (options.collidesWithWalls) {
      // Hit everything including walls.
      colliderDesc.setCollisionGroups((PROJECTILE_GROUP << 16) | ALL_GROUPS);
    } else {
      // Only collide with enemies (group 1).
      colliderDesc.setCollisionGroups((PROJECTILE_GROUP << 16) | ENEMY_GROUP);
    }
    this.world.createCollider(colliderDesc, body);
    this.projectileBodies.set(options.projectileId, body);
    return body;
  }

  setProjectileVelocity(projectileId: number, velocityX: number, velocityY: number): void {
    const body = this.projectileBodies.get(projectileId);
    if (!body) return;
    body.setLinvel({ x: velocityX, y: velocityY }, true);
  }

  getProjectilePosition(projectileId: number): { x: number; y: number } | null {
    const body = this.projectileBodies.get(projectileId);
    if (!body) return null;
    const translation = body.translation();
    return { x: translation.x, y: translation.y };
  }

  removeProjectileBody(projectileId: number): void {
    const body = this.projectileBodies.get(projectileId);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.projectileBodies.delete(projectileId);
  }

  private isEnemyCollider = (collider: RAPIER.Collider): boolean => {
    const parent = collider.parent();
    return parent !== null && this.enemyByHandle.has(parent.handle);
  };

  private enemyFromCollider(collider: RAPIER.Collider): Enemy | null {
    const parent = collider.parent();
    if (!parent) return null;
    const enemy = this.enemyByHandle.get(parent.handle);
    return enemy && !enemy.removed ? enemy : null;
  }

  queryEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const RAPIER = getRapier();
    const result: Enemy[] = [];
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      new RAPIER.Ball(range),
      (collider) => {
        const enemy = this.enemyFromCollider(collider);
        if (enemy) {
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) result.push(enemy);
        }
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      this.isEnemyCollider,
    );
    return result;
  }

  forEachEnemyInRange(x: number, y: number, range: number, cb: (enemy: Enemy) => void): void {
    const RAPIER = getRapier();
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      new RAPIER.Ball(range),
      (collider) => {
        const enemy = this.enemyFromCollider(collider);
        if (enemy) {
          const deltaX = enemy.x - x;
          const deltaY = enemy.y - y;
          if (deltaX * deltaX + deltaY * deltaY <= rangeSquared) cb(enemy);
        }
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      this.isEnemyCollider,
    );
  }

  castShapeFirstEnemy(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    excluded?: RAPIER.Collider | Set<RAPIER.Collider> | null,
  ): { enemy: Enemy; collider: RAPIER.Collider } | null {
    const RAPIER = getRapier();
    const length = Math.hypot(dirX, dirY) || 1;
    const velocity = { x: (dirX / length) * maxDistance, y: (dirY / length) * maxDistance };
    const excludedSet = excluded instanceof Set ? excluded : excluded ? new Set([excluded]) : null;
    const hit = this.world.castShape(
      { x: originX, y: originY },
      0,
      velocity,
      new RAPIER.Ball(ballRadius),
      0,
      1,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => {
        if (excludedSet?.has(collider)) return false;
        return this.isEnemyCollider(collider);
      },
    );
    if (!hit) return null;
    const enemy = this.enemyFromCollider(hit.collider);
    if (!enemy) return null;
    return { enemy, collider: hit.collider };
  }

  castShapePierce(
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    ballRadius: number,
    maxDistance: number,
    maxHits: number,
    cb: (enemy: Enemy) => boolean,
  ): void {
    const excluded = new Set<RAPIER.Collider>();
    let hits = 0;
    while (hits < maxHits) {
      const result = this.castShapeFirstEnemy(originX, originY, dirX, dirY, ballRadius, maxDistance, excluded);
      if (!result) break;
      hits++;
      const keepGoing = cb(result.enemy);
      if (!keepGoing) break;
      excluded.add(result.collider);
    }
  }

  setEnemyVelocity(enemy: Enemy, vx: number, vy: number): void {
    enemy.body?.setLinvel({ x: vx, y: vy }, true);
  }

  getEnemyPosition(enemy: Enemy): { x: number; y: number } | null {
    return enemy.body ? enemy.body.translation() : null;
  }

  step(): void {
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const collider1 = this.world.getCollider(handle1);
      const collider2 = this.world.getCollider(handle2);
      const body1 = collider1?.parent() ?? null;
      const body2 = collider2?.parent() ?? null;
      this.contactProcessor.handleCollision(body1, body2, started);
    });
    this.contactProcessor.applyContactFlags(Array.from(this.enemyByHandle.values()));
  }

  private dropBodies(bodies: RAPIER.RigidBody[]): void {
    for (const body of bodies) {
      this.world.removeRigidBody(body);
    }
    bodies.length = 0;
  }

  private dropBase(): void {
    if (this.baseBody) {
      this.world.removeRigidBody(this.baseBody);
      this.baseBody = null;
    }
  }

  dispose(): void {
    this.baseBody = null;
    this.towerBodies = [];
    this.corridorBodies = [];
    this.projectileBodies.clear();
    this.auraSensors.clear();
    this.enemyByHandle.clear();
    this.towerById.clear();
    this.contactProcessor.clear();
    if (this.eventQueue) {
      this.eventQueue.free();
      this.eventQueue = null as unknown as EventQueue;
    }
    if (this.world) {
      this.world.free();
      this.world = null as unknown as RAPIER.World;
    }
  }
}
