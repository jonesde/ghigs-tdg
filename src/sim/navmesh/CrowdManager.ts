import { Crowd, type CrowdAgent, Detour, type NavMesh, type Vector3 } from "recast-navigation";
import { ENEMY_TYPES } from "@/sim/ConstantsEnemy.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import { toRecast } from "./coords.js";
import { getRecast } from "./recastContext.js";

const CROWD_MAX_ACCEL_FACTOR_DEFAULT = 8;
// A FAILED or still-invalid retarget waits this long. Detour admits 8 path
// requests per crowd update, so a dead target must not take a slot every tick.
const CROWD_RETARGET_COOLDOWN_SECONDS = 0.5;

export interface CrowdAgentProfile {
  maxAccelFactor: number;
  separationWeight: number;
  collisionQueryRangeFactor: number;
  // Multiplier of tileSize for Detour string-pull. 0 disables (tight corridors).
  pathOptimizationRangeFactor: number;
}

const DEFAULT_PROFILE: CrowdAgentProfile = {
  maxAccelFactor: CROWD_MAX_ACCEL_FACTOR_DEFAULT,
  separationWeight: 1,
  collisionQueryRangeFactor: 2.5,
  pathOptimizationRangeFactor: 0,
};

// Per-type crowd steering profiles (data-driven; new types add a row).
export const CROWD_AGENT_PROFILES: Record<string, CrowdAgentProfile> = {
  runner: { maxAccelFactor: 12, separationWeight: 0.4, collisionQueryRangeFactor: 1.5, pathOptimizationRangeFactor: 2 },
  tank: { maxAccelFactor: 5, separationWeight: 1.8, collisionQueryRangeFactor: 3.5, pathOptimizationRangeFactor: 0 },
  boss: { maxAccelFactor: 4, separationWeight: 2.0, collisionQueryRangeFactor: 4.0, pathOptimizationRangeFactor: 0 },
  minion: { maxAccelFactor: 8, separationWeight: 1.0, collisionQueryRangeFactor: 2.5, pathOptimizationRangeFactor: 2 },
  shielded: {
    maxAccelFactor: 7,
    separationWeight: 1.2,
    collisionQueryRangeFactor: 2.8,
    pathOptimizationRangeFactor: 0,
  },
  healer: { maxAccelFactor: 7, separationWeight: 1.1, collisionQueryRangeFactor: 2.5, pathOptimizationRangeFactor: 2 },
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
    // Init-first gate: fail fast when initNavMesh() has not resolved instead of
    // constructing DetourCrowd against unloaded WASM.
    void getRecast();
    this.tileSize = tileSize;
    this.crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius: tileSize });
    // teleport and requestMoveTarget both query with this default. The library
    // default is 1 world unit, so a body a few pixels off a voxelized corner
    // finds no polygon and the agent is marked INVALID. One tile matches
    // NavMeshBuilder.nearestWalkableWorld.
    this.crowd.navMeshQuery.defaultQueryHalfExtents = { x: tileSize, y: tileSize, z: tileSize };
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
      pathOptimizationRange: profile.pathOptimizationRangeFactor * this.tileSize,
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

  // Re-issues every enemy's cached move target to Detour. Used after a navmesh
  // obstacle sync that did not converge: the corridor may have rebuilt under the
  // agents, so stale corridors get refreshed instead of steering into new walls.
  reissueMoveTargets(enemies: readonly Enemy[]): void {
    for (const enemy of enemies) {
      if (enemy.removed || !enemy.agent || !enemy.lastMoveTargetWorld) continue;
      enemy.agent.requestMoveTarget(toRecast(enemy.lastMoveTargetWorld));
    }
  }

  // Advances the crowd one fixed step, then writes each agent's desired velocity
  // into its Rapier body (unless park/ballistic).
  update(dt: number, enemies: Enemy[]): void {
    const frozenAgents: CrowdAgent[] = [];
    for (const enemy of enemies) {
      if (enemy.removed) continue;
      if (enemy.crowdRetargetCooldown > 0) {
        enemy.crowdRetargetCooldown = Math.max(0, enemy.crowdRetargetCooldown - dt);
      }
      if (!enemy.agent) continue;
      this.recoverLostCrowdTarget(enemy);
      const agent = enemy.agent;
      if (!agent || !this.isCrowdParked(enemy)) continue;
      if (agent.state() !== Detour.DT_CROWDAGENT_STATE_WALKING) continue;
      // Off-mesh for this crowd.update only. Detour skips integrate, neighbor
      // displacement, and corridor.movePosition for every non-walking state, so
      // a stun or park does not walk the agent off the body and wipe the corridor.
      // Walking is restored immediately after the step, before the next intent.
      agent.raw.set_state(Detour.DT_CROWDAGENT_STATE_OFFMESH);
      zeroCrowdAgentVelocity(agent);
      frozenAgents.push(agent);
    }

    this.crowd.update(dt);

    for (const agent of frozenAgents) {
      if (agent.state() === Detour.DT_CROWDAGENT_STATE_INVALID) continue;
      agent.raw.set_state(Detour.DT_CROWDAGENT_STATE_WALKING);
    }

    for (const enemy of enemies) {
      if (!enemy.agent || !enemy.body) continue;
      const profile = getCrowdAgentProfile(enemy.type);
      const maxSpeed = enemy.speed * enemy.slowFactor * this.tileSize;
      if (Math.abs(enemy.agent.maxSpeed - maxSpeed) > 1e-6) {
        enemy.agent.updateParameters({ maxSpeed, maxAcceleration: maxSpeed * profile.maxAccelFactor });
      }

      // Tick ballistic window. While > 0 the body keeps its impulse/force residual;
      // the tick it expires we fall through to the steering write below so crowd
      // velocity is restored instead of leaving stale ballistic linvel behind.
      if (enemy.ballisticTimer > 0) {
        enemy.ballisticTimer = Math.max(0, enemy.ballisticTimer - dt);
        if (enemy.ballisticTimer > 0) continue;
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

  private isCrowdParked(enemy: Enemy): boolean {
    return enemy.stunTimer > 0 || enemy.attackingBase || enemy.motionLock === "park";
  }

  // A library teleport leaves the agent INVALID or TARGET_NONE, and updateMoveRequest
  // never reads a request while the agent is INVALID. Re-seat, then reissue the
  // cached move target. Cross-module: writes the Detour target and, when invalid,
  // the agent position.
  private recoverLostCrowdTarget(enemy: Enemy): void {
    const agent = enemy.agent;
    const moveTarget = enemy.lastMoveTargetWorld;
    if (!agent || !moveTarget || this.isCrowdParked(enemy)) return;
    const targetState = agent.raw.get_targetState();
    const invalid = agent.state() === Detour.DT_CROWDAGENT_STATE_INVALID;
    const targetFailed = targetState === Detour.DT_CROWDAGENT_TARGET_FAILED;
    const targetNone = targetState === Detour.DT_CROWDAGENT_TARGET_NONE;
    if (!invalid && !targetFailed && !targetNone) return;
    if ((invalid || targetFailed) && enemy.crowdRetargetCooldown > 0) return;

    if (invalid) {
      agent.teleport(toRecast({ x: enemy.x, y: enemy.y }));
      if (agent.state() === Detour.DT_CROWDAGENT_STATE_INVALID) {
        enemy.crowdRetargetCooldown = CROWD_RETARGET_COOLDOWN_SECONDS;
        return;
      }
    }

    const accepted = agent.requestMoveTarget(toRecast(moveTarget));
    if (!accepted || targetFailed) {
      enemy.crowdRetargetCooldown = CROWD_RETARGET_COOLDOWN_SECONDS;
    }
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

function zeroCrowdAgentVelocity(agent: CrowdAgent): void {
  agent.raw.set_vel(0, 0);
  agent.raw.set_vel(1, 0);
  agent.raw.set_vel(2, 0);
  agent.raw.set_nvel(0, 0);
  agent.raw.set_nvel(1, 0);
  agent.raw.set_nvel(2, 0);
  agent.raw.set_dvel(0, 0);
  agent.raw.set_dvel(1, 0);
  agent.raw.set_dvel(2, 0);
}

// Silence unused import when ENEMY_TYPES only used for documentation alignment.
void ENEMY_TYPES;
