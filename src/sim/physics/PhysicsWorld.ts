import type RAPIER from "@dimforge/rapier2d-compat";
import { ActiveEvents, EventQueue } from "@dimforge/rapier2d-compat";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { corridorWallHalfThicknessWorld } from "@/sim/navmesh/navmeshConfig.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { ColliderTag } from "./ColliderUserData.js";
import { ContactProcessor } from "./ContactProcessor.js";
import {
  buildCorridorSegments,
  corridorConvexVertices,
  pathTowerCutCorners,
  terrainTowerCutCorners,
  terrainTowerLocalOutline,
  towerJutVertices,
} from "./corridorWalls.js";
import { launchEnemy } from "./launchEnemy.js";
import { getRapier } from "./rapierContext.js";

// Collision groups: membership << 16 | filter.
// Enemies: group 1, filter everything except other enemies when enemyEnemyCollisions is false.
// Projectiles: group 2, filter only enemies (group 1).
// Aura sensors: group 3, filter only enemies (group 1).
// Static world membership is explicit so a flyer filter can include the base and
// exclude towers and corridor walls. Ground filters stay all-groups (or all
// except enemies), which still match the new membership bits.
const enemyGroup = 0x0001;
const projectileGroup = 0x0002;
const sensorGroup = 0x0004;
const baseGroup = 0x0008;
const towerGroup = 0x0010;
const corridorGroup = 0x0020;
const allGroups = 0xffff;

// Query scratch Balls: one shared Ball per PhysicsWorld is reused across every
// range/cast query (radius reassigned per call) so per-tick query allocation stays
// at zero after construction. compat Balls are pure-JS (no free()), but hoisting
// still removes the per-query garbage. The counter exists so tests can assert that.
let scratchBallAllocationCount = 0;

export function getPhysicsQueryBallAllocations(): number {
  return scratchBallAllocationCount;
}

