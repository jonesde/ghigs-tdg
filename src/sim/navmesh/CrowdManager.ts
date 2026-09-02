import { Crowd, type CrowdAgent, type NavMesh, type Vector3 } from "recast-navigation";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import { toRecast } from "./coords.js";

const CROWD_MAX_ACCEL_FACTOR_DEFAULT = 8;

export interface CrowdAgentProfile {
  maxAccelFactor: number;
  separationWeight: number;
  collisionQueryRangeFactor: number;
}

const DEFAULT_PROFILE: CrowdAgentProfile = {
  maxAccelFactor: CROWD_MAX_ACCEL_FACTOR_DEFAULT,
  separationWeight: 1,
  collisionQueryRangeFactor: 2.5,
};

// Per-type crowd steering profiles (data-driven; new types add a row).
export const CROWD_AGENT_PROFILES: Record<string, CrowdAgentProfile> = {
  runner: { maxAccelFactor: 12, separationWeight: 0.4, collisionQueryRangeFactor: 1.5 },
  tank: { maxAccelFactor: 5, separationWeight: 1.8, collisionQueryRangeFactor: 3.5 },
  boss: { maxAccelFactor: 4, separationWeight: 2.0, collisionQueryRangeFactor: 4.0 },
  minion: { maxAccelFactor: 8, separationWeight: 1.0, collisionQueryRangeFactor: 2.5 },
  shielded: { maxAccelFactor: 7, separationWeight: 1.2, collisionQueryRangeFactor: 2.8 },
  healer: { maxAccelFactor: 7, separationWeight: 1.1, collisionQueryRangeFactor: 2.5 },
};

export function getCrowdAgentProfile(enemyType: string): CrowdAgentProfile {
  return CROWD_AGENT_PROFILES[enemyType] ?? DEFAULT_PROFILE;
}

// Wraps one DetourCrowd. Writes desired velocity into Rapier bodies unless the
// enemy is parked or ballistic (impulse/force window).
export class CrowdManager {
  private crowd: Crowd;
  private tileSize: number;
  private forceFieldSystem: ForceFieldSystem | null = null;

  constructor(navMesh: NavMesh, tileSize: number, maxAgents: number) {
    this.tileSize = tileSize;
    this.crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius: tileSize });
  }

  setForceFieldSystem(forceFieldSystem: ForceFieldSystem | null): void {
    this.forceFieldSystem = forceFieldSystem;
  }

  addAgent(enemy: Enemy): void {
    const profile = getCrowdAgentProfile(enemy.type);
    const maxSpeed = enemy.speed * this.tileSize;
    const agent = this.crowd.addAgent(toRecast({ x: enemy.x, y: enemy.y }), {
      radius: enemy.radius,
      maxSpeed,
      maxAcceleration: maxSpeed * profile.maxAccelFactor,
      separationWeight: profile.separationWeight,
      collisionQueryRange: enemy.radius * profile.collisionQueryRangeFactor + this.tileSize * 0.5,
    });
    enemy.agent = agent;
  }

  removeAgent(enemy: Enemy): void {
    if (enemy.agent) {
      this.crowd.removeAgent(enemy.agent);
      enemy.agent = null;
    }
  }

  setBaseTarget(enemy: Enemy, baseWorld: { x: number; y: number }): void {
    enemy.agent?.requestMoveTarget(toRecast(baseWorld));
  }

  requestMoveTarget(enemy: Enemy, world: { x: number; y: number }): void {
    enemy.agent?.requestMoveTarget(toRecast(world));
  }

  setMaxSpeed(enemy: Enemy, speedWorldPerSec: number): void {
    enemy.agent?.updateParameters({ maxSpeed: speedWorldPerSec });
  }

  teleportAgent(enemy: Enemy, world: { x: number; y: number }): void {
    enemy.agent?.teleport(toRecast(world));
  }

  // Advances the crowd one fixed step, then writes each agent's desired velocity
  // into its Rapier body (unless park/ballistic).
  update(dt: number, enemies: Enemy[]): void {
    this.crowd.update(dt);
    for (const enemy of enemies) {
      if (!enemy.agent || !enemy.body) continue;
      const profile = getCrowdAgentProfile(enemy.type);
      const maxSpeed = enemy.speed * enemy.slowFactor * this.tileSize;
      if (Math.abs(enemy.agent.maxSpeed - maxSpeed) > 1e-6) {
        enemy.agent.updateParameters({ maxSpeed, maxAcceleration: maxSpeed * profile.maxAccelFactor });
      }

      // Tick ballistic window.
      if (enemy.ballisticTimer > 0) {
        enemy.ballisticTimer = Math.max(0, enemy.ballisticTimer - dt);
        // Leave body linvel alone so impulse/force residual continues.
        continue;
      }

      if (enemy.stunTimer > 0 || enemy.attackingBase || enemy.motionLock === "park") {
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }

      if (enemy.routingMode === "hold") {
        const holdTarget = enemy.holdWorld;
        const holdArrivalRadius = this.tileSize * 0.35;
        const arrivedAtHold =
          !holdTarget || Math.hypot(enemy.x - holdTarget.x, enemy.y - holdTarget.y) <= holdArrivalRadius;
        if (arrivedAtHold) {
          enemy.arrived = true;
          enemy.motionLock = "park";
          enemy.body.setLinvel({ x: 0, y: 0 }, true);
          continue;
        }
        enemy.arrived = false;
        enemy.motionLock = "none";
      }

      // Siege contact park is set by ContactProcessor / Enemy.postPhysics.
      // Read motionLock into a local so control-flow narrowing from the hold
      // branch above does not collapse the comparison.
      const motionLock = enemy.motionLock as Enemy["motionLock"];
      const siegeParked =
        enemy.routingMode === "siege" &&
        enemy.blockedByTower !== null &&
        !enemy.blockedByTower.isGhost &&
        motionLock === "park";
      if (siegeParked) {
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }

      const velocity = enemy.agent.velocity();
      let velocityX = velocity.x;
      let velocityY = velocity.z;
      if (this.forceFieldSystem) {
        const bias = this.forceFieldSystem.sampleVelocityBias(enemy);
        velocityX += bias.x;
        velocityY += bias.y;
      }
      enemy.body.setLinvel({ x: velocityX, y: velocityY }, true);
    }
  }

  destroy(): void {
    this.crowd.destroy();
  }
}

// Detour's JS wrapper has no setVelocity; after teleport the agent vel is zeroed.
// This writes the raw dtCrowdAgent vel so steering resumes in the same direction.
// Cross-module: callers in Enemy.postPhysics after a Rapier wall shove.
export function restoreCrowdAgentVelocity(agent: CrowdAgent, velocity: Vector3): void {
  agent.raw.set_vel(0, velocity.x);
  agent.raw.set_vel(1, velocity.y);
  agent.raw.set_vel(2, velocity.z);
}

// Silence unused import when ENEMY_TYPES only used for documentation alignment.
void ENEMY_TYPES;
