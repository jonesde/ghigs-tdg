import { LlmCommandSchema, LlmResponseBodySchema, SET_TARGETING_MODES } from "@/content/schemas/llmResponse.js";
import type { LlmCommanderConfig } from "./types.js";

interface TileCoordinate {
  x: number;
  y: number;
}

export interface ParsedRouteGroup {
  type: "llm:routeGroup";
  enemyIds: number[];
  hold?: boolean;
  holdTile?: TileCoordinate;
  waypoints: TileCoordinate[];
}

export interface ParsedSetTargeting {
  type: "llm:setTargeting";
  enemyIds: number[];
  mode: string;
}

export interface ParsedSiegeTower {
  type: "llm:siegeTower";
  enemyIds: number[];
  towerTile: TileCoordinate;
}

export interface ParsedSetSpawnOrder {
  type: "llm:setSpawnOrder";
  spawnIndex?: number;
  clear?: boolean;
  hold?: boolean;
  holdTile?: TileCoordinate;
  waypoints?: TileCoordinate[];
  targetingMode?: string;
  towerTile?: TileCoordinate;
}

export interface ParsedReleaseHeld {
  type: "llm:releaseHeld";
  wave?: number;
  spawnIndex?: number;
}

export type ParsedLlmCommand =
  | ParsedRouteGroup
  | ParsedSetTargeting
  | ParsedSiegeTower
  | ParsedSetSpawnOrder
  | ParsedReleaseHeld;

export interface LlmResponseResult {
  commands: ParsedLlmCommand[];
  chat?: string | undefined;
  error?: string | undefined;
}

const SET_TARGETING_MODE_SET: ReadonlySet<string> = new Set(SET_TARGETING_MODES);

function rejectSpawnOrder(command: {
  clear?: boolean | undefined;
  hold?: boolean | undefined;
  holdTile?: TileCoordinate | undefined;
  waypoints?: TileCoordinate[] | undefined;
  targetingMode?: string | undefined;
  towerTile?: TileCoordinate | undefined;
}): string | null {
  const hasOrderField =
    command.hold !== undefined ||
    command.holdTile !== undefined ||
    command.waypoints !== undefined ||
    command.targetingMode !== undefined ||
    command.towerTile !== undefined;
  if (command.clear) {
    if (hasOrderField) return "setSpawnOrder clear combined with an order";
    return null;
  }
  let movements = 0;
  if (command.hold === true) movements += 1;
  if (command.waypoints !== undefined) movements += 1;
  if (command.towerTile !== undefined) movements += 1;
  if (movements > 1) return "setSpawnOrder has more than one movement intent";
  if (movements === 0 && command.targetingMode === undefined) return "setSpawnOrder is empty";
  return null;
}

function toParsedSpawnOrder(command: {
  spawnIndex?: number | undefined;
  clear?: boolean | undefined;
  hold?: boolean | undefined;
  holdTile?: TileCoordinate | undefined;
  waypoints?: TileCoordinate[] | undefined;
  targetingMode?: string | undefined;
  towerTile?: TileCoordinate | undefined;
}): ParsedSetSpawnOrder {
  const parsed: ParsedSetSpawnOrder = { type: "llm:setSpawnOrder" };
  if (command.spawnIndex !== undefined) parsed.spawnIndex = command.spawnIndex;
  if (command.clear) parsed.clear = true;
  if (command.hold !== undefined) parsed.hold = command.hold;
  if (command.holdTile) parsed.holdTile = command.holdTile;
  if (command.waypoints) parsed.waypoints = command.waypoints;
  if (command.targetingMode) parsed.targetingMode = command.targetingMode;
  if (command.towerTile) parsed.towerTile = command.towerTile;
  return parsed;
}

// Validates an LLM response into a strict command list. Accepts either a bare
// array of command objects or an object wrapping `{ commands?, chat? }`. Only
// `llm:routeGroup`, `llm:siegeTower`, `llm:setTargeting`, `llm:setSpawnOrder`,
// and `llm:releaseHeld` are permitted.
// Soft-reject: bad entries are dropped with an error string; valid siblings keep.
export function validateLlmResponse(raw: unknown, _config: LlmCommanderConfig): LlmResponseResult {
  const bodyResult = LlmResponseBodySchema.safeParse(raw);
  if (!bodyResult.success) {
    return { commands: [], error: "unrecognized response shape" };
  }

  const body = bodyResult.data;
  let commandArray: unknown[];
  let chat: string | undefined;

  if (Array.isArray(body)) {
    commandArray = body;
  } else {
    if (!Array.isArray(body.commands)) {
      return { commands: [], error: "commands field is not an array" };
    }
    commandArray = body.commands;
    if (typeof body.chat === "string" && body.chat.length > 0) chat = body.chat;
  }

  const commands: ParsedLlmCommand[] = [];
  let error: string | undefined;

  for (const entry of commandArray) {
    if (!entry || typeof entry !== "object") {
      error = error ?? "invalid command entry";
      continue;
    }

    const type = (entry as Record<string, unknown>).type;
    if (
      type !== "llm:routeGroup" &&
      type !== "llm:setTargeting" &&
      type !== "llm:siegeTower" &&
      type !== "llm:setSpawnOrder" &&
      type !== "llm:releaseHeld"
    ) {
      error = error ?? `rejected command type: ${String(type)}`;
      continue;
    }

    const parsed = LlmCommandSchema.safeParse(entry);
    if (!parsed.success) {
      if (type === "llm:siegeTower") {
        error = error ?? "siegeTower missing towerTile";
      } else if (type === "llm:setTargeting") {
        error = error ?? "setTargeting missing mode";
      } else if (type === "llm:setSpawnOrder") {
        error = error ?? "setSpawnOrder is invalid";
      } else if (type === "llm:routeGroup") {
        error = error ?? "routeGroup is invalid";
      }
      continue;
    }

    const command = parsed.data;
    if (command.type === "llm:setSpawnOrder") {
      const rejected = rejectSpawnOrder(command);
      if (rejected) {
        error = error ?? rejected;
        continue;
      }
      commands.push(toParsedSpawnOrder(command));
      continue;
    }
    if (command.type === "llm:releaseHeld") {
      const release: ParsedReleaseHeld = { type: "llm:releaseHeld" };
      if (command.wave !== undefined) release.wave = command.wave;
      if (command.spawnIndex !== undefined) release.spawnIndex = command.spawnIndex;
      commands.push(release);
      continue;
    }
    if (command.type === "llm:setTargeting" && !SET_TARGETING_MODE_SET.has(command.mode)) {
      error = error ?? `setTargeting unknown mode: ${command.mode}`;
      continue;
    }
    if (command.enemyIds.length === 0) {
      error = error ?? "empty enemyIds";
      continue;
    }

    if (command.type === "llm:routeGroup") {
      const routeGroup: ParsedRouteGroup = {
        type: "llm:routeGroup",
        enemyIds: command.enemyIds,
        waypoints: command.waypoints ?? [],
      };
      if (command.hold !== undefined) routeGroup.hold = command.hold;
      if (command.holdTile) routeGroup.holdTile = command.holdTile;
      commands.push(routeGroup);
    } else if (command.type === "llm:siegeTower") {
      commands.push({ type: "llm:siegeTower", enemyIds: command.enemyIds, towerTile: command.towerTile });
    } else {
      commands.push({ type: "llm:setTargeting", enemyIds: command.enemyIds, mode: command.mode });
    }
  }

  return { commands, chat, error };
}
