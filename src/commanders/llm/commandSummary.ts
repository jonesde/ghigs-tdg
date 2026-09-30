import type { ParsedLlmCommand } from "./schema.js";

function enemyList(enemyIds: number[]): string {
  return enemyIds.join(", ");
}

function tileText(coordinate: { x: number; y: number }): string {
  return `(${coordinate.x}, ${coordinate.y})`;
}

function summarizeSpawnOrder(command: Extract<ParsedLlmCommand, { type: "llm:setSpawnOrder" }>): string {
  const slot = command.spawnIndex === undefined ? "" : ` spawn ${command.spawnIndex}`;
  if (command.clear) {
    if (command.spawnIndex === undefined) return "clear spawn order";
    return `clear spawn order ${command.spawnIndex}`;
  }
  let action = "spawn order";
  if (command.hold) {
    if (command.holdTile) action = `spawn order hold${slot} at ${tileText(command.holdTile)}`;
    else if (command.spawnIndex !== undefined) action = `spawn order hold at spawn ${command.spawnIndex}`;
    else action = "spawn order hold at own spawn";
  } else if (command.towerTile) {
    action = `spawn order siege ${tileText(command.towerTile)}`;
    if (slot) action = `${action}${slot}`;
  } else if (command.waypoints) {
    if (command.waypoints.length === 0) action = `spawn order route${slot}`;
    else {
      const path = command.waypoints.map((waypoint) => tileText(waypoint)).join(" → ");
      action = `spawn order route${slot} via ${path}`;
    }
  } else if (slot) {
    action = `spawn order${slot}`;
  }
  if (command.targetingMode) return `${action} targeting ${command.targetingMode}`;
  return action;
}

function summarizeRelease(command: Extract<ParsedLlmCommand, { type: "llm:releaseHeld" }>): string {
  if (command.wave === undefined && command.spawnIndex === undefined) return "release held";
  const parts = ["release held"];
  if (command.wave !== undefined) parts.push(`wave ${command.wave}`);
  if (command.spawnIndex !== undefined) parts.push(`spawn ${command.spawnIndex}`);
  return parts.join(" ");
}

function summarizeCommand(command: ParsedLlmCommand): string {
  if (command.type === "llm:setSpawnOrder") return summarizeSpawnOrder(command);
  if (command.type === "llm:releaseHeld") return summarizeRelease(command);
  const enemies = enemyList(command.enemyIds);
  if (command.type === "llm:routeGroup") {
    if (command.hold) {
      if (command.holdTile) return `hold ${enemies} at ${tileText(command.holdTile)}`;
      return `hold ${enemies}`;
    }
    if (command.waypoints.length === 0) return `route ${enemies}`;
    const path = command.waypoints.map((waypoint) => tileText(waypoint)).join(" → ");
    return `route ${enemies} via ${path}`;
  }
  if (command.type === "llm:siegeTower") {
    return `siege ${tileText(command.towerTile)} with ${enemies}`;
  }
  return `targeting ${command.mode} on ${enemies}`;
}

export function summarizeLlmCommands(commands: ParsedLlmCommand[], rejection?: string): string {
  const lines = commands.map((command) => summarizeCommand(command));
  if (rejection) lines.push(`rejected: ${rejection}`);
  if (lines.length === 0) return "no commands";
  return lines.join("\n");
}
