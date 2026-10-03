import type { Command } from "./Command.js";
import { TOWER_META } from "./ConstantsTower.js";

export interface CommandGridInfo {
  width: number;
  height: number;
  tileSize: number;
  worldOriginX?: number;
  worldOriginY?: number;
}

export interface CommandTile {
  x: number;
  y: number;
}

const MAX_ID_LIST_LENGTH = 256;
const MAX_WAYPOINT_COUNT = 256;
const WORLD_SANE_EXTENT = 100000;
const TILE_SANE_EXTENT = 4096;
const MAX_MODE_TEXT_LENGTH = 64;
const FALLBACK_TILE_SIZE = 36;

const TOWER_TARGETING_MODES: ReadonlySet<string> = new Set(["first", "last", "closest", "strong", "furthest"]);
const FIXED_AIM_DIRECTIONS: ReadonlySet<string> = new Set(["N", "E", "S", "W"]);
const DEBUG_TIME_SCALES: ReadonlySet<number> = new Set([1, 2, 4, 8]);

function tileReason(tile: CommandTile, grid: CommandGridInfo | null, label: string): string | null {
  const axes = ["x", "y"] as const;
  for (const axis of axes) {
    const value = tile[axis];
    if (!Number.isFinite(value) || !Number.isInteger(value)) return `${label}.${axis} must be a finite integer`;
    if (grid) {
      const extent = axis === "x" ? grid.width : grid.height;
      if (value < 0 || value >= extent) return `${label}.${axis} out of grid bounds`;
    } else if (value < -TILE_SANE_EXTENT || value > TILE_SANE_EXTENT) {
      return `${label}.${axis} outside sane range`;
    }
  }
  return null;
}

function tileListReason(
  tiles: CommandTile[],
  grid: CommandGridInfo | null,
  label: string,
  maxLength: number,
): string | null {
  if (!Array.isArray(tiles)) return `${label} must be an array`;
  if (tiles.length > maxLength) return `${label} exceeds ${maxLength} entries`;
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    if (!tile || typeof tile.x !== "number" || typeof tile.y !== "number") {
      return `${label}[${index}] must be a tile coordinate`;
    }
    const reason = tileReason(tile, grid, `${label}[${index}]`);
    if (reason) return reason;
  }
  return null;
}

function enemyIdsReason(enemyIds: number[], label: string): string | null {
  if (!Array.isArray(enemyIds)) return `${label}.enemyIds must be an array`;
  if (enemyIds.length > MAX_ID_LIST_LENGTH) return `${label}.enemyIds exceeds ${MAX_ID_LIST_LENGTH} entries`;
  for (let index = 0; index < enemyIds.length; index++) {
    const enemyId = enemyIds[index];
    if (!Number.isInteger(enemyId)) return `${label}.enemyIds[${index}] must be an integer`;
  }
  return null;
}

function clickReason(worldX: number, worldY: number, grid: CommandGridInfo | null): string | null {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return "input:click worldX/worldY must be finite";
  if (grid) {
    const tileSize = grid.tileSize > 0 ? grid.tileSize : FALLBACK_TILE_SIZE;
    const tileX = Math.floor((worldX - (grid.worldOriginX ?? 0)) / tileSize);
    const tileY = Math.floor((worldY - (grid.worldOriginY ?? 0)) / tileSize);
    if (tileX < 0 || tileY < 0 || tileX >= grid.width || tileY >= grid.height) {
      return "input:click outside grid bounds";
    }
    return null;
  }
  if (Math.abs(worldX) > WORLD_SANE_EXTENT || Math.abs(worldY) > WORLD_SANE_EXTENT) {
    return "input:click outside sane world range";
  }
  return null;
}

function towerIdReason(towerId: string | null, label: string): string | null {
  if (towerId === null) return null;
  if (typeof towerId !== "string" || towerId.length === 0) return `${label} must be a non-empty id or null`;
  return null;
}

