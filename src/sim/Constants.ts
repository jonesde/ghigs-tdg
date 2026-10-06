import { getGameContent } from "@/content/gameContent.js";
import type { MapLevelConfigData, MapStyleData, MapsContent } from "@/content/schemas/maps.js";

// ===== Feature Flags / Engine Wiring (not content) =====

export const ENABLE_SPRITE_INTERPOLATION = false;

export const GameState = {
  MENU: "menu",
  MAP_SELECT: "map_select",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "game_over",
  VICTORY: "victory",
  SKILL_TREE: "skill_tree",
} as const;

export type GameStateValue = (typeof GameState)[keyof typeof GameState];

export const Regions = [{ id: 0 }, { id: 1 }, { id: 2 }] as const;

export type Region = (typeof Regions)[number];
export type RegionId = 0 | 1 | 2;

const economy = getGameContent().economy;
const maps = getGameContent().maps;

export const StartingGold = economy.startingGoldByRegion;

// Default (no-theme) maps catalog. Theme worlds override this per run via
// MapThemeData.maps; the engine and map generators take it as a parameter and
// fall back to this facade default when a theme carries no override.
export const MAPS_CONTENT = maps;

export {
  BOSS_CADENCE,
  BOSS_STUN_REDUCTION,
  ENEMY_LEVEL_DAMAGE_MULT,
  ENEMY_LEVEL_HP_MULT,
  ENEMY_TIER_THRESHOLDS,
  ENEMY_TYPES,
  ENEMY_WAVE_DAMAGE_MULT,
  ENEMY_WAVE_HP_MULT,
  type EnemyMeta,
  type EnemyTierThreshold,
  type EnemyType,
  HEALER_MIN_GAP,
  LATE_WAVE_DAMAGE_GROWTH,
  LATE_WAVE_HP_GROWTH,
  LATE_WAVE_START_WAVE,
  MIN_SLOW_FACTOR,
  STUN_CAP_PER_SECOND,
  STUN_WINDOW_SECONDS,
  tierThresholdForWave,
  WAVE_COUNT_BASE,
  WAVE_COUNT_SCALE,
} from "./ConstantsEnemy.js";

export {
  ANTI_HEAL_DURATION,
  BOUNCE_DAMAGE_FALLOFF,
  BURN_CIRCUIT_DMG_MULT,
  BURN_CIRCUIT_DURATION,
  CANCEL_BUILD_WINDOW_MS,
  CHAIN_DAMAGE_FALLOFF,
  CHAIN_RANGE,
  CHARGE_SHOT_COUNT,
  CHARGE_SHOT_MULT,
  CRIT_CHANCE,
  DOUBLE_DISCHARGE_CHANCE,
  GOLD_PER_CRIT,
  ICE_AURA_DURATION,
  ICE_AURA_RANGE,
  ICE_AURA_SLOW_MULT,
  ICE_BURST_INTERVAL,
  ICE_BURST_RANGE,
  ICE_BURST_STUN_DURATION,
  KNOCKBACK_HP_DIVISOR,
  MARK_TARGET_DMG_PCT,
  MARK_TARGET_DURATION,
  MULTI_PIERCE_COUNT,
  NAPALM_BURN_DPS_RATIO,
  NAPALM_BURN_DURATION,
  SELL_VALUE_RATIO,
  SPLASH_DAMAGE_RATIO,
  STATIC_FIELD_RANGE,
  STATIC_FIELD_SLOW_AMT,
  STATIC_FIELD_SLOW_DUR,
  STUN_SHELL_DURATION,
  TOWER_ADDON_EFFECTS,
  TOWER_BASE,
  TOWER_LEVEL_DMG_MULT,
  TOWER_LEVEL_HEALTH_MULT,
  TOWER_LEVEL_RANGE_MULT,
  TOWER_LEVEL_RATE_MULT,
  TOWER_LEVEL_SPLASH_MULT,
  TOWER_META,
  TOWER_VARIANTS,
  type TowerAddonEffect,
  type TowerBase,
  type TowerId,
  TowerIds,
  type TowerMeta,
  type TowerVariantConfig,
  TRUE_SHOT_CHANCE,
  UPGRADE_COST_BASE,
} from "./ConstantsTower.js";

