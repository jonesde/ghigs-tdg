import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import { nearestPathTileTo } from "../navTile.js";
import type { CommanderObservation, ObservationEnemy, ObservationTower } from "../observation.js";
import { type ApiClient, type ChatMessage, createApiClient } from "./apiClient.js";
import { summarizeLlmCommands } from "./commandSummary.js";
import type { ParsedLlmCommand } from "./schema.js";
import { validateLlmResponse } from "./schema.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { LlmCommanderConfig } from "./types.js";

export interface LlmTraceEntry {
  responseText: string;
  commandSummary: string;
}

export interface LlmBrainCallbacks {
  onChat?: (text: string) => void;
  onNotify?: (message: string) => void;
  onTrace?: (entry: LlmTraceEntry) => void;
  fetchFn?: typeof fetch;
}

const ESTIMATED_NEXT_PROMPT_TOKENS = 2048;

function blockedTileKey(tile: { x: number; y: number } | null | undefined): string {
  if (!tile) return "";
  return `${tile.x},${tile.y}`;
}

function serializeEnemy(enemy: ObservationEnemy): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: enemy.id,
    x: enemy.tileX,
    y: enemy.tileY,
    level: enemy.level,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    routingMode: enemy.routingMode ?? "default",
    distanceToBase: enemy.distanceToBase ?? -1,
    flyingHeight: enemy.flyingHeight ?? 0,
  };
  if (enemy.wave !== undefined) record.wave = enemy.wave;
  if (enemy.spawnIndex !== undefined) record.spawnIndex = enemy.spawnIndex;
  if (enemy.type !== undefined) record.type = enemy.type;
  if (enemy.attackingBase !== undefined) record.attackingBase = enemy.attackingBase;
  if (enemy.blockedByTowerTile !== undefined) record.blockedByTowerTile = enemy.blockedByTowerTile;
  if (enemy.targetingMode) record.targetingMode = enemy.targetingMode;
  return record;
}

function readNavDistance(distanceToBase: number[][] | undefined, tileX: number, tileY: number): number {
  if (!distanceToBase) return -1;
  return distanceToBase[tileY]?.[tileX] ?? -1;
}

function towerDistanceToBase(tower: ObservationTower, observation: CommanderObservation): number {
  const gridLayout = observation.map;
  const navDistances = observation.nav?.distanceToBase;
  if (!gridLayout || !navDistances) return -1;
  const snap = nearestPathTileTo(tower.tileX, tower.tileY, gridLayout);
  if (!snap) return -1;
  return readNavDistance(navDistances, snap.x, snap.y);
}

function serializeTower(tower: ObservationTower, observation: CommanderObservation): Record<string, unknown> {
  const record: Record<string, unknown> = {
    x: tower.tileX,
    y: tower.tileY,
    level: tower.level,
    hp: tower.hp,
    maxHp: tower.maxHp,
    distanceToBase: towerDistanceToBase(tower, observation),
  };
  if (tower.type !== undefined) record.type = tower.type;
  return record;
}

function liveTowers(observation: CommanderObservation): ObservationTower[] {
  return observation.towers.filter((tower) => tower.hp > 0);
}

function waveSummary(observation: CommanderObservation): unknown {
  const countdownRemaining = observation.wave.countdownRemaining;
  const countdownSeconds = countdownRemaining === null ? null : Math.round(countdownRemaining * 10) / 10;
  return {
    currentWave: observation.wave.currentWave,
    pendingEnemyCount: observation.wave.pendingEnemyCount,
    remainingScheduledSpawns: observation.wave.remainingScheduledSpawns,
    active: observation.wave.active,
    baseHp: observation.wave.baseHealth,
    maxBaseHp: observation.wave.maxBaseHealth,
    countdownSeconds,
    spawnOrders: observation.wave.spawnOrders ?? [],
    commandReceipt: observation.wave.commandReceipt ?? null,
  };
}

