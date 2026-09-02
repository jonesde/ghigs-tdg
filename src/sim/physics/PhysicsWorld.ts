import type RAPIER from "@dimforge/rapier2d-compat";
import { ActiveEvents, EventQueue } from "@dimforge/rapier2d-compat";
import { FIXED_DT } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { Grid } from "@/sim/grid/Grid.js";
import { corridorWallInsetWorld } from "@/sim/navmesh/navmeshConfig.js";
import type { Tower } from "@/sim/towers/Tower.js";
import type { TowerManager } from "@/sim/towers/TowerManager.js";
import type { ColliderTag } from "./ColliderUserData.js";
import { ContactProcessor } from "./ContactProcessor.js";
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
  // Sensor projectiles fire contact events without solid resolve (pierce).
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

  private isWalkable(x: number, y: number): boolean {
    return this.grid.isPath(x, y) || this.grid.isBase(x, y) || this.grid.isSpawn(x, y);
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
    const tileSize = this.grid.tileSize;
    const halfThickness = tileSize * 0.05;

    const walkableTiles: { x: number; y: number }[] = [];
    const seenWalkable = new Set<string>();
    const addWalkable = (x: number, y: number): void => {
      const key = `${x},${y}`;
      if (seenWalkable.has(key)) return;
      seenWalkable.add(key);
      walkableTiles.push({ x, y });
    };
    for (let tileY = 0; tileY < this.grid.height; tileY++) {
      for (let tileX = 0; tileX < this.grid.width; tileX++) {
        if (this.isWalkable(tileX, tileY)) addWalkable(tileX, tileY);
      }
    }

    const convexCorners = new Set<string>();
    const convexDirs = new Map<string, { sx: number; sy: number }>();
    const cornerKey = (i: number, j: number): string => `${i},${j}`;
    for (let j = 1; j < this.grid.height; j++) {
      for (let i = 1; i < this.grid.width; i++) {
        const nw = this.isWalkable(i - 1, j - 1);
        const ne = this.isWalkable(i, j - 1);
        const sw = this.isWalkable(i - 1, j);
        const se = this.isWalkable(i, j);
        let sx = 0;
        let sy = 0;
        if (!nw && ne && sw) {
          sx = 1;
          sy = 1;
        } else if (!ne && nw && se) {
          sx = -1;
          sy = 1;
        } else if (!sw && nw && se) {
          sx = 1;
          sy = -1;
        } else if (!se && ne && sw) {
          sx = -1;
          sy = -1;
        }
        if (sx !== 0) {
          const key = cornerKey(i, j);
          convexCorners.add(key);
          convexDirs.set(key, { sx, sy });
        }
      }
    }

    const inset = corridorWallInsetWorld(tileSize);
    const chamferHalfThickness = halfThickness;
    const neighbors = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    const corridorTag: ColliderTag = { kind: "corridor" };

    const addWallSegment = (x1: number, y1: number, x2: number, y2: number): void => {
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;
      const horizontal = y1 === y2;
      const halfX = horizontal ? Math.abs(x2 - x1) / 2 : chamferHalfThickness;
      const halfY = horizontal ? chamferHalfThickness : Math.abs(y2 - y1) / 2;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY).setUserData(corridorTag),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY), body);
      this.corridorBodies.push(body);
    };

    for (const tile of walkableTiles) {
      for (const neighbor of neighbors) {
        const nx = tile.x + neighbor.dx;
        const ny = tile.y + neighbor.dy;
        if (this.isWalkable(nx, ny)) continue;

        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;
        let c1i: number;
        let c1j: number;
        let c2i: number;
        let c2j: number;
        if (neighbor.dy !== 0) {
          const y = neighbor.dy < 0 ? tile.y * tileSize : (tile.y + 1) * tileSize;
          x1 = tile.x * tileSize;
          y1 = y;
          c1i = tile.x;
          c1j = neighbor.dy < 0 ? tile.y : tile.y + 1;
          x2 = (tile.x + 1) * tileSize;
          y2 = y;
          c2i = tile.x + 1;
          c2j = c1j;
        } else {
          const x = neighbor.dx < 0 ? tile.x * tileSize : (tile.x + 1) * tileSize;
          x1 = x;
          y1 = tile.y * tileSize;
          c1i = neighbor.dx < 0 ? tile.x : tile.x + 1;
          c1j = tile.y;
          x2 = x;
          y2 = (tile.y + 1) * tileSize;
          c2i = c1i;
          c2j = tile.y + 1;
        }

        const length = tileSize;
        if (convexCorners.has(cornerKey(c1i, c1j))) {
          const t = inset / length;
          x1 += (x2 - x1) * t;
          y1 += (y2 - y1) * t;
        }
        if (convexCorners.has(cornerKey(c2i, c2j))) {
          const t = inset / length;
          x2 += (x1 - x2) * t;
          y2 += (y1 - y2) * t;
        }

        addWallSegment(x1, y1, x2, y2);
      }
    }

    for (const [key, dir] of convexDirs) {
      const parts = key.split(",");
      const i = Number(parts[0]);
      const j = Number(parts[1]);
      const vertexX = i * tileSize;
      const vertexY = j * tileSize;
      const axX = vertexX - dir.sx * inset;
      const axY = vertexY;
      const bxX = vertexX;
      const bxY = vertexY - dir.sy * inset;
      const centerX = (axX + bxX) / 2;
      const centerY = (axY + bxY) / 2;
      const length = Math.hypot(bxX - axX, bxY - axY);
      const angle = Math.atan2(bxY - axY, bxX - axX);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY).setRotation(angle).setUserData(corridorTag),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(length / 2, chamferHalfThickness), body);
      this.corridorBodies.push(body);
    }
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