// ===== Engine loop (not content) =====

export const FIXED_DT = 1 / 60;
// Gameplay live-enemy cap, owned by the sim. Deliberately NOT the render
// ENEMY_POOL_SIZE from render/svg/types.js: the render pool sizes a DOM pool
// and must never throttle gameplay (coupling them let immortal base-attackers
// pin an unbounded pending queue while the sim thought it was "full").
export const GAMEPLAY_ENEMY_CAP = 100;
// Per-spawn pending-queue bound. Overflow spills to the least-pending spawn
// first and only then evicts (see EnemyManager.enqueueOrSpawn), so memory stays
// bounded no matter how far PRE_EMPTIVE_WAVE_TIMER piles waves up.
export const MAX_PENDING_PER_SPAWN = 200;
// Numerical slack on the projectile glyph when testing a hit. Not an enemy radius.
export const PROJECTILE_HIT_SLOP = 1;
export const MAX_PROJECTILE_AGE = 12;
// Half-width floor for path retarget cast, as a fraction of tile size ("roughly on path").
export const PROJECTILE_RETARGET_CORRIDOR_TILE_FRACTION = 0.35;
export const MAX_ACCUM = 0.1;
export const MAX_STEPS_PER_FRAME = 12;
// The only time scales the game will accept, in cycle order. The engine cycles
// through it, validateCommand whitelists it for the debug setTimeScale command,
// and the UI reads it to render the speed control, so it lives in one place.
export const TIME_SCALES = [1, 2, 4, 8] as const;
// Ceiling the engine enforces on itself when a boss enters the world. A member of
// TIME_SCALES, so the debug whitelist and cycleTimeScale still recognize the value.
export const BOSS_SPEED_LIMIT = 2;

// ===== Game flow / economy (from content) =====

export const VICTORY_WAVE = economy.victoryWave;
export const MILESTONE_WAVES = economy.milestoneWaves;
export const MILESTONE_GEMS: Record<number, number> = {
  15: economy.milestoneGems["15"] ?? 1,
  30: economy.milestoneGems["30"] ?? 2,
  50: economy.milestoneGems["50"] ?? 4,
};
export const BONUS_GEM_BASE = economy.bonusGemBase;
export const BOUNTY_BLOCKED_RATIO = economy.bountyBlockedRatio;
export const BETWEEN_WAVES_TIMER = economy.betweenWavesTimer;
export const PRE_EMPTIVE_WAVE_TIMER = economy.preEmptiveWaveTimer;

export const DIFFICULTY_MULT_MIN = economy.difficultyMultMin;
export const DIFFICULTY_MULT_MAX = economy.difficultyMultMax;
export const DIFFICULTY_MULT_TICK = economy.difficultyMultTick;
export const DIFFICULTY_MULT_GEM_BASE = economy.difficultyMultGemBase;

export const MAP_GEM_MULTIPLIERS = economy.mapGemMultipliers;
export const FIRST_TIME_MILESTONE_MULT = economy.firstTimeMilestoneMult;
export const FIRST_FULL_CLEAR_MULT = economy.firstFullClearMult;

// ===== Map generation (from content) =====

export const MAP_BASE_SIZE = maps.mapBaseSize;
export const MAP_SIZE_SCALE = maps.mapSizeScale;
export const MAX_MAP_DIM = maps.maxMapDim;
export const HEIGHT_NOISE_FREQ = maps.heightNoiseFreq;
export const HEIGHT_NOISE_DIVISOR = maps.heightNoiseDivisor;
export const SERPENTINE_STEP = maps.serpentineStep;
export const SERPENTINE_DOWN_CAP = maps.serpentineDownCap;
export const MAPS_PER_REGION = maps.mapsPerRegion;

export type MapStyle = MapStyleData;
export type MapLevelConfig = MapLevelConfigData;