function buildFullSnapshotMessage(observation: CommanderObservation): string {
  return JSON.stringify({
    kind: "snapshot",
    map: observation.map,
    heights: observation.heights ?? null,
    spawns: observation.spawns ?? [],
    enemies: observation.enemies.map(serializeEnemy),
    towers: liveTowers(observation).map((tower) => serializeTower(tower, observation)),
    wave: waveSummary(observation),
  });
}

function towerKey(tower: { tileX: number; tileY: number }): string {
  return `${tower.tileX},${tower.tileY}`;
}

function enemyChanged(previous: ObservationEnemy, enemy: ObservationEnemy): boolean {
  return (
    previous.tileX !== enemy.tileX ||
    previous.tileY !== enemy.tileY ||
    previous.hp !== enemy.hp ||
    previous.maxHp !== enemy.maxHp ||
    (previous.routingMode ?? "default") !== (enemy.routingMode ?? "default") ||
    previous.attackingBase !== enemy.attackingBase ||
    blockedTileKey(previous.blockedByTowerTile) !== blockedTileKey(enemy.blockedByTowerTile) ||
    (previous.targetingMode ?? "") !== (enemy.targetingMode ?? "") ||
    (previous.distanceToBase ?? -1) !== (enemy.distanceToBase ?? -1)
  );
}

function towerChanged(
  previous: ObservationTower,
  tower: ObservationTower,
  previousObservation: CommanderObservation,
  observation: CommanderObservation,
): boolean {
  return (
    previous.hp !== tower.hp ||
    previous.maxHp !== tower.maxHp ||
    previous.level !== tower.level ||
    towerDistanceToBase(previous, previousObservation) !== towerDistanceToBase(tower, observation)
  );
}

function buildDeltaMessage(observation: CommanderObservation, last: CommanderObservation): string {
  const lastEnemyById = new Map(last.enemies.map((enemy) => [enemy.id, enemy]));
  const currentEnemyIds = new Set(observation.enemies.map((enemy) => enemy.id));
  const newEnemies: unknown[] = [];
  const changedEnemies: unknown[] = [];
  for (const enemy of observation.enemies) {
    const previous = lastEnemyById.get(enemy.id);
    if (!previous) newEnemies.push(serializeEnemy(enemy));
    else if (enemyChanged(previous, enemy)) changedEnemies.push(serializeEnemy(enemy));
  }
  const removedEnemyIds: number[] = [];
  for (const previous of last.enemies) {
    if (!currentEnemyIds.has(previous.id)) removedEnemyIds.push(previous.id);
  }

  const previousLiveTowers = liveTowers(last);
  const currentLiveTowers = liveTowers(observation);
  const lastTowerByKey = new Map(previousLiveTowers.map((tower) => [towerKey(tower), tower]));
  const currentTowerKeys = new Set(currentLiveTowers.map((tower) => towerKey(tower)));
  const newTowers: unknown[] = [];
  const changedTowers: unknown[] = [];
  for (const tower of currentLiveTowers) {
    const key = towerKey(tower);
    const previous = lastTowerByKey.get(key);
    if (!previous) newTowers.push(serializeTower(tower, observation));
    else if (towerChanged(previous, tower, last, observation)) changedTowers.push(serializeTower(tower, observation));
  }
  const removedTowers: { x: number; y: number }[] = [];
  for (const previous of previousLiveTowers) {
    if (!currentTowerKeys.has(towerKey(previous))) {
      removedTowers.push({ x: previous.tileX, y: previous.tileY });
    }
  }

  return JSON.stringify({
    kind: "delta",
    heights: observation.heights ?? null,
    newEnemies,
    changedEnemies,
    removedEnemyIds,
    newTowers,
    changedTowers,
    removedTowers,
    wave: waveSummary(observation),
  });
}

function coalesceRoles(messages: ChatMessage[]): ChatMessage[] {
  const coalesced: ChatMessage[] = [];
  for (const message of messages) {
    const previous = coalesced[coalesced.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      coalesced.push({ role: message.role, content: message.content });
    }
  }
  return coalesced;
}

