import type {
  NavFieldSnapshotData,
  SpawnOrderView,
  SpawnPointSnapshot,
  SpawnStateSnapshot,
} from "@/sim/SimulationSnapshot.js";
import type { CommanderSnapshotSlice } from "./protocol.js";

export interface ObservationEnemy {
  id: number;
  type?: string;
  tileX: number;
  tileY: number;
  level: number;
  hp: number;
  maxHp: number;
  routingMode?: string;
  attackingBase?: boolean;
  blockedByTowerTile?: { x: number; y: number } | null;
  distanceToBase?: number;
  targetingMode?: string | null;
  wave?: number;
  spawnIndex?: number;
}

export interface ObservationTower {
  type?: string;
  tileX: number;
  tileY: number;
  level: number;
  hp: number;
  maxHp: number;
}

export interface ObservationWave {
  currentWave: number;
  pendingEnemyCount: number;
  spawnStates: SpawnStateSnapshot[];
  remainingScheduledSpawns: number;
  active: boolean;
  baseHealth: number;
  maxBaseHealth: number;
  countdownRemaining: number | null;
  spawnOrders?: SpawnOrderView[];
  commandReceipt?: { commandId: number; applied: number; skipped: number };
}

export interface ObservationNav {
  pathVersion: number;
  distanceToBase: number[][];
  spawnReachable: boolean[];
}

// The abstracted semantic view the brain consumes. Field names are intentionally
// stable for LLM commanders.
export interface CommanderObservation {
  observationId?: number;
  map: number[][] | undefined;
  spawns?: SpawnPointSnapshot[];
  enemies: ObservationEnemy[];
  towers: ObservationTower[];
  wave: ObservationWave;
  nav?: ObservationNav;
}

function worldToTile(worldCoordinate: number, tileSize: number): number {
  return Math.floor(worldCoordinate / tileSize);
}

// Pure projection from a throttled snapshot slice into the brain's semantic view.
export function buildObservation(slice: CommanderSnapshotSlice): CommanderObservation {
  const tileSize = slice.meta.tileSize ?? 36;
  const navField: NavFieldSnapshotData | undefined = slice.nav;
  const enemies: ObservationEnemy[] = slice.enemies.map((enemy) => {
    const tileX = worldToTile(enemy.x, tileSize);
    const tileY = worldToTile(enemy.y, tileSize);
    const distanceToBase = enemy.distanceToBase ?? navField?.distanceToBase[tileY]?.[tileX] ?? -1;
    const observationEnemy: ObservationEnemy = {
      id: enemy.id,
      tileX,
      tileY,
      level: enemy.level,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      distanceToBase,
    };
    if (enemy.type !== undefined) observationEnemy.type = enemy.type;
    if (enemy.routingMode !== undefined) observationEnemy.routingMode = enemy.routingMode;
    if (enemy.attackingBase !== undefined) observationEnemy.attackingBase = enemy.attackingBase;
    if (enemy.blockedByTowerTile !== undefined) {
      observationEnemy.blockedByTowerTile = enemy.blockedByTowerTile;
    }
    if (enemy.targetingMode !== undefined) observationEnemy.targetingMode = enemy.targetingMode;
    if (enemy.wave !== undefined) observationEnemy.wave = enemy.wave;
    if (enemy.spawnIndex !== undefined) observationEnemy.spawnIndex = enemy.spawnIndex;
    return observationEnemy;
  });
  const towers: ObservationTower[] = slice.towers.map((tower) => {
    const observationTower: ObservationTower = {
      tileX: tower.tileX,
      tileY: tower.tileY,
      level: tower.level,
      hp: tower.health,
      maxHp: tower.maxHealth,
    };
    if (tower.type !== undefined) observationTower.type = tower.type;
    return observationTower;
  });
  const pendingEnemyCount = slice.spawnStates.reduce((sum, spawnState) => sum + spawnState.pendingCount, 0);
  const wave: ObservationWave = {
    currentWave: slice.meta.currentWave,
    pendingEnemyCount,
    spawnStates: slice.spawnStates,
    remainingScheduledSpawns: slice.meta.remainingScheduledSpawns ?? 0,
    active: slice.meta.waveActive ?? false,
    baseHealth: slice.meta.baseHealth,
    maxBaseHealth: slice.meta.maxBaseHealth,
    countdownRemaining: slice.meta.waveCountdown?.remaining ?? null,
    spawnOrders: slice.meta.spawnOrders ?? [],
  };
  if (
    slice.meta.lastAppliedCommandId !== undefined ||
    slice.meta.lastAppliedCount !== undefined ||
    slice.meta.lastSkippedCount !== undefined
  ) {
    wave.commandReceipt = {
      commandId: slice.meta.lastAppliedCommandId ?? 0,
      applied: slice.meta.lastAppliedCount ?? 0,
      skipped: slice.meta.lastSkippedCount ?? 0,
    };
  }
  const observation: CommanderObservation = {
    observationId: slice.observationId,
    map: slice.gridLayout,
    spawns: slice.meta.spawns ?? [],
    enemies,
    towers,
    wave,
  };
  if (navField) {
    observation.nav = {
      pathVersion: navField.pathVersion,
      distanceToBase: navField.distanceToBase,
      spawnReachable: navField.spawnReachable,
    };
  }
  return observation;
}