export const MAP_LEVELS: MapLevelConfig[] = maps.levels as MapLevelConfig[];
export const TOTAL_MAPS = MAP_LEVELS.length;
export const PROGRESSIVE_BLOCK_SIZE = maps.progressive.blockSize;
export const PROGRESSIVE_PLACEMENT_INTERVAL = maps.progressive.placementInterval;
export const PROGRESSIVE_REROLL_GOLD_PER_WAVE = maps.progressive.rerollGoldPerWave;
// The active world's re-roll price, falling back to the content-pack default when
// the theme carries no maps override. The worker resolves this from its
// ThemeBundle and the main thread from mapThemeStore.activeTheme, so both must
// land on the same number or the button's cost disagrees with the charge.
export function progressiveRerollGoldPerWave(worldMaps?: MapsContent | null): number {
  return worldMaps?.progressive.rerollGoldPerWave ?? PROGRESSIVE_REROLL_GOLD_PER_WAVE;
}
export const PROGRESSIVE_VARIANTS = maps.progressive.variants;
export const PROGRESSIVE_MAP_INDEX_BASE = TOTAL_MAPS;
export const PROGRESSIVE_MAP_COUNT = PROGRESSIVE_VARIANTS.length;
// Custom generated maps (mapIndex -1 + randomMapParams) and custom progressive
// maps (mapIndex -2 + progressiveMapParams) sit outside the catalog indexes, so
// map-progress persistence (best waves, unlocks, first clears) never keys on them.
export const CUSTOM_RANDOM_MAP_INDEX = -1;
export const CUSTOM_PROGRESSIVE_MAP_INDEX = -2;

// ===== General add-ons (from content) =====

export const GENERAL_ADDON_GEM_COSTS = economy.generalAddonGemCosts;
export type GeneralAddonId = keyof typeof GENERAL_ADDON_GEM_COSTS;

export const SLOW_HEALING_PER_ROUND = economy.slowHealingPerRound;
export const SELL_OPTION_GEM_COST = economy.sellOptionGemCost;
export const SELL_DISCOUNT_PCT = economy.sellDiscountPct;
export const TERRAIN_HEIGHT_BONUS_PCT = economy.terrainHeightBonusPct;
export const TERRAIN_HEIGHT_RANGE_BONUS = economy.terrainHeightRangeBonus;
export const UPGRADE_COST_REDUCTION_PCT = economy.upgradeCostReductionPct;
export const STARTING_GOLD_BONUS = economy.startingGoldBonus;
export const STARTING_HEALTH_BONUS = economy.startingHealthBonus;
export const STARTING_BASE_HEALTH = economy.startingBaseHealth;
export const BASE_GOLD_COST = economy.baseGoldCost;
export const BASE_LEVEL_HEALTH_MULT = economy.baseLevelHealthMult;
export const MILESTONE_BONUS_PCT = economy.milestoneBonusPct;
export const MILESTONE_THRESHOLD = economy.milestoneThreshold;

// ===== Wave Graph (not content) =====

export const WAVE_GRAPH_INTERVAL_SECONDS = 5;
export const WAVE_GRAPH_HEIGHT = 60;
export const WAVE_GRAPH_WIDTH = 2000;
export const WAVE_GRAPH_DOT_SIZE = 2;
export const WAVE_GRAPH_DOT_SPACING = 8;
export const WAVE_GRAPH_MAX_SEND = 8;
export const WAVE_GRAPH_DOT_OPACITY = 0.2;
export const WAVE_GRAPH_DOT_OPACITY_WAVE_START = 0.5;
export const WAVE_GRAPH_MAIN_OPACITY = 0.3;

export const WAVE_GRAPH_COLOR_DAMAGE = "#e8dcc0";
export const WAVE_GRAPH_COLOR_MAX_ENEMY_HEALTH = "#e05548";
export const WAVE_GRAPH_COLOR_GOLD_EARNED = "#ffd84d";
export const WAVE_GRAPH_COLOR_GEMS_EARNED = "#9be7ff";

export const WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN = "#5ec46a";
export const WAVE_GRAPH_COLOR_BASE_HEALTH_YELLOW = "#ffd84d";
export const WAVE_GRAPH_COLOR_BASE_HEALTH_RED = "#e05548";