function estimateTokens(systemPrompt: string, messages: ChatMessage[]): number {
  let characters = systemPrompt.length;
  for (const message of messages) characters += message.content.length;
  return Math.ceil(characters / 4);
}

function stripOneFence(text: string): string {
  let body = text.trim();
  if (!body.startsWith("```")) return body;
  const newlineIndex = body.indexOf("\n");
  if (newlineIndex >= 0) body = body.slice(newlineIndex + 1);
  else body = body.replace(/^```(?:json)?\s*/i, "");
  const closingIndex = body.lastIndexOf("```");
  if (closingIndex >= 0) body = body.slice(0, closingIndex);
  return body.trim();
}

function sliceJsonValue(text: string): string | null {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  let startIndex = -1;
  let endCharacter = "";
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
    startIndex = arrayStart;
    endCharacter = "]";
  } else if (objectStart >= 0) {
    startIndex = objectStart;
    endCharacter = "}";
  }
  if (startIndex < 0) return null;
  const endIndex = text.lastIndexOf(endCharacter);
  if (endIndex <= startIndex) return null;
  return text.slice(startIndex, endIndex + 1);
}

function parseModelContent(content: string): unknown {
  const unfenced = stripOneFence(content);
  try {
    return JSON.parse(unfenced);
  } catch {
    const sliced = sliceJsonValue(unfenced);
    if (sliced === null) throw new Error("not json");
    return JSON.parse(sliced);
  }
}

function withObservationTag(summary: string, observation: CommanderObservation): string {
  return observation.observationId === undefined ? summary : `obs #${observation.observationId} ${summary}`;
}

function appendRejectionNote(memory: CommanderMemory): void {
  const note = memory.rejectionNote;
  if (!note) return;
  const lastMessage = memory.conversation[memory.conversation.length - 1];
  if (lastMessage?.role !== "user") return;
  lastMessage.content = `${lastMessage.content}\n\nPrevious reply was rejected: ${note}\nReturn only the JSON command block.`;
}

function isTileInBounds(tile: { x: number; y: number }, columnCount: number, rowCount: number): boolean {
  return (
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.x >= 0 &&
    tile.y >= 0 &&
    tile.x < columnCount &&
    tile.y < rowCount
  );
}

