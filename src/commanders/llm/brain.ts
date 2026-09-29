import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import type { CommanderObservation, ObservationEnemy, ObservationTower } from "../observation.js";
import { type ApiClient, type ChatMessage, createApiClient } from "./apiClient.js";
import { validateLlmResponse } from "./schema.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { LlmCommanderConfig } from "./types.js";

export interface LlmBrainCallbacks {
  onChat?: (text: string) => void;
  onNotify?: (message: string) => void;
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
  };
  if (enemy.type !== undefined) record.type = enemy.type;
  if (enemy.attackingBase !== undefined) record.attackingBase = enemy.attackingBase;
  if (enemy.blockedByTowerTile !== undefined) record.blockedByTowerTile = enemy.blockedByTowerTile;
  if (enemy.targetingMode) record.targetingMode = enemy.targetingMode;
  return record;
}

function serializeTower(tower: ObservationTower): Record<string, unknown> {
  const record: Record<string, unknown> = {
    x: tower.tileX,
    y: tower.tileY,
    level: tower.level,
    hp: tower.hp,
    maxHp: tower.maxHp,
  };
  if (tower.type !== undefined) record.type = tower.type;
  return record;
}

function waveSummary(observation: CommanderObservation): unknown {
  return {
    currentWave: observation.wave.currentWave,
    pendingEnemyCount: observation.wave.pendingEnemyCount,
    remainingScheduledSpawns: observation.wave.remainingScheduledSpawns,
    active: observation.wave.active,
  };
}

function buildFullSnapshotMessage(observation: CommanderObservation): string {
  return JSON.stringify({
    kind: "snapshot",
    map: observation.map,
    enemies: observation.enemies.map(serializeEnemy),
    towers: observation.towers.map(serializeTower),
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
    (previous.targetingMode ?? "") !== (enemy.targetingMode ?? "")
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

  const lastTowerByKey = new Map(last.towers.map((tower) => [towerKey(tower), tower]));
  const currentTowerKeys = new Set(observation.towers.map((tower) => towerKey(tower)));
  const newTowers: unknown[] = [];
  const changedTowers: unknown[] = [];
  for (const tower of observation.towers) {
    const key = towerKey(tower);
    const previous = lastTowerByKey.get(key);
    if (!previous) newTowers.push(serializeTower(tower));
    else if (previous.hp !== tower.hp || previous.maxHp !== tower.maxHp || previous.level !== tower.level) {
      changedTowers.push(serializeTower(tower));
    }
  }
  const removedTowers: { x: number; y: number }[] = [];
  for (const previous of last.towers) {
    if (!currentTowerKeys.has(towerKey(previous))) {
      removedTowers.push({ x: previous.tileX, y: previous.tileY });
    }
  }

  return JSON.stringify({
    kind: "delta",
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

// Creates the LLM commander brain. `decide` is async (it awaits the API client)
// and returns a Promise<Command[]>. The worker owns the in-flight guard + cadence,
// so this function only concerns itself with prompt assembly, calling the API,
// and translating the validated response into engine commands.
export function createLlmBrain(config: LlmCommanderConfig, callbacks: LlmBrainCallbacks = {}): CommanderBrain {
  const apiClient: ApiClient = createApiClient(callbacks.fetchFn ?? globalThis.fetch);

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
        if ("error" in result) callbacks.onNotify?.(`LLM request failed: ${result.error}`);
        return [];
      }

      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(result.content);
      } catch {
        restoreTurn();
        callbacks.onNotify?.("LLM response was not valid JSON");
        return [];
      }

      const parsed = validateLlmResponse(parsedRaw, config);
      if (parsed.error && parsed.commands.length === 0) {
        restoreTurn();
        callbacks.onNotify?.(`LLM response rejected: ${parsed.error}`);
        return [];
      }

      memory.conversation.push({ role: "assistant", content: result.content });
      if (parsed.error) callbacks.onNotify?.(`LLM response rejected: ${parsed.error}`);
      if (parsed.chat) callbacks.onChat?.(parsed.chat);

      const tokenCount = result.promptTokens > 0 ? result.promptTokens : estimateTokens(systemPrompt, transcript);
      memory.tokenCount = tokenCount;
      if (tokenCount + ESTIMATED_NEXT_PROMPT_TOKENS >= config.contextLimit) {
        memory.isCompressing = true;
        memory.lastObservation = null;
      } else {
        memory.lastObservation = observation;
      }

      return parsed.commands.map(translateCommand);
    },
  };
}
