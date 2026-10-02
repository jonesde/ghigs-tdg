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
    if (enemy.stunTimer > 0 || enemy.attackingBase) {
      enemy.body.setLinvel({ x: 0, y: 0 }, true);
      continue;
    }
    if (enemy.routingMode === "hold") {
      // Re-evaluated every tick even while parked. A tower built on the hold tile
      // substitutes the nearest enterable neighbor (mirroring the siege branch below),
      // and selling that tower resumes the original point — otherwise the park trigger
      // measures distance to a blocked tile and the held flyer idles beside it forever.
      let holdTarget = enemy.holdWorld;
      if (holdTarget) {
        const holdTileX = Math.floor((holdTarget.x - (grid.worldOriginX ?? 0)) / tileSize);
        const holdTileY = Math.floor((holdTarget.y - (grid.worldOriginY ?? 0)) / tileSize);
        if (!canTraverseTile(grid, holdTileX, holdTileY, enemy.flyingHeight, enemy.liveTowerAt)) {
          const neighbor = nearestTraversableNeighbor(
            grid,
            holdTileX,
            holdTileY,
            enemy.flyingHeight,
            enemy.liveTowerAt,
            enemy.currentTile(),
          );
          holdTarget = neighbor ? grid.tileToWorld(neighbor.x, neighbor.y) : null;
        }
      }
      const arrivedAtHold = !holdTarget || Math.hypot(enemy.x - holdTarget.x, enemy.y - holdTarget.y) <= arrivalRadius;
      if (arrivedAtHold) {
        enemy.motionLock = "park";
        enemy.body.setLinvel({ x: 0, y: 0 }, true);
        continue;
      }
      enemy.motionLock = "none";
    } else if (enemy.routingMode === "siege" && enemy.siegeTower && !enemy.siegeTower.isGhost) {
      // Siege owns its park/unpark like hold above: the tile-open and neighbor
      // checks must run even while parked, otherwise a parked flyer never
      // re-evaluates when its neighbor tile is built on. The generic park gate
      // below only covers modes without their own re-evaluation.
      const tower = enemy.siegeTower;
      const tileOpen = canTraverseTile(grid, tower.tileX, tower.tileY, enemy.flyingHeight, enemy.liveTowerAt);
      if (tileOpen && ballOverlapsTileSquare(enemy.x, enemy.y, enemy.radius, tower.x, tower.y, tileSize)) {
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
            enemy.motionLock = "park";
            enemy.body.setLinvel({ x: 0, y: 0 }, true);
            continue;
          }
        }
      }
      enemy.motionLock = "none";
    } else if (enemy.motionLock === "park") {
      // Covers only park states without their own re-evaluation (stale siege
      // whose tower ghosted before intent released it). Hold and live siege
      // own their park/unpark in the branches above.
      enemy.body.setLinvel({ x: 0, y: 0 }, true);
      continue;
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