function filterSemanticCommands(
  parsedCommands: ParsedLlmCommand[],
  observation: CommanderObservation,
): { filteredCommands: ParsedLlmCommand[]; droppedReasons: string[] } {
  const liveEnemyIds = new Set(observation.enemies.map((enemy) => enemy.id));
  const gridLayout = observation.map;
  const rowCount = gridLayout?.length ?? 0;
  const columnCount = gridLayout?.[0]?.length ?? 0;
  const hasBounds = !!gridLayout && rowCount > 0 && columnCount > 0;
  const filteredCommands: ParsedLlmCommand[] = [];
  const droppedReasons: string[] = [];
  const filterLiveIds = (enemyIds: number[]): number[] => enemyIds.filter((id) => liveEnemyIds.has(id));
  const isTileValid = (tile: { x: number; y: number }): boolean =>
    !hasBounds || isTileInBounds(tile, columnCount, rowCount);

  for (const command of parsedCommands) {
    if (command.type === "llm:routeGroup") {
      const liveIds = filterLiveIds(command.enemyIds);
      if (liveIds.length < command.enemyIds.length) {
        const unknownIds = command.enemyIds.filter((id) => !liveEnemyIds.has(id));
        droppedReasons.push(`routeGroup dropped unknown enemyIds: ${unknownIds.join(", ")}`);
      }
      const validWaypoints = command.waypoints.filter(isTileValid);
      if (validWaypoints.length < command.waypoints.length) {
        droppedReasons.push(`routeGroup dropped out-of-bounds waypoints`);
      }
      let validHoldTile = command.holdTile;
      if (validHoldTile && !isTileValid(validHoldTile)) {
        droppedReasons.push(`routeGroup dropped out-of-bounds holdTile (${validHoldTile.x}, ${validHoldTile.y})`);
        validHoldTile = undefined;
      }
      if (liveIds.length === 0) {
        droppedReasons.push(`routeGroup dropped: no live enemyIds`);
        continue;
      }
      const filteredRouteGroup: ParsedLlmCommand = {
        type: "llm:routeGroup",
        enemyIds: liveIds,
        waypoints: validWaypoints,
      };
      if (command.hold !== undefined) filteredRouteGroup.hold = command.hold;
      if (validHoldTile) filteredRouteGroup.holdTile = validHoldTile;
      filteredCommands.push(filteredRouteGroup);
    } else if (command.type === "llm:siegeTower") {
      if (!isTileValid(command.towerTile)) {
        droppedReasons.push(
          `siegeTower dropped out-of-bounds towerTile (${command.towerTile.x}, ${command.towerTile.y})`,
        );
        continue;
      }
      const liveIds = filterLiveIds(command.enemyIds);
      if (liveIds.length < command.enemyIds.length) {
        const unknownIds = command.enemyIds.filter((id) => !liveEnemyIds.has(id));
        droppedReasons.push(`siegeTower dropped unknown enemyIds: ${unknownIds.join(", ")}`);
      }
      if (liveIds.length === 0) {
        droppedReasons.push(`siegeTower dropped: no live enemyIds`);
        continue;
      }
      filteredCommands.push({ type: "llm:siegeTower", enemyIds: liveIds, towerTile: command.towerTile });
    } else if (command.type === "llm:setTargeting") {
      const liveIds = filterLiveIds(command.enemyIds);
      if (liveIds.length < command.enemyIds.length) {
        const unknownIds = command.enemyIds.filter((id) => !liveEnemyIds.has(id));
        droppedReasons.push(`setTargeting dropped unknown enemyIds: ${unknownIds.join(", ")}`);
      }
      if (liveIds.length === 0) {
        droppedReasons.push(`setTargeting dropped: no live enemyIds`);
        continue;
      }
      filteredCommands.push({ type: "llm:setTargeting", enemyIds: liveIds, mode: command.mode });
    } else if (command.type === "llm:setSpawnOrder") {
      let validHoldTile = command.holdTile;
      if (validHoldTile && !isTileValid(validHoldTile)) {
        droppedReasons.push(`setSpawnOrder dropped out-of-bounds holdTile (${validHoldTile.x}, ${validHoldTile.y})`);
        validHoldTile = undefined;
      }
      let validWaypoints = command.waypoints;
      if (validWaypoints) {
        const filteredWaypoints = validWaypoints.filter(isTileValid);
        if (filteredWaypoints.length < validWaypoints.length) {
          droppedReasons.push(`setSpawnOrder dropped out-of-bounds waypoints`);
        }
        validWaypoints = filteredWaypoints;
      }
      let validTowerTile = command.towerTile;
      if (validTowerTile && !isTileValid(validTowerTile)) {
        droppedReasons.push(`setSpawnOrder dropped out-of-bounds towerTile (${validTowerTile.x}, ${validTowerTile.y})`);
        validTowerTile = undefined;
      }
      const hasMovement = command.hold === true || validWaypoints !== undefined || validTowerTile !== undefined;
      if (!hasMovement && command.targetingMode === undefined) {
        droppedReasons.push(`setSpawnOrder dropped: no valid movement or targetingMode`);
        continue;
      }
      const filteredSpawnOrder: ParsedLlmCommand = { type: "llm:setSpawnOrder" };
      if (command.spawnIndex !== undefined) filteredSpawnOrder.spawnIndex = command.spawnIndex;
      if (command.clear) filteredSpawnOrder.clear = true;
      if (command.hold !== undefined) filteredSpawnOrder.hold = command.hold;
      if (validHoldTile) filteredSpawnOrder.holdTile = validHoldTile;
      if (validWaypoints) filteredSpawnOrder.waypoints = validWaypoints;
      if (command.targetingMode) filteredSpawnOrder.targetingMode = command.targetingMode;
      if (validTowerTile) filteredSpawnOrder.towerTile = validTowerTile;
      filteredCommands.push(filteredSpawnOrder);
    } else {
      filteredCommands.push(command);
    }
  }
  return { filteredCommands, droppedReasons };
}