export function resetPhysicsQueryStatsForTests(): void {
  scratchBallAllocationCount = 0;
}

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
  // Shared query shape reused by every range/cast query (see module comment).
  private queryBall: RAPIER.Ball | null = null;

  constructor(grid: Grid) {
    const RAPIER = getRapier();
    this.grid = grid;
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = fixedDeltaSeconds;
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
    const colliderDesc = RAPIER.ColliderDesc.cuboid(half, half)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups((baseGroup << 16) | allGroups);
    this.world.createCollider(colliderDesc, this.baseBody);
  }

  rebuildTowers(towerManager: TowerManager): void {
    const RAPIER = getRapier();
    // Snapshot live ids before clearing: dropBodies emits no end-events, so every
    // tower id that disappears here must be pruned from the contact sets or
    // survivors keep parking against sold/ghosted towers.
    const staleTowerIds = new Set(this.towerById.keys());
    this.dropBodies(this.towerBodies);
    this.towerById.clear();
    // A square terrain tower fills the corridor chamfer pocket. Cutting the corner
    // that owns that vertex puts the collider diagonal on the wall enemies already
    // slide. Path towers get the same treatment where their cuboid corner juts
    // into open corridor (wall-block S-bends), so a detouring body slides the
    // diagonal instead of pinning on the square corner.
    const convexVertices = corridorConvexVertices(this.grid);
    const jutVertices = towerJutVertices(this.grid);
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
      const cutCorners =
        terrainTowerCutCorners(this.grid, tower.tileX, tower.tileY, convexVertices) ??
        pathTowerCutCorners(this.grid, tower.tileX, tower.tileY, jutVertices);
      const outline = cutCorners ? terrainTowerLocalOutline(this.grid.tileSize, cutCorners) : null;
      const chamfered = outline
        ? (RAPIER.ColliderDesc.convexPolyline(outline) ?? RAPIER.ColliderDesc.convexHull(outline))
        : null;
      const colliderDesc = (chamfered ?? RAPIER.ColliderDesc.cuboid(half, half))
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups((towerGroup << 16) | allGroups);
      this.world.createCollider(colliderDesc, body);
      this.towerBodies.push(body);
    }
    for (const staleTowerId of staleTowerIds) {
      if (!this.towerById.has(staleTowerId)) this.contactProcessor.removeTower(staleTowerId);
    }
  }

  rebuildCorridor(): void {
    const RAPIER = getRapier();
    this.dropBodies(this.corridorBodies);
    const segments = buildCorridorSegments(this.grid);
    const halfThickness = corridorWallHalfThicknessWorld(this.grid.tileSize);
    const corridorTag: ColliderTag = { kind: "corridor" };
    for (const segment of segments) {
      const centerX = (segment.x1 + segment.x2) / 2;
      const centerY = (segment.y1 + segment.y2) / 2;
      const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
      const angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY).setRotation(angle).setUserData(corridorTag),
      );
      // Corridor walls emit collision events for the counter-only wall-pin metric in
      // ContactProcessor; they never park or damage (see Enemy.postPhysics drift resync).
      const corridorCollider = RAPIER.ColliderDesc.cuboid(length / 2, halfThickness)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups((corridorGroup << 16) | allGroups);
      this.world.createCollider(corridorCollider, body);
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
      // Explicit groups/events instead of Rapier defaults: membership sensor group,
      // filter enemies only, collision events on so sensor overlap pairs are tracked
      // (Rapier2d reports sensor intersections through the collision-event drain).
      const colliderDesc = RAPIER.ColliderDesc.ball(spec.radius)
        .setSensor(true)
        .setCollisionGroups((sensorGroup << 16) | enemyGroup)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS);
      this.world.createCollider(colliderDesc, body);
      this.auraSensors.set(spec.sensorId, { body, radius: spec.radius });
    }
  }

  // True only when the sensor entry and its collider exist. Callers use the
  // boolean to decide between sensor-authoritative hits and a spatial fallback,
  // so a missing sensor must not read as "handled, zero hits".
  forEachSensorHits(sensorId: string, callback: (enemy: Enemy) => void): boolean {
    const entry = this.auraSensors.get(sensorId);
    if (!entry) return false;
    const collider = entry.body.collider(0);
    if (!collider) return false;
    this.world.intersectionPairsWith(collider, (other) => {
      const enemy = this.enemyFromCollider(other);
      if (enemy) callback(enemy);
    });
    return true;
  }

  // Density scales with radius so tanks resist push more than runners.
  private enemyDensity(enemy: Enemy): number {
    const radiusFactor = Math.max(0.05, enemy.radius / (this.grid.tileSize * 0.14));
    // Default Rapier ball density is 1.0; scale around that.
    return Math.max(0.25, radiusFactor * radiusFactor);
  }

  addEnemy(enemy: Enemy): void {
    const RAPIER = getRapier();
    // CCD in per-step displacement units: enable when one step moves the body more
    // than half its radius, so fast runners cannot tunnel. (The old `speed >= 2.0`
    // tiles/sec check mixed up units and over/under-enabled by tile size.)
    const stepDisplacement = enemy.speed * this.grid.tileSize * fixedDeltaSeconds;
    const enableCcd = stepDisplacement >= enemy.radius * 0.5;
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
    colliderDesc.setCollisionGroups(this.collisionGroupsForEnemy(enemy));
    this.world.createCollider(colliderDesc, body);
    enemy.body = body;
    this.enemyByHandle.set(body.handle, enemy);
  }

  // Live toggle: flips the flag AND sweeps every existing enemy collider so a
  // mid-run change takes effect immediately instead of applying only to spawns.
  setEnemyEnemyCollisions(enabled: boolean): void {
    this.enemyEnemyCollisions = enabled;
    for (const enemy of this.enemyByHandle.values()) {
      enemy.body?.collider(0).setCollisionGroups(this.collisionGroupsForEnemy(enemy));
    }
  }

  // Ground keeps an all-groups filter (minus enemies when the toggle is off).
  // A flyer keeps base, projectile, and sensor, and drops tower and corridor so
  // those cuboids cannot push it. A later toggle must not stamp the ground mask
  // back onto a flyer.
  private collisionGroupsForEnemy(enemy: Enemy): number {
    const flyerFilter = baseGroup | projectileGroup | sensorGroup;
    const filter =
      enemy.flyingHeight > 0
        ? flyerFilter | (this.enemyEnemyCollisions ? enemyGroup : 0)
        : this.enemyEnemyCollisions
          ? allGroups
          : allGroups & ~enemyGroup;
    return (enemyGroup << 16) | filter;
  }

  removeEnemy(enemy: Enemy): void {
    if (enemy.body) {
      // Prune contacts first: removeRigidBody emits no end-events, so without this
      // the dead id lingers in the sets (unbounded growth + recycled-id collision).
      this.contactProcessor.removeEnemy(enemy.id);
      this.enemyByHandle.delete(enemy.body.handle);
      this.world.removeRigidBody(enemy.body);
      enemy.body = null;
    }
  }

  applyImpulse(enemy: Enemy, impulseX: number, impulseY: number): void {
    if (!enemy.body) return;
    enemy.body.applyImpulse({ x: impulseX, y: impulseY }, true);
  }

  // Shared knockback entry for callers holding the world: impulse + ballistic
  // window + motion-lock release (see launchEnemy).
  launchEnemy(enemy: Enemy, impulseX: number, impulseY: number): void {
    launchEnemy(enemy, impulseX, impulseY);
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
      colliderDesc.setCollisionGroups((projectileGroup << 16) | allGroups);
    } else {
      // Only collide with enemies (group 1).
      colliderDesc.setCollisionGroups((projectileGroup << 16) | enemyGroup);
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

  projectileSensorRadius(projectileId: number): number | null {
    const collider = this.projectileBodies.get(projectileId)?.collider(0);
    if (!collider) return null;
    return collider.radius();
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

  // Returns the shared scratch Ball sized to `radius`. One allocation per world;
  // every query path reuses it so per-tick Ball allocation stays at zero.
  private scratchBall(radius: number): RAPIER.Ball {
    const RAPIER = getRapier();
    if (!this.queryBall) {
      this.queryBall = new RAPIER.Ball(radius);
      scratchBallAllocationCount++;
    } else {
      this.queryBall.radius = radius;
    }
    return this.queryBall;
  }

  queryEnemiesInRange(x: number, y: number, range: number): Enemy[] {
    const result: Enemy[] = [];
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      this.scratchBall(range),
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
    const rangeSquared = range * range;
    this.world.intersectionsWithShape(
      { x, y },
      0,
      this.scratchBall(range),
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
    const length = Math.hypot(dirX, dirY) || 1;
    const velocity = { x: (dirX / length) * maxDistance, y: (dirY / length) * maxDistance };
    const excludedSet = excluded instanceof Set ? excluded : excluded ? new Set([excluded]) : null;
    const hit = this.world.castShape(
      { x: originX, y: originY },
      0,
      velocity,
      this.scratchBall(ballRadius),
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
    groundOnly = false,
  ): void {
    const excluded = new Set<RAPIER.Collider>();
    let hits = 0;
    while (hits < maxHits) {
      const result = this.castShapeFirstEnemy(originX, originY, dirX, dirY, ballRadius, maxDistance, excluded);
      if (!result) break;
      // Ground-only casts pass over flyers without consuming a pierce slot so
      // maxHits still lands on hittable ground enemies behind them.
      if (groundOnly && result.enemy.flyingHeight > 0) {
        excluded.add(result.collider);
        continue;
      }
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

  step(fixedDt: number = fixedDeltaSeconds): void {
    // The sim runs on a fixed timestep: every production step must carry exactly
    // fixedDeltaSeconds (GameEngine.update passes it explicitly). The default keeps
    // variable-dt-free test call sites green; anything else is a caller bug.
    if (fixedDt !== fixedDeltaSeconds) {
      throw new Error(`PhysicsWorld.step expects fixedDeltaSeconds (${fixedDeltaSeconds}), got ${fixedDt}`);
    }
    this.world.timestep = fixedDt;
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
