import type { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import type { Enemy } from "./Enemy.js";
import type { FlightGrid } from "./flightGrid.js";
import { ballOverlapsTileSquare, canTraverseTile, nearestTraversableNeighbor } from "./flightGrid.js";

const HOLD_ARRIVAL_FRACTION = 0.35;

// Writes Rapier linvel for flyingHeight > 0. CrowdManager skips them because they
// have no agent. Ballistic knockback is left on the body for the same window the
// crowd gives ground enemies. Cross-module: parks hold and siege without going
// through ContactProcessor, which does not assign blockedByTower for flyers.
export function writeFlightVelocities(
  enemies: readonly Enemy[],
  grid: FlightGrid,
  deltaSeconds: number,
  forceFieldSystem: ForceFieldSystem | null,
): void {
  const tileSize = grid.tileSize;
  const arrivalRadius = tileSize * HOLD_ARRIVAL_FRACTION;
  for (const enemy of enemies) {
    if (enemy.removed || enemy.flyingHeight <= 0 || !enemy.body) continue;
    if (enemy.ballisticTimer > 0) {
      enemy.ballisticTimer = Math.max(0, enemy.ballisticTimer - deltaSeconds);
      if (enemy.ballisticTimer > 0) continue;
    }
    if (enemy.stunTimer > 0 || enemy.attackingBase || enemy.motionLock === "park") {
      enemy.body.setLinvel({ x: 0, y: 0 }, true);
      continue;
    }
    if (enemy.routingMode === "hold") {
      const holdTarget = enemy.holdWorld;
      const arrivedAtHold = !holdTarget || Math.hypot(enemy.x - holdTarget.x, enemy.y - holdTarget.y) <= arrivalRadius;
      if (arrivedAtHold) {
        enemy.arrived = true;
        enemy.motionLock = "park";
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }
      enemy.arrived = false;
      enemy.motionLock = "none";
    }
    if (enemy.routingMode === "siege" && enemy.siegeTower && !enemy.siegeTower.isGhost) {
      const tower = enemy.siegeTower;
      const tileOpen = canTraverseTile(grid, tower.tileX, tower.tileY, enemy.flyingHeight, enemy.liveTowerAt);
      if (tileOpen && ballOverlapsTileSquare(enemy.x, enemy.y, enemy.radius, tower.x, tower.y, tileSize)) {
        enemy.arrived = true;
        enemy.motionLock = "park";
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }
      if (!tileOpen) {
        const neighbor = nearestTraversableNeighbor(
          grid,
          tower.tileX,
          tower.tileY,
          enemy.flyingHeight,
          enemy.liveTowerAt,
          enemy.currentTile(),
        );
        if (neighbor) {
          const neighborWorld = grid.tileToWorld(neighbor.x, neighbor.y);
          if (Math.hypot(enemy.x - neighborWorld.x, enemy.y - neighborWorld.y) <= arrivalRadius) {
            enemy.arrived = true;
            enemy.motionLock = "park";
            enemy.body.setLinvel({ x: 0, y: 0 }, true);
            continue;
          }
        }
      }
      enemy.motionLock = "none";
    }

    const target = enemy.flightPoints[enemy.flightCursor];
    if (!target) {
      enemy.body.setLinvel({ x: 0, y: 0 }, true);
      continue;
    }
    const deltaX = target.x - enemy.x;
    const deltaY = target.y - enemy.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 1e-4) {
      enemy.body.setLinvel({ x: 0, y: 0 }, true);
      continue;
    }
    const speed = enemy.speed * enemy.slowFactor * tileSize;
    let velocityX = (deltaX / distance) * speed;
    let velocityY = (deltaY / distance) * speed;
    if (forceFieldSystem) {
      const bias = forceFieldSystem.sampleVelocityBias(enemy);
      velocityX += bias.x;
      velocityY += bias.y;
    }
    enemy.body.setLinvel({ x: velocityX, y: velocityY }, true);
  }
}
