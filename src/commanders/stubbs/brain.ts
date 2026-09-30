import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import { nearestPathTileTo } from "../navTile.js";
import type { CommanderObservation, ObservationEnemy, ObservationTower } from "../observation.js";

function representativeEnemyTile(enemies: ObservationEnemy[], gridLayout: number[][]): { x: number; y: number } | null {
  if (enemies.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  for (const enemy of enemies) {
    sumX += enemy.tileX;
    sumY += enemy.tileY;
  }
  const meanX = Math.floor(sumX / enemies.length);
  const meanY = Math.floor(sumY / enemies.length);
  return nearestPathTileTo(meanX, meanY, gridLayout);
}

function computeTowerSignature(liveTowers: ObservationTower[]): string {
  return liveTowers
    .map((tower) => `${tower.tileX},${tower.tileY}:${tower.level}`)
    .sort()
    .join("|");
}

// Distance from nav field (tower-aware). Falls back to -1 when nav missing.
function distanceAt(distanceToBase: number[][] | undefined, tileX: number, tileY: number): number {
  if (!distanceToBase) return -1;
  return distanceToBase[tileY]?.[tileX] ?? -1;
}

// Commander Stubbs — aggressive, never holds. Routes newly-seen enemies at the
// highest-hp live tower *ahead* (closer to base on the live nav field) and
// re-routes when the tower set changes. Uses observation.nav as source of truth.
export function createStubbsBrain(): CommanderBrain {
  return {
    decide(observation: CommanderObservation, memory: CommanderMemory): Command[] {
      const commands: Command[] = [];
      const currentWave = observation.wave.currentWave;

      let seenIds = memory.seenByWave.get(currentWave);
      if (!seenIds) {
        seenIds = new Set<number>();
        memory.seenByWave.set(currentWave, seenIds);
      }

      const aliveIds = new Set<number>(observation.enemies.map((enemy) => enemy.id));
      // Drop ids that died since the last tick so the wave set only names live
      // enemies; otherwise a re-route would address corpses and the set grows stale.
      for (const seenId of seenIds) {
        if (!aliveIds.has(seenId)) seenIds.delete(seenId);
      }
      const newlySeenIds: number[] = [];
      for (const enemy of observation.enemies) {
        if (seenIds.has(enemy.id)) continue;
        seenIds.add(enemy.id);
        newlySeenIds.push(enemy.id);
      }

      const gridLayout = observation.map;
      const navDistances = observation.nav?.distanceToBase;
      if (!gridLayout || !navDistances) {
        // Silent by design: nav is simply not cached yet on the earliest ticks, and
        // the brain has no notify channel back to main (decide returns Command[]).
        return commands;
      }

      const liveTowers = observation.towers.filter((tower) => tower.hp > 0);
      const towerSignature = computeTowerSignature(liveTowers);

      const enemyTile =
        representativeEnemyTile(observation.enemies, gridLayout) ??
        (observation.enemies.length > 0
          ? { x: observation.enemies[0]!.tileX, y: observation.enemies[0]!.tileY }
          : null);
      const enemyDistance = enemyTile ? distanceAt(navDistances, enemyTile.x, enemyTile.y) : -1;

      let targetTower: ObservationTower | null = null;
      for (const tower of liveTowers) {
        // Path-adjacent snap for towers on terrain; distance read at nearest path tile.
        const snap = nearestPathTileTo(tower.tileX, tower.tileY, gridLayout);
        const towerDistance = snap
          ? distanceAt(navDistances, snap.x, snap.y)
          : distanceAt(navDistances, tower.tileX, tower.tileY);
        if (towerDistance < 0) continue;
        if (enemyDistance >= 0 && !(towerDistance < enemyDistance)) continue;
        if (!targetTower || tower.hp > targetTower.hp) {
          targetTower = tower;
        }
      }

      if (targetTower) {
        const signatureChanged = towerSignature !== memory.lastRoutedTowerSignature;
        const shouldEmit = newlySeenIds.length > 0 || signatureChanged;
        if (shouldEmit) {
          const routableIds = signatureChanged ? Array.from(seenIds).filter((id) => aliveIds.has(id)) : newlySeenIds;
          if (routableIds.length > 0) {
            // Prefer explicit siege so engine parks on contact and attacks.
            commands.push({
              commandId: 0,
              type: "llm:siegeTower",
              enemyIds: routableIds,
              towerTile: { x: targetTower.tileX, y: targetTower.tileY },
            });
          }
        }
      }

      memory.lastRoutedTowerSignature = towerSignature;
      return commands;
    },
  };
}
