import { z } from "zod";
import {
  MAX_DECISION_INTERVAL_MS,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_TEMPERATURE,
  MIN_DECISION_INTERVAL_MS,
  MIN_REQUEST_TIMEOUT_MS,
  MIN_TEMPERATURE,
} from "@/commanders/llm/types.js";

const TowerUnlocksSchema = z.object({
  levels: z.array(z.boolean()),
  variantA: z.array(z.boolean()),
  variantB: z.array(z.boolean()),
  addons: z.array(z.boolean()),
});

const GeneralAddonsSchema = z
  .object({
    extraHealth: z.number().nullable(),
    startingGold: z.number().nullable(),
    sellRefundUnlocked: z.boolean(),
    sellDiscountUnlocked: z.boolean(),
    sellActive: z.string().nullable(),
    upgradeCostReduction: z.number().nullable(),
    terrainHeightBonus: z.number().nullable(),
    terrainHeightRangeBonus: z.number().nullable(),
    damageMilestoneBonus: z.number().nullable(),
    slowHealing: z.number().nullable(),
    progressiveThirdChoice: z.number().nullable(),
  })
  .passthrough();

const LlmCommanderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpointUrl: z.string(),
  token: z.string(),
  modelName: z.string(),
  contextLimit: z.number(),
  commanderInstructions: z.string(),
  systemPrompt: z.string(),
  requestTimeoutMs: z.number().int().min(MIN_REQUEST_TIMEOUT_MS).max(MAX_REQUEST_TIMEOUT_MS),
  pauseForCommander: z.boolean(),
  decisionIntervalMs: z.number().int().min(MIN_DECISION_INTERVAL_MS).max(MAX_DECISION_INTERVAL_MS),
  reasoningEnabled: z.boolean(),
  temperatureReasoningOff: z.number().min(MIN_TEMPERATURE).max(MAX_TEMPERATURE),
  temperatureReasoningOn: z.number().min(MIN_TEMPERATURE).max(MAX_TEMPERATURE),
});

export const PersistStateSchema = z.object({
  saveVersion: z.number(),
  gems: z.number(),
  highestUnlockedMap: z.number(),
  bestWaves: z.record(z.string(), z.number()),
  activeWaves: z.record(z.string(), z.number()),
  difficulty: z.object({ multiplierTick: z.number() }),
  firstTimeMilestones: z.record(z.string(), z.boolean()),
  firstClears: z.record(z.string(), z.boolean()),
  generalAddons: GeneralAddonsSchema,
  unlocked: z.record(z.string(), TowerUnlocksSchema),
  runHistory: z.array(z.unknown()),
  randomMapRegion: z.number(),
  randomMapLevel: z.number(),
  randomMapStyle: z.string(),
  randomMapSeed: z.number().nullable(),
  randomMapWidth: z.number(),
  randomMapHeight: z.number(),
  progressiveMapRegion: z.number(),
  progressiveMapLevel: z.number(),
  progressiveMapEntries: z.number(),
  progressiveMapSeed: z.number().nullable(),
  lastSelectedThemeId: z.string(),
  llmCommanders: z.array(LlmCommanderConfigSchema),
});

export type PersistStateParsed = z.infer<typeof PersistStateSchema>;