function debugReason(kind: string, amount: number | undefined): string | null {
  switch (kind) {
    case "addGold":
    case "addGems":
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        return `action:debug ${kind} amount must be a non-negative finite number`;
      }
      return null;
    case "addBaseHealth":
    case "setDebugPhysics":
      if (amount !== undefined && !Number.isFinite(amount)) {
        return `action:debug ${kind} amount must be finite`;
      }
      return null;
    case "setWave":
      if (amount !== undefined && (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0)) {
        return "action:debug setWave amount must be a non-negative integer";
      }
      return null;
    case "setTimeScale":
      if (amount !== undefined && !DEBUG_TIME_SCALES.has(amount)) {
        return "action:debug setTimeScale amount must be one of 1, 2, 4, 8";
      }
      return null;
    case "skipWave":
    case "killAll":
      return null;
    default:
      return `action:debug unknown kind ${kind}`;
  }
}

// Central intake validator for every Command crossing into the simulation. Pure:
// no state access beyond the grid dimensions passed in, no mutation, no I/O.
// Returns a human-readable rejection reason, or null when the command is valid.
// Callers reject (no state change, no receipt advance) on a non-null result.
export function validateCommand(command: Command, grid?: CommandGridInfo | null): string | null {
  const gridInfo = grid ?? null;
  switch (command.type) {
    case "input:click":
      return clickReason(command.worldX, command.worldY, gridInfo);
    case "action:togglePause":
    case "action:upgradeSelected":
    case "action:sellSelected":
    case "action:endRun":
    case "action:downgradeSelected":
    case "action:cancelSelected":
    case "action:cancelBuildMode":
      return null;
    case "action:commanderHold":
      if (typeof command.hold !== "boolean") return "action:commanderHold hold must be a boolean";
      return null;
    case "action:cycleSpeed":
      if (command.direction !== 1 && command.direction !== -1) return "action:cycleSpeed direction must be 1 or -1";
      return null;
    case "action:executeSell": {
      if (typeof command.towerId !== "string" || command.towerId.length === 0) {
        return "action:executeSell towerId must be non-empty";
      }
      const creditAmount = command.creditAmount;
      if (creditAmount !== undefined && (!Number.isFinite(creditAmount) || creditAmount < 0)) {
        return "action:executeSell creditAmount must be a non-negative finite number";
      }
      return null;
    }
    case "action:specialize":
      if (command.variant !== "A" && command.variant !== "B") return "action:specialize variant must be A or B";
      return null;
    case "action:setTargeting":
      if (!TOWER_TARGETING_MODES.has(command.mode)) {
        return "action:setTargeting mode must be one of first, last, closest, strong, furthest";
      }
      return null;
    case "action:setFixedAimDir":
      if (command.dir !== null && !FIXED_AIM_DIRECTIONS.has(command.dir)) {
        return "action:setFixedAimDir dir must be one of N, E, S, W, or null";
      }
      return null;
    case "action:selectBuildType":
      if (command.towerType !== null && !Object.keys(TOWER_META).includes(command.towerType)) {
        return `action:selectBuildType unknown towerType ${command.towerType}`;
      }
      return null;
    case "action:syncPersist":
      if (!command.unlocked || typeof command.unlocked !== "object") return "action:syncPersist unlocked must exist";
      if (!command.generalAddons || typeof command.generalAddons !== "object") {
        return "action:syncPersist generalAddons must exist";
      }
      if (!command.baseUnlocks || typeof command.baseUnlocks !== "object") {
        return "action:syncPersist baseUnlocks must exist";
      }
      if (typeof command.gemDelta !== "number" || !Number.isFinite(command.gemDelta)) {
        return "action:syncPersist gemDelta must be a finite number";
      }
      return null;
    case "action:debug":
      return debugReason(command.kind, command.amount);
    case "action:selectTower":
      return towerIdReason(command.towerId, "action:selectTower towerId");
    case "action:debugEndRun":
      if (command.victory !== undefined && typeof command.victory !== "boolean") {
        return "action:debugEndRun victory must be a boolean";
      }
      return null;
    case "action:rerollProgressiveOffer":
      return null;
    case "action:undoProgressivePlacement":
      return null;
    case "action:placeProgressiveBlock": {
      if (!Number.isInteger(command.templateIndex) || command.templateIndex < 0 || command.templateIndex > 11) {
        return "action:placeProgressiveBlock templateIndex must be an integer 0-11";
      }
      if (!Number.isInteger(command.rotation) || command.rotation < 0 || command.rotation > 3) {
        return "action:placeProgressiveBlock rotation must be an integer 0-3";
      }
      if (!Number.isInteger(command.blockX) || Math.abs(command.blockX) > 64) {
        return "action:placeProgressiveBlock blockX must be an integer within 64";
      }
      if (!Number.isInteger(command.blockY) || Math.abs(command.blockY) > 64) {
        return "action:placeProgressiveBlock blockY must be an integer within 64";
      }
      return null;
    }
    case "lifecycle:init":
      if (!Number.isInteger(command.mapIndex) || command.mapIndex < -1) {
        return "lifecycle:init mapIndex must be an integer >= -1";
      }
      return null;
    case "lifecycle:dispose":
    case "llm:gridLayoutToggle":
      return null;
    case "llm:setGridLayoutFeed":
      if (typeof command.enabled !== "boolean") return "llm:setGridLayoutFeed enabled must be a boolean";
      return null;
    case "llm:routeGroup": {
      const idsReason = enemyIdsReason(command.enemyIds, "llm:routeGroup");
      if (idsReason) return idsReason;
      if (command.holdTile) {
        const holdReason = tileReason(command.holdTile, gridInfo, "llm:routeGroup.holdTile");
        if (holdReason) return holdReason;
      }
      return tileListReason(command.waypoints, gridInfo, "llm:routeGroup.waypoints", MAX_WAYPOINT_COUNT);
    }
    case "llm:siegeTower": {
      const idsReason = enemyIdsReason(command.enemyIds, "llm:siegeTower");
      if (idsReason) return idsReason;
      return tileReason(command.towerTile, gridInfo, "llm:siegeTower.towerTile");
    }
    case "llm:setTargeting": {
      const idsReason = enemyIdsReason(command.enemyIds, "llm:setTargeting");
      if (idsReason) return idsReason;
      if (typeof command.mode !== "string" || command.mode.length === 0 || command.mode.length > MAX_MODE_TEXT_LENGTH) {
        return "llm:setTargeting mode must be a non-empty string";
      }
      return null;
    }
    case "llm:setSpawnOrder": {
      if (command.spawnIndex !== undefined && (!Number.isInteger(command.spawnIndex) || command.spawnIndex < 0)) {
        return "llm:setSpawnOrder spawnIndex must be a non-negative integer";
      }
      if (command.holdTile) {
        const holdReason = tileReason(command.holdTile, gridInfo, "llm:setSpawnOrder.holdTile");
        if (holdReason) return holdReason;
      }
      if (command.waypoints !== undefined) {
        const waypointsReason = tileListReason(
          command.waypoints,
          gridInfo,
          "llm:setSpawnOrder.waypoints",
          MAX_WAYPOINT_COUNT,
        );
        if (waypointsReason) return waypointsReason;
      }
      if (command.towerTile) {
        const towerReason = tileReason(command.towerTile, gridInfo, "llm:setSpawnOrder.towerTile");
        if (towerReason) return towerReason;
      }
      if (command.targetingMode !== undefined && typeof command.targetingMode !== "string") {
        return "llm:setSpawnOrder targetingMode must be a string";
      }
      return null;
    }
    case "llm:releaseHeld":
      if (command.wave !== undefined && (!Number.isInteger(command.wave) || command.wave < 0)) {
        return "llm:releaseHeld wave must be a non-negative integer";
      }
      if (command.spawnIndex !== undefined && (!Number.isInteger(command.spawnIndex) || command.spawnIndex < 0)) {
        return "llm:releaseHeld spawnIndex must be a non-negative integer";
      }
      return null;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      return "unknown command type";
    }
  }
}