// Creates the LLM commander brain. `decide` is async (it awaits the API client)
// and returns a Promise<Command[]>. The worker owns the in-flight guard + cadence,
// so this function only concerns itself with prompt assembly, calling the API,
// and translating the validated response into engine commands.
export function createLlmBrain(config: LlmCommanderConfig, callbacks: LlmBrainCallbacks = {}): CommanderBrain {
  const apiClient: ApiClient = createApiClient(callbacks.fetchFn ?? globalThis.fetch);
  let lastNotifiedFailure: string | null = null;

  function noteFailure(message: string, notify: boolean): boolean {
    if (message === lastNotifiedFailure) return false;
    lastNotifiedFailure = message;
    if (notify) callbacks.onNotify?.(message);
    return true;
  }

  function trace(responseText: string, commandSummary: string): void {
    callbacks.onTrace?.({ responseText, commandSummary });
  }

  function translateCommand(parsed: ReturnType<typeof validateLlmResponse>["commands"][number]): Command {
    if (parsed.type === "llm:routeGroup") {
      const routeGroupCommand: Command = {
        commandId: 0,
        type: "llm:routeGroup",
        enemyIds: parsed.enemyIds,
        hold: parsed.hold ?? false,
        waypoints: parsed.waypoints,
      };
      if (parsed.holdTile) routeGroupCommand.holdTile = parsed.holdTile;
      return routeGroupCommand;
    }
    if (parsed.type === "llm:siegeTower") {
      return { commandId: 0, type: "llm:siegeTower", enemyIds: parsed.enemyIds, towerTile: parsed.towerTile };
    }
    if (parsed.type === "llm:setSpawnOrder") {
      const spawnOrder: Command = { commandId: 0, type: "llm:setSpawnOrder" };
      if (parsed.spawnIndex !== undefined) spawnOrder.spawnIndex = parsed.spawnIndex;
      if (parsed.clear) spawnOrder.clear = true;
      if (parsed.hold !== undefined) spawnOrder.hold = parsed.hold;
      if (parsed.holdTile) spawnOrder.holdTile = parsed.holdTile;
      if (parsed.waypoints) spawnOrder.waypoints = parsed.waypoints;
      if (parsed.targetingMode) spawnOrder.targetingMode = parsed.targetingMode;
      if (parsed.towerTile) spawnOrder.towerTile = parsed.towerTile;
      return spawnOrder;
    }
    if (parsed.type === "llm:releaseHeld") {
      const release: Command = { commandId: 0, type: "llm:releaseHeld" };
      if (parsed.wave !== undefined) release.wave = parsed.wave;
      if (parsed.spawnIndex !== undefined) release.spawnIndex = parsed.spawnIndex;
      return release;
    }
    return { commandId: 0, type: "llm:setTargeting", enemyIds: parsed.enemyIds, mode: parsed.mode };
  }

  return {
    awaitReady(): Promise<void> {
      return apiClient.waitForBackoff();
    },
    async decide(observation: CommanderObservation, memory: CommanderMemory): Promise<Command[]> {
      const previousConversation = memory.conversation.slice();
      const previousLastObservation = memory.lastObservation;
      const previousIsCompressing = memory.isCompressing;
      const queuedPlayerMessages = memory.pendingPlayerMessages.splice(0, memory.pendingPlayerMessages.length);
      const rebuildFull = memory.conversation.length === 0 || memory.isCompressing;

      if (rebuildFull) {
        const instructions = memory.commanderInstructions || config.commanderInstructions;
        const systemPrompt = buildSystemPrompt(config, instructions);
        memory.conversation = [{ role: "system", content: systemPrompt }];
        memory.isCompressing = false;
        memory.lastObservation = null;
        memory.conversation.push({ role: "user", content: buildFullSnapshotMessage(observation) });
      } else {
        const deltaText = buildDeltaMessage(observation, memory.lastObservation ?? observation);
        memory.conversation.push({ role: "user", content: deltaText });
      }
      appendRejectionNote(memory);

      for (const pendingMessage of queuedPlayerMessages) {
        memory.conversation.push({ role: "user", content: `Player message:\n${pendingMessage}` });
      }

      const systemPrompt = memory.conversation[0]?.content ?? buildSystemPrompt(config, memory.commanderInstructions);
      const transcript = coalesceRoles(memory.conversation.slice(1));

      function restoreTurn(): void {
        memory.conversation = previousConversation;
        memory.lastObservation = previousLastObservation;
        memory.isCompressing = previousIsCompressing;
        memory.pendingPlayerMessages.unshift(...queuedPlayerMessages);
      }

      const result = await apiClient.complete(systemPrompt, transcript, config);

      if ("empty" in result || "error" in result) {
        restoreTurn();
        const reason = "error" in result ? result.error : "empty response";
        noteFailure(`LLM request failed: ${reason}`, "error" in result);
        trace("", withObservationTag(`request failed: ${reason}`, observation));
        return [];
      }

      let parsedRaw: unknown;
      try {
        parsedRaw = parseModelContent(result.content);
      } catch {
        restoreTurn();
        const rejectionReason = "LLM response was not valid JSON";
        memory.rejectionNote = rejectionReason;
        noteFailure(rejectionReason, true);
        trace(result.content, withObservationTag(`rejected: ${rejectionReason}`, observation));
        return [];
      }

      const parsed = validateLlmResponse(parsedRaw, config);
      if (parsed.error && parsed.commands.length === 0) {
        restoreTurn();
        const rejectionReason = `LLM response rejected: ${parsed.error}`;
        memory.rejectionNote = rejectionReason;
        noteFailure(rejectionReason, true);
        trace(result.content, withObservationTag(`rejected: ${rejectionReason}`, observation));
        return [];
      }

      const semantic = filterSemanticCommands(parsed.commands, observation);
      const droppedText = semantic.droppedReasons.join("; ");
      const combinedError =
        parsed.error && droppedText ? `${parsed.error}; ${droppedText}` : (parsed.error ?? (droppedText || undefined));
      if (semantic.filteredCommands.length === 0 && parsed.commands.length > 0) {
        restoreTurn();
        const rejectionReason = `LLM response rejected: ${combinedError ?? "all commands filtered"}`;
        memory.rejectionNote = rejectionReason;
        noteFailure(rejectionReason, true);
        trace(result.content, withObservationTag(`rejected: ${rejectionReason}`, observation));
        return [];
      }

      memory.conversation.push({ role: "assistant", content: result.content });
      memory.rejectionNote = null;
      lastNotifiedFailure = null;
      if (combinedError) {
        const correctiveHint = droppedText
          ? `LLM response rejected: ${combinedError}. Use only live enemyIds and tiles within map bounds.`
          : `LLM response rejected: ${combinedError}`;
        memory.rejectionNote = correctiveHint;
        noteFailure(`LLM response rejected: ${combinedError}`, true);
      }
      const commandSummary = summarizeLlmCommands(semantic.filteredCommands, combinedError);
      trace(result.content, withObservationTag(commandSummary, observation));
      if (parsed.chat) callbacks.onChat?.(parsed.chat);

      const tokenCount = result.promptTokens > 0 ? result.promptTokens : estimateTokens(systemPrompt, transcript);
      memory.tokenCount = tokenCount;
      if (tokenCount + ESTIMATED_NEXT_PROMPT_TOKENS >= config.contextLimit) {
        memory.isCompressing = true;
        memory.lastObservation = null;
      } else {
        memory.lastObservation = observation;
      }

      return semantic.filteredCommands.map(translateCommand);
    },
  };
}
