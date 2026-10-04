import type { MapThemeData, SpawnState } from "@/render/themes/index.js";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import {
  type ActiveMendSource,
  BossAbilityRuntime,
  type BossShotTarget,
  bossAbilityLabel,
  collectMendSourcesInto,
  configureBossAbility,
  minionPulseCount,
  nearerMendBlocksIn,
  rollBossAbilities,
} from "@/sim/bossAbilities.js";
import type { DebugKind } from "@/sim/Command.js";
import { enemyLevelForWave, waveBossCount } from "@/sim/ConstantsEnemy.js";
import { ICE_AURA_RANGE, STATIC_FIELD_RANGE } from "@/sim/ConstantsTower.js";
import type { AttackTarget, Enemy } from "@/sim/enemies/Enemy.js";
import { invalidateNearestWalkableCache, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
import { writeFlightVelocities } from "@/sim/enemies/flyingSteer.js";
import type { GameRunState } from "@/sim/GameRunState.js";
import {
  addGold,
  createFreshGemBreakdown,
  cycleTimeScale,
  damageBase,
  hasClaimedMilestoneRun,
  setGameState,
  setGold,
  setHoverTile,
  setWave,
  togglePauseState,
  triggerEnd,
} from "@/sim/GameRunState.js";
import { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import { forkRunSeed, generateRandomMap, mulberry32 } from "@/sim/grid/Map.js";
import {
  type BlockTemplate,
  boardToGeneratedMap,
  boardWithPlayerStamp,
  commitPlacement,
  createProgressiveBoard,
  drawBlockOffer,
  gemMultiplierForRegionLevel,
  generateProgressiveMap,
  offerHasAlternative,
  type ProgressiveBoard,
  type ProgressiveConfig,
  type ProgressiveStamp,
  progressiveConfigFromMap,
  replayProgressiveBoard,
  resolveGeneratedMap,
} from "@/sim/grid/ProgressiveMap.js";
import type { HostBindings, ThemeBundle } from "@/sim/HostBindings.js";
import { MapSiteManager } from "@/sim/MapSiteManager.js";
import type { MapBuildingSite, MapCacheSite, SupplyDropSite } from "@/sim/mapSites.js";
import { collectWorldKeys, neighborBonus, playerPlacedBlockCount, stampWorldKeysForBlock } from "@/sim/mapSites.js";
import { CrowdManager, restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import { FlightDistanceField } from "@/sim/navmesh/FlightDistanceField.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder, probeWalkMesh } from "@/sim/navmesh/NavMeshBuilder.js";
import type { ParticleSpawner } from "@/sim/ParticleSystem.js";
import { NoopParticleSpawner } from "@/sim/ParticleSystem.js";
import type { PersistState } from "@/sim/PersistState.js";
import {
  difficultyMultiplier as getDifficultyMultiplier,
  getDifficultyTick,
  addRunToHistory as persistAddRunToHistory,
  clearActiveWave as persistClearActiveWave,
  hasClaimedMilestone as persistHasClaimedMilestone,
  hasCleared as persistHasCleared,
  markFirstClear as persistMarkFirstClear,
  markFirstTimeMilestone as persistMarkFirstTimeMilestone,
  maybeUnlockNextMap as persistMaybeUnlockNextMap,
  updateBestWave as persistUpdateBestWave,
  WORKER_RUN_DATE_SENTINEL,
} from "@/sim/PersistState.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import { ContactProcessor } from "@/sim/physics/ContactProcessor.js";
import { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import { separateEnemiesFromTowers } from "@/sim/physics/separateEnemiesFromTowers.js";
import type { BonusApplication } from "@/sim/runBonuses.js";
import {
  cacheOpenGold,
  curateBonusOffer,
  describeBonus,
  freshRunBonuses,
  rollSpecialistType,
} from "@/sim/runBonuses.js";
import type { BaseDefenseSnapshot } from "@/sim/SimulationSnapshot.js";
import { BASE_SELECTION_ID, BaseDefense } from "@/sim/towers/BaseDefense.js";
import { maxLevelForBase } from "@/sim/towers/SkillTree.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { TowerManager } from "@/sim/towers/TowerManager.js";
import { WaveGraphTracker } from "@/sim/WaveGraphTracker.js";
import { type WaveEntry, WaveManager } from "@/sim/waves/WaveManager.js";
import {
  BETWEEN_WAVES_TIMER,
  BONUS_GEM_BASE,
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  CUSTOM_RANDOM_MAP_INDEX,
  DIFFICULTY_MULT_GEM_BASE,
  FIXED_DT,
  GAMEPLAY_ENEMY_CAP,
  GameState,
  MILESTONE_GEMS,
  MILESTONE_WAVES,
  PROGRESSIVE_PLACEMENT_INTERVAL,
  progressiveRerollGoldPerWave,
  SELL_DISCOUNT_PCT,
  SELL_VALUE_RATIO,
  SLOW_HEALING_PER_ROUND,
  STARTING_BASE_HEALTH,
  STARTING_GOLD_BONUS,
  STARTING_HEALTH_BONUS,
  StartingGold,
  UPGRADE_COST_REDUCTION_PCT,
  VICTORY_WAVE,
} from "./Constants.js";
import { GHOST_PARTICLE_COUNT, GHOST_PARTICLE_DURATION, TOWER_META, type TowerId } from "./ConstantsTower.js";

interface WaveManagerRef {
  currentWave: number;
  betweenWaves: boolean;
  countdownActive: boolean;
  countdownTimer: number;
  betweenTimer: number;
  baseReached: boolean;
  waveComposition: Record<string, number>;
  active: boolean;
  _waveGameTime: number;
  spawnStates: SpawnState[];
  advanceHeld: boolean;
  map: {
    regionId: number;
    level: number;
    bossCadence: number;
    spawns: { x: number; y: number; id?: number }[];
    seed: number;
  };
  resizeSpawnStatesById(previousSpawns: Array<{ id?: number }>, nextSpawns: Array<{ id?: number }>): void;
  update(
    dt: number,
    onWaveCleared: ((wave: number) => void) | null,
    onWaveStart: ((wave: number) => void) | null,
    onWaveExpired: ((wave: number) => void) | null,
  ): void;
  startNextWave(): void;
  debugJumpToWave(wave: number): void;
  getRemainingScheduledSpawns(): number;
  bossAbilityStamper: ((entries: WaveEntry[], waveNumber: number) => void) | null;
}

export class GameEngine {
  runState!: GameRunState;
  persistState!: PersistState;
  host: HostBindings;
  grid: Grid | null;
  enemyManager: EnemyManager | null;
  towerManager: TowerManager | null;
  physicsWorld: PhysicsWorld | null = null;
  crowdManager: CrowdManager | null = null;
  navMeshBuilder: NavMeshBuilder | null = null;
  forceFieldSystem: ForceFieldSystem = new ForceFieldSystem();
  contactProcessor: ContactProcessor | null = null;
  navDistanceField: NavDistanceField | null = null;
  flightDistanceField: FlightDistanceField | null = null;
  // Last grid.pathVersion we rebuilt tower/corridor colliders + nav field for.
  private lastPathVersion = -1;
  waveManager: WaveManagerRef | null;
  projectileManager: ProjectileManager | null;
  baseDefense: BaseDefense | null = null;
  particleSpawner: ParticleSpawner;
  waveGraphTracker: WaveGraphTracker | null = null;
  totalGoldEarned: number;
  totalHealingReceived: number;
  maxBaseHealth: number;
  simSeconds: number;
  // Sim seconds silently discarded when the fixed-step accumulator caps under
  // overload (see computeStepBudget in WorkerEntry). Exposed in snapshot meta so
  // replays/load can tell "ran slow" apart from "ran fine".
  droppedSimSeconds: number = 0;
  // Per-run seeded combat-roll source, forked from (map seed, runId). Injected
  // into ProjectileManager/ParticleSystem so replays of the same run are bit-identical.
  simRng: () => number = Math.random;
  waveTopTowers: Array<{ towerId: string; rank: number; damage: number; simSeconds: number }> | null;
  debugPhysicsEnabled: boolean;
  lastScaledDt: number = 0;
  // Path-version gate for snapshot serialization: the last grid.pathVersion we
  // included in a posted snapshot. Resets per run so each engine starts clean
  // (see _initMap). Engine-scoped (not module-scoped) so direct buildSnapshot
  // callers in tests behave deterministically.
  lastPostedPathVersion: number = -1;
  // Data-feed toggle for the `gridLayout` commander snapshot field (see §1.4). When
  // true, the serializer includes the constant grid layout; the commander worker
  // flips it off after caching the map to keep per-tick cost at zero. Reset per run
  // alongside lastPostedPathVersion so each engine starts with the feed enabled.
  gridLayoutEnabled: boolean = true;
  // Memoized 2D grid layout for the serializer (terrain is constant per run), so
  // the per-tick build reuses one array reference instead of rebuilding it. The
  // runId stamp invalidates the cache on every (re)load.
  gridLayoutCache: number[][] | null = null;
  gridLayoutCacheRunId: number = -1;
  // Stored tile heights, shipped in the same one-shot feed as gridLayout.
  gridHeightsCache: number[][] | null = null;
  gridHeightsCacheRunId: number = -1;
  // Monotonic run identifier, bumped on every (re)load in _initMap. The commander
  // relay/worker key their gridLayout cache + one-shot feed-off toggle to it so a
  // stale layout from a previous run is never forwarded and the toggle re-arms on a
  // run restart (robust even for same-map replays, where mapIndex/layout are equal).
  runId: number = 0;
  progressivePlacementHold = false;
  progressiveResumeMode: "countdown" | "expire-advance" | null = null;
  progressiveOffer: number[] = [];
  progressivePlacements: ProgressiveStamp[] = [];
  // Undo stash for the paused window between a placement and the first unpause:
  // the stamp-log length before the placement plus the offer that was open, so
  // undo can truncate the log and re-open that same hold. Cleared on unpause,
  // when a hold opens, and on (re)load.
  progressivePlacementUndo: { stampCount: number; offer: number[] } | null = null;
  layoutGeneration = 0;
  lastPostedLayoutGeneration = -1;
  readonly sites = new MapSiteManager();
  private readonly bossAbilityRuntime = new BossAbilityRuntime({
    // The tower list resolves only when a towerShot boss arms a bombard, so a wave
    // without one pays nothing for it.
    towers: () => this.bossShotTargets(),
    spawnMinions: (boss) => this.spawnBossMinions(boss),
    damageTower: (towerId, amount, attacker) => {
      const tower = this.towerManager?.getTowerById(towerId);
      if (!tower || tower.isGhost) return;
      tower.takeAbilityDamage(amount, attacker);
    },
  });
  private mendSources: readonly ActiveMendSource[] = [];
  private readonly mendSourceBuffer: ActiveMendSource[] = [];
  private readonly cacheShotTargetBuffer: { id: number; x: number; y: number }[] = [];

  get supplyDrops(): SupplyDropSite[] {
    return this.sites.supplyDrops;
  }

  get mapCaches(): MapCacheSite[] {
    return this.sites.mapCaches;
  }

  get mapBuildings(): MapBuildingSite[] {
    return this.sites.mapBuildings;
  }
  nextBossAbilityNames: string[] = [];
  // Broken caches waiting for the picker that is currently open to close. The
  // wasPlaying flag is inherited so the whole chain resumes exactly once.
  pendingBrokenCaches: { id: number; wasPlaying: boolean }[] = [];
  private progressiveBoard: ProgressiveBoard | null = null;
  private progressiveCatalog: BlockTemplate[] | null = null;
  private progressiveRng: (() => number) | null = null;
  // Last wave-graph dots generation posted (mirrors lastPostedPathVersion).
  // Reset on (re)init so the first post after a new run includes the array.
  lastPostedWaveGraphGeneration: number = 0;
  shouldEndGame: boolean = false;
  gameEnded: boolean = false;
  persistDirty: boolean = false;
  // Tower ids whose sell confirm dialog the user accepted (granted via the
  // requestConfirm promise in sellSelected). executeSellById consumes one grant
  // per sale, so a main-thread executeSell without a prior user confirm is
  // rejected instead of trusted.
  private sellConfirmGrants = new Set<string>();

  theme: MapThemeData | null = null;
  // World id the run's map progress keys on (themeProgress bucket). Defaults to
  // the default world when the bundle carries no active theme.
  themeId: string = DEFAULT_THEME_ID;
  themeBundle: ThemeBundle;
  mapIndex: number = 0;
  randomMapParams: Record<string, unknown> | null = null;

  constructor(
    persistState: PersistState,
    themeBundle: ThemeBundle,
    host: HostBindings,
    mapIndex: number,
    randomMapParams?: unknown,
    particleSpawner: ParticleSpawner = new NoopParticleSpawner(),
  ) {
    this.persistState = persistState;
    this.host = host;
    this.themeBundle = themeBundle;
    this.theme = themeBundle.active ?? null;
    this.themeId = this.theme?.id ?? DEFAULT_THEME_ID;
    this.mapIndex = mapIndex;
    this.randomMapParams = (randomMapParams as Record<string, unknown> | null) ?? null;

    if (this.theme) {
      this.setTheme(this.theme);
    }

    this.grid = null;
    this.enemyManager = null;
    this.towerManager = null;
    this.waveManager = null;
    this.projectileManager = null;
    this.particleSpawner = particleSpawner;

    this.totalGoldEarned = 0;
    this.totalHealingReceived = 0;
    this.maxBaseHealth = STARTING_BASE_HEALTH;
    this.simSeconds = 0;
    this.waveTopTowers = null;
    this.debugPhysicsEnabled = false;
    this.gameEnded = false;
  }

  setTheme(theme: MapThemeData | null): void {
    this.theme = theme;
    this.themeId = theme?.id ?? DEFAULT_THEME_ID;
  }

  loadMap(mapIndex: number = this.mapIndex): void {
    // Theme worlds carry their own maps catalog (seeds / progressive variants);
    // a theme without an override falls back to the default catalog.
    const mapData = resolveGeneratedMap(mapIndex, this.theme?.maps);
    this._initMap(mapIndex, mapData, this.persistState);
  }

  loadRandomMap(width: number, height: number, level: number, style: string, regionId: number, seed: number): void {
    // Custom generated maps are not catalog entries, but they still take the
    // active world's terrain noise scalars so a world's character holds.
    const mapData = generateRandomMap(width, height, style, regionId, level, seed, this.theme?.maps);
    this._initMap(CUSTOM_RANDOM_MAP_INDEX, mapData, this.persistState);
  }

  loadProgressiveMap(config: ProgressiveConfig): void {
    const mapData = generateProgressiveMap(config);
    this._initMap(CUSTOM_PROGRESSIVE_MAP_INDEX, mapData, this.persistState);
  }

  _initMap(mapIndex: number, mapData: GeneratedMap, persistState: PersistState): void {
    this.persistState = persistState;
    // Reset the path-version gate so the first snapshot after a (re)load always
    // includes the authoritative paths (the main thread needs them to draw the
    // initial highlights, and to notice reroutes on the first build/sell).
    this.lastPostedPathVersion = -1;
    this.lastPostedWaveGraphGeneration = 0;
    this.gridLayoutEnabled = true;
    this.runId += 1;
    this.progressivePlacementHold = false;
    this.progressiveResumeMode = null;
    this.progressiveOffer = [];
    this.progressivePlacements = [];
    this.progressivePlacementUndo = null;
    this.layoutGeneration = 0;
    this.lastPostedLayoutGeneration = -1;
    this.sites.reset();
    this.nextBossAbilityNames = [];
    this.pendingBrokenCaches = [];
    this.progressiveBoard = null;
    this.progressiveCatalog = null;
    this.progressiveRng = null;
    this.gameEnded = false;
    this.shouldEndGame = false;

    this.runState = {
      state: GameState.PAUSED,
      mapIndex,
      map: mapData,
      grid: null,
      baseHealth: STARTING_BASE_HEALTH,
      maxBaseHealth: STARTING_BASE_HEALTH,
      gold: 0,
      currentWave: 0,
      waveCountdown: null,
      timeScale: 1,
      commanderHold: false,
      selectedTowerId: null,
      selectedTowerType: null,
      hoverTile: null,
      hoverUpgradeBtn: false,
      runGemsEarned: 0,
      bossesKilledThisRun: 0,
      bossesReachedBaseThisRun: 0,
      bossesSpawned: 0,
      runBonuses: freshRunBonuses(),
      bonusPicker: null,
      milestoneRewardsClaimed: {},
      gemBreakdown: createFreshGemBreakdown(),
      endScreenData: null,
      randomMapParams: this.randomMapParams,
    };

    this.host.notifyUi({ type: "initForRun", mapIndex });

    resetEnemyId();

    this.grid = new Grid(mapData);
    this.grid.regionId = mapData.regionId;
    this.runState.grid = this.grid;

    const diffTick = getDifficultyTick(this.persistState);
    this.enemyManager = new EnemyManager(
      this.grid,
      this.particleSpawner,
      diffTick,
      this.theme,
      this.themeBundle.defaultEnemyVisuals,
    );
    // Runs inside spawn, after the ability field is set and before the crowd agent.
    this.enemyManager.onSpawned = (enemy) => this.onEnemySpawned(enemy);
    this.projectileManager = new ProjectileManager(this.enemyManager, this.particleSpawner, null, this.grid);
    // Arrival is in ProjectileManager, after the tower that fired has returned.
    this.projectileManager.setOnCacheHit((cacheId, damage) => this.damageCache(cacheId, damage));
    this.towerManager = new TowerManager(
      this.grid,
      this.particleSpawner,
      this.projectileManager,
      this.host,
      this.theme,
      this.themeBundle.defaultTowerVisuals,
    );
    // setEngineMax writes this.maxBaseHealth from the base level curve.
    this.baseDefense = new BaseDefense(this.grid, this.runState, (maxHealth) => {
      this.maxBaseHealth = maxHealth;
    });
    this.projectileManager.setTowerLookup((towerId) => {
      if (towerId === BASE_SELECTION_ID) return this.baseDefense;
      return this.towerManager?.getTowerById(towerId) ?? null;
    });
    // Burn ticks run inside Enemy.updateStatusTimers; route their dealt damage
    // back through the projectile manager's tower credit so the DPS graph and
    // milestone progression see burn like any other tower damage.
    this.enemyManager.setDamageCreditSink((towerId, amount) => this.projectileManager?.creditDamage(towerId, amount));
    // Fork the per-run combat-roll source from (map seed, runId) and hand it to
    // every sim roller, so the same run replays identically and distinct runs diverge.
    this.simRng = mulberry32(forkRunSeed(mapData.seed, this.runId));
    if (mapData.style === "progressive") {
      const config = progressiveConfigFromMap(mapData);
      if (config) {
        const started = createProgressiveBoard(config);
        this.progressiveBoard = started.board;
        this.progressiveCatalog = started.catalog;
        // Separate stream from simRng: same seed, so offers do not consume combat rolls.
        this.progressiveRng = mulberry32(forkRunSeed(mapData.seed, this.runId));
      }
    }
    this.projectileManager.setRng(this.simRng);
    this.particleSpawner.setRng?.(this.simRng);
    this.enemyManager.setTowerManager(this.towerManager);
    // Tear down prior physics/crowd/navmesh before rebuild (same order as dispose).
    this.crowdManager?.destroy();
    this.crowdManager = null;
    this.enemyManager?.setCrowdManager(null);
    this.navMeshBuilder?.destroy();
    this.navMeshBuilder = null;
    this.forceFieldSystem.clear();
    this.contactProcessor = null;
    this.navDistanceField = null;
    this.flightDistanceField = null;
    this.physicsWorld?.dispose();
    this.physicsWorld = new PhysicsWorld(this.grid);
    this.enemyManager.setPhysicsWorld(this.physicsWorld);
    this.projectileManager.setPhysicsWorld(this.physicsWorld);
    this.contactProcessor = new ContactProcessor({
      getEnemyById: (enemyId) => this.enemyManager?.getEnemyById(enemyId) ?? null,
      getTowerById: (towerId) => this.towerManager?.getTowerById(towerId) ?? null,
    });
    this.physicsWorld.setContactProcessor(this.contactProcessor);
    const navBuilder = new NavMeshBuilder(this.grid);
    this.navMeshBuilder = navBuilder;
    if (!navBuilder.isSuccess() || !navBuilder.getNavMesh()) {
      const buildError = navBuilder.getError() ?? "unknown navmesh error";
      navBuilder.destroy();
      this.navMeshBuilder = null;
      throw new Error(`Navmesh build failed: ${buildError}`);
    }
    this.crowdManager = new CrowdManager(navBuilder.getNavMesh()!, this.grid.tileSize, GAMEPLAY_ENEMY_CAP);
    this.crowdManager.setForceFieldSystem(this.forceFieldSystem);
    this.enemyManager.setCrowdManager(this.crowdManager);
    this.physicsWorld.setEnemyEnemyCollisions(false);
    this.navDistanceField = new NavDistanceField(this.grid, this.navMeshBuilder);
    this.navDistanceField.rebuild();
    this.flightDistanceField = new FlightDistanceField(this.grid);
    this.flightDistanceField.rebuild(this.liveTowerAt, this.grid.pathVersion);
    const distanceToBase = (tileX: number, tileY: number, flyingHeight = 0): number => {
      if (flyingHeight > 0) return this.flightDistanceField?.getDistanceToBase(tileX, tileY, flyingHeight) ?? -1;
      return this.navDistanceField?.getDistanceToBase(tileX, tileY) ?? -1;
    };
    this.towerManager.setNavDistanceToBase(distanceToBase);
    this.baseDefense?.setNavDistanceToBase(distanceToBase);
    this.enemyManager.setBlockedApproachLookup(
      (tileX, tileY) => this.navDistanceField?.getBlockedApproach(tileX, tileY) ?? null,
    );
    this.enemyManager.setDistanceToBaseLookup(
      (tileX, tileY) => this.navDistanceField?.getDistanceToBase(tileX, tileY) ?? -1,
    );
    this.enemyManager.setThroughDistanceLookup(
      (tileX, tileY) => this.navDistanceField?.getThroughDistanceToBase(tileX, tileY) ?? -1,
      (tileX, tileY) => this.navDistanceField?.getThroughBlockers(tileX, tileY) ?? [],
    );
    this.enemyManager.setFlightDistanceLookup(
      (tileX, tileY, flyingHeight) => this.flightDistanceField?.getDistanceToBase(tileX, tileY, flyingHeight) ?? -1,
    );
    this.physicsWorld.rebuildTowers(this.towerManager);
    this.enemyManager.baseTarget = new BaseTarget(this);
    this.projectileManager.setOnGoldReward((amount) => {
      this.waveGraphTracker?.onGoldBounty(amount);
      this.earnGold(amount);
    });
    this.waveManager = new WaveManager(mapData, this.enemyManager);
    this.waveManager.bossAbilityStamper = (entries, waveNumber) => this.stampBossAbilities(entries, waveNumber);

    this.waveGraphTracker = new WaveGraphTracker(
      this.runState,
      this.persistState,
      this.towerManager!,
      this.enemyManager!,
      this.baseDefense,
    );

    this._applyStartingBonuses();
    // Sites stay out of the navmesh. Reservations only block construction.
    this.syncMapSites(null);

    setWave(this.runState, this.waveManager.currentWave);
    this.totalGoldEarned = 0;
    this.totalHealingReceived = 0;
    this.simSeconds = 0;
    this.droppedSimSeconds = 0;
    this.waveTopTowers = null;
    this.debugPhysicsEnabled = false;
  }

  _applyStartingBonuses(): void {
    const generalAddons = this.persistState.generalAddons;

    const regionId = this.runState.map?.regionId ?? 0;
    this.runState.gold = StartingGold[regionId] ?? StartingGold[0];

    const ehTier = generalAddons.extraHealth;
    let levelOneHealth = STARTING_BASE_HEALTH;
    if (ehTier !== null && ehTier !== undefined) {
      levelOneHealth += STARTING_HEALTH_BONUS[ehTier] || 0;
    }
    this.baseDefense?.applyStartingHealth(levelOneHealth);

    const sgTier = generalAddons.startingGold;
    if (sgTier !== null && sgTier !== undefined) {
      this.runState.gold += STARTING_GOLD_BONUS[sgTier] || 0;
    }
  }

  // Every map — catalog, progressive variant, or custom — earns the gem multiplier
  // of its region/level pair, so custom runs price like the fixed map they match.
  private runGemMapMultiplier(): number {
    const map = this.runState.map;
    if (!map) return 1;
    return gemMultiplierForRegionLevel(map.regionId, map.level);
  }

  onBossKilled(): void {
    this.runState.bossesKilledThisRun++;

    const base = 1;
    const diffMult = getDifficultyMultiplier(this.persistState);
    const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
    const mapMult = this.runGemMapMultiplier();

    const afterDiff = Math.ceil(base * gemMult);
    const afterRegion = Math.ceil(afterDiff * mapMult);

    const breakdown = this.runState.gemBreakdown.bossKills;
    breakdown.base += base;
    breakdown.afterDiff += afterDiff;
    breakdown.afterRegion += afterRegion;
    breakdown.afterFirstTime += afterRegion;

    this.persistState.gems += afterRegion;
    this.runState.runGemsEarned += afterRegion;
    this.persistDirty = true;

    this.host.playSound("boss_die");
  }

  // A live tower is a non-ghost tower on the tile. Path ghosts leave `blocked`;
  // terrain ghosts stay in `terrainTowers`, so the tower flag is the check.
  private liveTowerAt = (tileX: number, tileY: number): boolean => {
    const tower = this.towerManager?.towerAt(tileX, tileY) ?? null;
    return tower !== null && !tower.isGhost;
  };

  update(dt: number): void {
    if (!this.waveManager || !this.enemyManager || !this.towerManager) return;
    if (this.runState.state === GameState.VICTORY || this.runState.state === GameState.GAME_OVER) return;

    this.simSeconds += dt;

    this.waveManager.update(
      dt,
      (wave) => this.onWaveCleared(wave),
      (wave) => this.onWaveStart(wave),
      (wave) => this.onWaveExpired(wave),
    );
    if (this.progressivePlacementHold) {
      this.runState.waveCountdown = null;
      return;
    }

    // Per-tick backlog drain (not only on death): releases queued enemies whenever
    // the live count is under the gameplay cap, so immortal base-attackers can
    // never pin the pending queue. Runs pre-step so released enemies join this tick.
    this.enemyManager.drainPendingQueues();

    // Cross-module: Mend bosses read this list from their spawn-time closure, so it
    // is rebuilt once per tick here rather than once per ally inside a heal tick.
    // Sources are read at tick start, so a boss that spawns mid-tick only joins the
    // list next tick, where the worst case is one tick of two Mend bosses both healing.
    // The closure only reads it during this tick's boss combat, before the next
    // rebuild overwrites the buffer.
    this.mendSources = collectMendSourcesInto(this.enemyManager.enemies, this.mendSourceBuffer);

    const wm = this.waveManager;
    if (wm.countdownActive) {
      const currentRemaining = Math.ceil(wm.countdownTimer);
      const stored: { remaining: number; nextWave: number } | null = this.runState.waveCountdown;
      if (!stored || stored.remaining !== currentRemaining) {
        this.runState.waveCountdown = { remaining: currentRemaining, nextWave: wm.currentWave + 1 };
      }
      this.refreshBossPreview();
    } else {
      if (this.runState.waveCountdown !== null) this.runState.waveCountdown = null;
      if (this.nextBossAbilityNames.length > 0) this.nextBossAbilityNames = [];
    }

    // Haste and the minion attack timestamp are written before crowd update and
    // before preStep increments gameSeconds, so the first frame of the attack plays.
    this.tickBossCombat(dt);

    if (this.grid!.pathVersion !== this.lastPathVersion) {
      this.physicsWorld!.rebuildTowers(this.towerManager!);
      const towersConverged = this.navMeshBuilder?.syncTowers(this.towerManager!.towers) ?? true;
      this.navDistanceField?.ensureUpToDate(true);
      this.flightDistanceField?.ensureUpToDate(this.liveTowerAt, this.grid!.pathVersion);
      for (const enemy of this.enemyManager.enemies) {
        if (enemy.flyingHeight > 0) enemy.clearFlightPolyline();
      }
      if (!towersConverged) {
        // Obstacle sync did not converge (add failed or update queue stuck): force a
        // second distance-field refresh and re-request crowd corridors instead of
        // routing on a half-applied obstacle set.
        this.navDistanceField?.ensureUpToDate(true);
        // Reuses the Block B cached move targets (no recompute): reissuing the last
        // target per enemy is what keeps 8x-16x step bursts from compounding lag.
        if (this.crowdManager && this.enemyManager) {
          this.crowdManager.reissueMoveTargets(this.enemyManager.enemies);
        }
      }
      this.lastPathVersion = this.grid!.pathVersion;
      // Cuboids for this pathVersion now exist. A center inside a live tower
      // tile is where a square just appeared (ghost restore or a build under
      // them). Move them out before the physics step shoves them into a siege.
      separateEnemiesFromTowers(this.enemyManager.enemies, this.towerManager!.towers, this.grid!, this.crowdManager);
    }
    const onEnemyKill = (enemy: Enemy): void => {
      if (enemy.removed) {
        if (enemy.type === "boss") {
          this.onBossKilled();
        }
        this.onEnemyKill(enemy);
      }
    };
    const onEnemyBeginAttackBase = (enemy: Enemy): void => {
      this.waveManager!.baseReached = true;
      if (enemy.type === "boss") {
        this.runState.bossesReachedBaseThisRun++;
      }
    };

    this.syncAuraSensors();
    this.enemyManager.preStep(dt);
    this.crowdManager?.update(dt, this.enemyManager.enemies);
    writeFlightVelocities(this.enemyManager.enemies, this.grid!, dt, this.forceFieldSystem);
    this.forceFieldSystem.apply(dt, this.enemyManager.enemies, this.physicsWorld);
    // Homing projectiles set kinematic velocities before the physics step.
    this.projectileManager?.prePhysics(dt);
    // FIXED_DT is passed explicitly: PhysicsWorld.step asserts it, so a variable-dt
    // caller fails loudly instead of silently desyncing the fixed-step sim.
    this.physicsWorld!.step(FIXED_DT);
    // PhysicsWorld.step already projected contact flags onto enemies; drain the
    // projectile hit queue for postPhysics resolution.
    const projectileHits = this.contactProcessor?.drainProjectileHits() ?? [];
    this.enemyManager.postStep(dt, onEnemyKill, onEnemyBeginAttackBase);
    // Projectiles read body positions and resolve hits (contacts + cast fallback).
    this.projectileManager?.postPhysics(dt, projectileHits);
    this.clampBallisticEnemiesToNavMesh();

    // Known one-tick gap (documented, behavior-identical by design): towers fire
    // after projectiles resolved, so a shot born this tick has no body until next
    // tick's prePhysics — it is drawn bodiless for exactly one tick. The tick is NOT
    // reordered: moving tower fire earlier showed no perf win and would shift every
    // combat roll by a tick.
    this.towerManager.update(dt, this.enemyManager, this.cacheShotTargets(), (cacheId, damage) =>
      this.damageCache(cacheId, damage),
    );
    if (this.baseDefense && this.projectileManager) {
      this.baseDefense.update(dt, this.enemyManager, this.projectileManager, this.host, this.simSeconds);
    }

    // Known one-tick gap: a tower ghosted this frame drops its block now (visuals
    // resolve here) but enemies route through the tile only after next tick's
    // pathVersion rebuild — ghost-to-block is visible one tick later by design.
    if (this.grid) {
      for (const tower of this.towerManager.towers) {
        if (tower.pendingGhostEffect) {
          this.particleSpawner?.spawn(tower.x, tower.y, tower.color, GHOST_PARTICLE_COUNT, {
            life: GHOST_PARTICLE_DURATION,
            speed: 80,
          });
          tower.pendingGhostEffect = false;
          this.grid.setTowerGhost(tower.tileX, tower.tileY);
        }
      }
    }

    this.waveGraphTracker?.update(dt);

    if (this.shouldEndGame) {
      this.endGame(false);
      return;
    }

    if (
      this.waveManager.currentWave >= VICTORY_WAVE &&
      this.waveManager.betweenWaves &&
      this.enemyManager.enemies.length === 0 &&
      !this.enemyManager.hasPendingEnemies()
    ) {
      this.endGame(true);
    }
  }

  private syncAuraSensors(): void {
    // Known one-tick gap (documented, behavior-identical by design): sensor bodies
    // are moved here pre-step but their overlaps are queried post-step, so auras
    // and heals observe positions one step old.
    if (!this.physicsWorld || !this.towerManager || !this.enemyManager || !this.grid) return;
    const tileSize = this.grid.tileSize;
    const specs: { sensorId: string; x: number; y: number; radius: number }[] = [];
    for (const tower of this.towerManager.towers) {
      if (tower.isGhost) continue;
      if (tower.stats.frostAura) {
        specs.push({ sensorId: `${tower.id}:frost`, x: tower.x, y: tower.y, radius: ICE_AURA_RANGE * tileSize });
      }
      if (tower.stats.staticField) {
        specs.push({ sensorId: `${tower.id}:static`, x: tower.x, y: tower.y, radius: STATIC_FIELD_RANGE * tileSize });
      }
    }
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.removed || enemy.heal <= 0) continue;
      specs.push({ sensorId: `heal-${enemy.id}`, x: enemy.x, y: enemy.y, radius: enemy.healRange });
    }
    this.physicsWorld.syncAuraSensors(specs);
  }

  // Knockback impulses can shove a body off the navmesh; snap back to the nearest
  // walkable point so Detour and Rapier stay aligned after the ballistic window.
  private clampBallisticEnemiesToNavMesh(): void {
    const builder = this.navMeshBuilder;
    if (!builder || !this.enemyManager || !this.grid) return;
    const tileSize = this.grid.tileSize;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.removed || enemy.flyingHeight > 0 || enemy.ballisticTimer <= 0) continue;
      const nearest = builder.nearestWalkableWorld({ x: enemy.x, y: enemy.y });
      if (!nearest) continue;
      const drift = Math.hypot(nearest.x - enemy.x, nearest.y - enemy.y);
      if (drift < enemy.radius * 0.25) continue;
      // Intentionally parked enemies (base attackers, siege/hold contact) keep their
      // lock unless the shove carried them a full tile off the mesh — clamping them
      // for sub-tile drift would teleport them out of an attack they are winning.
      const intentionallyParked = enemy.attackingBase || enemy.motionLock === "park";
      if (intentionallyParked && drift < tileSize) continue;
      enemy.body?.setTranslation({ x: nearest.x, y: nearest.y }, true);
      enemy.x = nearest.x;
      enemy.y = nearest.y;
      enemy.centerX = nearest.x;
      enemy.centerY = nearest.y;
      // Teleport zeroes Detour steering; restore the pre-teleport crowd velocity so
      // steering resumes in the same direction (mirrors Enemy.postPhysics resync).
      const crowdAgent = enemy.agent;
      if (crowdAgent) {
        const previousVelocity = crowdAgent.velocity();
        this.crowdManager?.teleportAgent(enemy, nearest);
        restoreCrowdAgentVelocity(crowdAgent, previousVelocity);
        if (enemy.lastMoveTargetWorld) {
          crowdAgent.requestMoveTarget(toRecast(enemy.lastMoveTargetWorld));
        }
      } else {
        this.crowdManager?.teleportAgent(enemy, nearest);
      }
    }
  }

  onWaveCleared(wave: number): void {
    setWave(this.runState, wave);
    this.applyWaveProgressRewards(wave);
    if (this.isProgressiveHoldWave(wave)) this.armPlacementHold("countdown");
  }

  // Timer-expiry seam, distinct from the killed path above. Expiry currently pays
  // the same progress rewards (see WaveManager.update: milestones/best-wave/unlock
  // track waves survived, not kills); the separate method exists so a future
  // economy change can price expiry differently with a one-method edit.
  onWaveExpired(wave: number): void {
    setWave(this.runState, wave);
    this.applyWaveProgressRewards(wave);
    if (this.isProgressiveHoldWave(wave)) this.armPlacementHold("expire-advance");
  }

  // Shared milestone/best-wave/unlock path: runs on every natural wave clear and
  // on debug setWave jumps, so gem breakdowns, best waves, and map unlocks stay
  // consistent no matter how the wave counter moved.
  private applyWaveProgressRewards(wave: number): void {
    for (const milestoneWave of MILESTONE_WAVES) {
      if (wave >= milestoneWave && !hasClaimedMilestoneRun(this.runState, milestoneWave)) {
        this.runState.milestoneRewardsClaimed[milestoneWave] = true;

        const hasClaimed =
          this.runState.mapIndex >= 0 &&
          persistHasClaimedMilestone(this.persistState, this.themeId, this.runState.mapIndex, milestoneWave);
        const base = MILESTONE_GEMS[milestoneWave] ?? 0;
        const diffMult = getDifficultyMultiplier(this.persistState);
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const mapMult = this.runGemMapMultiplier();

        const afterDiff = Math.ceil(base * gemMult);
        const afterRegion = Math.ceil(afterDiff * mapMult);
        let afterFirstTime = afterRegion;

        if (!hasClaimed) {
          afterFirstTime = afterRegion * 2;
        }

        const breakdown = this.runState.gemBreakdown.milestones;
        breakdown.base += base;
        breakdown.afterDiff += afterDiff;
        breakdown.afterRegion += afterRegion;
        breakdown.afterFirstTime += afterFirstTime;

        // Record the first-time 2x marker BEFORE crediting the gems, so the reward
        // can never be granted without the claim flag being persisted.
        if (!hasClaimed && this.runState.mapIndex >= 0) {
          persistMarkFirstTimeMilestone(this.persistState, this.themeId, this.runState.mapIndex, milestoneWave);
        }

        this.persistState.gems += afterFirstTime;
        this.runState.runGemsEarned += afterFirstTime;
      }
    }

    if (this.runState.mapIndex >= 0) {
      persistUpdateBestWave(this.persistState, this.themeId, this.runState.mapIndex, wave);
      if (wave >= 15) {
        persistMaybeUnlockNextMap(this.persistState, this.themeId, this.runState.mapIndex);
      }
    }
    this.persistDirty = true;
  }

  onWaveStart(wave: number): void {
    setWave(this.runState, wave);
    this.waveGraphTracker?.onWaveStart(wave);

    const ranked: { towerId: string; damage: number; totalDamage: number }[] = [];
    for (const tower of this.towerManager!.towers) {
      if (tower.waveDamage > 0) {
        ranked.push({ towerId: tower.id, damage: tower.waveDamage, totalDamage: tower.totalDamageDealt });
      }
    }
    if (this.baseDefense && this.baseDefense.waveDamage > 0) {
      ranked.push({
        towerId: BASE_SELECTION_ID,
        damage: this.baseDefense.waveDamage,
        totalDamage: this.baseDefense.totalDamageDealt,
      });
    }
    ranked.sort((entryA, entryB) => entryB.damage - entryA.damage || entryB.totalDamage - entryA.totalDamage);
    const topRanked = ranked.slice(0, 3);
    this.waveTopTowers =
      topRanked.length > 0
        ? topRanked.map((entry, index) => ({
            towerId: entry.towerId,
            rank: index + 1,
            damage: entry.damage,
            simSeconds: this.simSeconds,
          }))
        : null;

    this.towerManager!.towers.forEach((tower) => {
      tower.waveDamage = 0;
    });
    this.baseDefense?.commitWave();

    // Full-restore all towers at wave start so ghosted tiles block again in one
    // pathVersion bump. Enemies still inside those tiles are moved out when
    // update rebuilds the cuboids.
    const towersToClear: Tower[] = [];
    for (const tower of this.towerManager!.towers) {
      tower.health = tower.maxHealth;
      if (tower.isGhost) {
        tower.isGhost = false;
        tower.ghostTimer = 0;
        towersToClear.push(tower);
      }
    }
    if (towersToClear.length > 0 && this.grid) {
      this.grid.batchClearGhosts();
    }

    const generalAddons = this.persistState.generalAddons;
    const healTier = generalAddons.slowHealing;
    if (healTier !== null && healTier !== undefined) {
      const healAmount = SLOW_HEALING_PER_ROUND[healTier] || 0;
      if (this.runState.baseHealth < this.maxBaseHealth) {
        const before = this.runState.baseHealth;
        this.runState.baseHealth = Math.min(this.runState.baseHealth + healAmount, this.maxBaseHealth);
        this.totalHealingReceived += this.runState.baseHealth - before;
      }
    }
  }

  onEnemyKill(enemy: Enemy): void {
    // Summoned minions keep bounty 0. `bounty || 1` would pay 1 gold for that 0.
    if (!enemy.summoned) {
      const bounty = (enemy.bounty || 1) * this.runState.runBonuses.bountyMult;
      this.waveGraphTracker?.onGoldBounty(bounty);
      this.earnGold(bounty);
    }
    if (enemy.type === "boss") this.sites.addSupplyDrop(this.grid, this.runState.map, enemy);
  }

  earnGold(amount: number): void {
    this.totalGoldEarned += amount;
    addGold(this.runState, amount);
  }

  damageBase(amount: number): void {
    damageBase(this.runState, amount);
    if (this.runState.baseHealth <= 0) {
      this.runState.baseHealth = 0;
      this.shouldEndGame = true;
    }
    this.host.playSound("base_hit");
  }

  endGame(victory: boolean): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.runState.selectedTowerId = null;
    this.runState.selectedTowerType = null;
    this.runState.hoverTile = null;
    this.enemyManager!.clear();

    persistClearActiveWave(this.persistState, this.themeId, this.runState.mapIndex);

    const finalWave = this.waveManager!.currentWave;
    const lastLevel = Math.floor(finalWave / 10);
    const perWaveRate = Math.floor(BONUS_GEM_BASE ** lastLevel);
    const totalBonus = Math.floor((finalWave * perWaveRate) / 10);

    if (totalBonus > 0) {
      const diffMult = getDifficultyMultiplier(this.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = this.runGemMapMultiplier();
      const afterDiff = Math.ceil(totalBonus * gemMult);
      const afterRegion = Math.ceil(afterDiff * mapMult);

      const breakdown = this.runState.gemBreakdown.waveCompletion;
      breakdown.base += totalBonus;
      breakdown.afterDiff += afterDiff;
      breakdown.afterRegion += afterRegion;
      breakdown.afterFirstTime += afterRegion;

      this.persistState.gems += afterRegion;
      this.runState.runGemsEarned += afterRegion;
    }

    if (victory && this.waveManager!.currentWave >= VICTORY_WAVE && this.runState.mapIndex >= 0) {
      if (!persistHasCleared(this.persistState, this.themeId, this.runState.mapIndex)) {
        const breakdown = this.runState.gemBreakdown;
        const subtotal =
          breakdown.bossKills.afterFirstTime +
          breakdown.milestones.afterFirstTime +
          breakdown.waveCompletion.afterFirstTime;
        const bonus = subtotal * 2;
        this.runState.gemBreakdown.firstClearBonus = bonus;
        this.persistState.gems += bonus;
        this.runState.runGemsEarned += bonus;
        persistMarkFirstClear(this.persistState, this.themeId, this.runState.mapIndex);
      }
    }

    this.persistDirty = true;

    const historyEntry: Record<string, unknown> = {
      mapIndex: this.runState.mapIndex,
      // World the run took place in; replay resolves the map from that theme's
      // catalog and keys progress on it. Pre-v5 entries lack this field.
      themeId: this.themeId,
      victory,
      wave: this.waveManager!.currentWave,
      gems: this.runState.runGemsEarned,
      bossesKilled: this.runState.bossesKilledThisRun,
      bossesReachedBase: this.runState.bossesReachedBaseThisRun,
      gemBreakdown: this.runState.gemBreakdown,
      // Sentinel: the worker never calls Date.now() (wall-clock would poison
      // deterministic replay). The host stamps the real date on receipt in
      // MainThreadHostBindings.schedulePersistSave via stampRunHistoryDate.
      date: WORKER_RUN_DATE_SENTINEL,
    };

    if (this.runState.mapIndex === CUSTOM_RANDOM_MAP_INDEX && this.runState.randomMapParams) {
      historyEntry.randomMapParams = this.runState.randomMapParams;
    }
    // Custom progressive runs replay from their config; the board growth rewrites
    // the map every placement but never touches these four fields.
    const progressiveParams = progressiveConfigFromMap(this.runState.map);
    if (this.runState.mapIndex === CUSTOM_PROGRESSIVE_MAP_INDEX && progressiveParams) {
      historyEntry.progressiveMapParams = progressiveParams;
    }

    persistAddRunToHistory(this.persistState, historyEntry);
    this.persistDirty = true;

    triggerEnd(this.runState, victory, {
      wave: this.waveManager!.currentWave,
      gems: this.runState.runGemsEarned,
      gemBreakdown: this.runState.gemBreakdown,
    });
  }

  private selectedAnchorTile(): { tileX: number; tileY: number } | null {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) {
      const base = this.grid?.getBase();
      if (!base) return null;
      return { tileX: base.x, tileY: base.y };
    }
    const selectedTower = this.getSelectedTower();
    if (!selectedTower) return null;
    return { tileX: selectedTower.tileX, tileY: selectedTower.tileY };
  }

  private isUpgradeBtnAt(worldX: number, worldY: number): boolean {
    if (this.runState.selectedTowerType) return false;
    const anchor = this.selectedAnchorTile();
    if (!anchor) return false;
    const tileSize = this.grid?.tileSize || 36;
    const originX = this.grid?.worldOriginX ?? 0;
    const originY = this.grid?.worldOriginY ?? 0;
    const buildX = originX + (anchor.tileX + 1) * tileSize - 12;
    const buildY = originY + anchor.tileY * tileSize + 2;
    return worldX >= buildX && worldX <= buildX + 10 && worldY >= buildY && worldY <= buildY + 10;
  }

  private getSelectedTower(): Tower | null {
    if (!this.runState.selectedTowerId || !this.towerManager) return null;
    return this.towerManager.getTowerById(this.runState.selectedTowerId) ?? null;
  }

  // Maps enemy ids → the live Enemy instances, used by applyCommand to resolve the
  // id-addressed `llm:*` commander commands. Returns only the enemies that actually
  // exist (ids with no matching enemy are silently dropped).
  getEnemiesByIds(enemyIds: number[]): Enemy[] {
    const enemiesById = this.buildEnemyLookup();
    const matchedEnemies: Enemy[] = [];
    for (const enemyId of enemyIds) {
      const enemy = enemiesById.get(enemyId);
      if (enemy) matchedEnemies.push(enemy);
    }
    return matchedEnemies;
  }

  // Single id→enemy map build shared by getEnemiesByIds, applyCommand, and
  // applyCommandStats so one command never builds it twice.
  buildEnemyLookup(): Map<number, Enemy> {
    return new Map((this.enemyManager?.enemies ?? []).map((enemy) => [enemy.id, enemy]));
  }

  handleClick(worldX: number, worldY: number): void {
    if (!this.grid) return;

    const tile = this.grid.worldToTile(worldX, worldY);
    const tx = tile.x;
    const ty = tile.y;

    if (this.runState.bonusPicker) return;

    if (this.progressivePlacementHold) {
      // A missed site used to select the tower under the cursor and reopen the
      // tower panel on top of the block choices. The hold owns selection.
      this.runState.selectedTowerType = null;
      this.runState.selectedTowerId = null;
      return;
    }

    if (this.isUpgradeBtnAt(worldX, worldY)) {
      this.upgradeSelected();
      return;
    }

    const packageHit = this.sites.nearestPackage(this.grid, worldX, worldY);
    if (packageHit) {
      // An intact cache opens its picker locked: the fee is charged by
      // unlockCache, never by the click itself, so a short purse still shows the
      // unlock button instead of a toast.
      this.openBonusPicker(packageHit.source, packageHit.id);
      return;
    }

    if (!this.grid.inBounds(tx, ty)) {
      if (this.runState.selectedTowerType) this.runState.selectedTowerType = null;
      return;
    }

    if (this.grid.isBase(tx, ty)) {
      this.runState.selectedTowerType = null;
      this.runState.selectedTowerId = BASE_SELECTION_ID;
      return;
    }

    if (this.runState.selectedTowerType) {
      const existing = this.towerManager?.towerAt(tx, ty);
      if (existing) {
        this.runState.selectedTowerType = null;
        this.runState.selectedTowerId = String(existing.id);
      } else {
        const towerType = this.runState.selectedTowerType;
        const meta = TOWER_META[towerType]!;
        const discount = this.persistState.generalAddons?.sellActive === "discount" ? 1 - SELL_DISCOUNT_PCT : 1;
        const cost = Math.floor(meta.cost * discount);
        if (this.runState.gold >= cost && this.grid.canBuild(tx, ty)) {
          // Path-blocking placements are allowed: towers have HP and enemies attack
          // them when the corridor is walled (maze / blocking-tower design).
          const tower = this.towerManager?.build(towerType, tx, ty, this.persistState, this.grid, cost);
          if (tower) {
            setGold(this.runState, this.runState.gold - cost);
            this.runState.selectedTowerId = String(tower.id);
            this.host.syncGridTower(tx, ty, true);
            // The constructor filled HP from unbuffed stats. Scale to the run and site factors.
            this.refreshAllTowerBonuses();
          }
        }
      }
    } else {
      const tower = this.towerManager?.towerAt(tx, ty);
      this.runState.selectedTowerId = tower ? String(tower.id) : null;
    }
  }

  getUpgradeCost(tower: Tower): number {
    const check = tower.canUpgrade(this.persistState);
    if (!check.ok) {
      if (check.needVariant) {
        const specializationCost = tower.upgradeCost(5);
        const ucrTier = this.persistState.generalAddons.upgradeCostReduction;
        if (ucrTier !== null && ucrTier !== undefined) {
          const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
          return Math.floor(specializationCost * (1 - reduction));
        }
        return specializationCost;
      }
      return 0;
    }
    const cost = check.cost ?? 0;
    const ucrTier = this.persistState.generalAddons.upgradeCostReduction;
    if (ucrTier !== null && ucrTier !== undefined) {
      const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
      return Math.floor(cost * (1 - reduction));
    }
    return cost;
  }

  canAffordUpgrade(tower: Tower): boolean {
    if (!tower) return false;
    return this.runState.gold >= this.getUpgradeCost(tower);
  }

  private reducedUpgradeCost(rawCost: number): number {
    const ucrTier = this.persistState.generalAddons.upgradeCostReduction;
    if (ucrTier !== null && ucrTier !== undefined) {
      const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
      return Math.floor(rawCost * (1 - reduction));
    }
    return rawCost;
  }

  private upgradeBase(): void {
    const defense = this.baseDefense;
    if (!defense) return;
    const check = defense.canUpgrade(maxLevelForBase(this.persistState));
    if (!check.ok) return;
    const cost = this.reducedUpgradeCost(check.cost);
    if (this.runState.gold < cost) return;
    setGold(this.runState, this.runState.gold - cost);
    defense.doUpgrade(cost);
  }

  baseDefenseSnapshot(): BaseDefenseSnapshot | undefined {
    const defense = this.baseDefense;
    if (!defense) return undefined;
    const maxLevel = maxLevelForBase(this.persistState);
    const check = defense.canUpgrade(maxLevel);
    const upgradeCost = check.ok ? this.reducedUpgradeCost(check.cost) : 0;
    const paid = defense.lastPaidCost();
    const sellActive = this.persistState.generalAddons?.sellActive;
    let downgradeRefund = 0;
    if (defense.level > 1) {
      if (sellActive === "refund") downgradeRefund = paid;
      else if (sellActive !== "discount") downgradeRefund = Math.round(paid * SELL_VALUE_RATIO);
    }
    const shortGun = defense.shortGun();
    const longGun = defense.longGun();
    return {
      level: defense.level,
      maxLevel,
      targeting: defense.targeting,
      totalDamageDealt: defense.totalDamageDealt,
      waveDamage: defense.waveDamage,
      previousWaveDamage: defense.previousWaveDamage,
      upgradeCost,
      nextLevel: check.ok ? defense.level + 1 : defense.level,
      canUpgrade: check.ok,
      blockedReason: check.reason,
      downgradeRefund,
      shortStats: shortGun ? { range: shortGun.range, damage: shortGun.damage, fireRate: shortGun.fireRate } : null,
      longStats: longGun ? { range: longGun.range, damage: longGun.damage, fireRate: longGun.fireRate } : null,
      sentries: defense.sentries.map((sentry) => ({
        x: sentry.x,
        y: sentry.y,
        angle: sentry.angle,
        tileX: sentry.tileX,
        tileY: sentry.tileY,
        fireAnimTime: sentry.fireAnimTime,
      })),
    };
  }

  private downgradeBase(): void {
    const defense = this.baseDefense;
    if (!defense || defense.level <= 1) return;
    const paid = defense.downgrade();
    const sellActive = this.persistState.generalAddons?.sellActive;
    let refund = 0;
    if (sellActive === "refund") refund = paid;
    else if (sellActive !== "discount") refund = Math.round(paid * SELL_VALUE_RATIO);
    if (refund > 0) setGold(this.runState, this.runState.gold + refund);
  }

  upgradeSelected(): void {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) {
      this.upgradeBase();
      return;
    }
    const tower = this.getSelectedTower();
    if (!tower) return;

    const check = tower.canUpgrade(this.persistState);
    if (check.needVariant) {
      // The tower is at the specialization gate (level 4, no variant). If only
      // one specialization is unlocked, auto-pick it so a single upgrade action
      // (in-tile button click or the w/u keys) specializes directly instead of
      // doing nothing. When both (or neither) are unlocked the choice is
      // ambiguous, so we no-op and rely on the explicit specialize path.
      const unlocked = this.persistState.unlocked[tower.type];
      if (unlocked) {
        const aUnlocked = !!unlocked.variantA[0];
        const bUnlocked = !!unlocked.variantB[0];
        if (aUnlocked && !bUnlocked) {
          this.specializeSelected("A");
        } else if (bUnlocked && !aUnlocked) {
          this.specializeSelected("B");
        }
      }
      return;
    }
    if (!check.ok) return;

    const cost = this.getUpgradeCost(tower);
    if (this.runState.gold < cost) return;
    setGold(this.runState, this.runState.gold - cost);
    tower.doUpgrade(this.persistState, cost);
  }

  specializeSelected(variant: string): void {
    const tower = this.getSelectedTower();
    if (!tower) return;

    const lv5Cost = tower.upgradeCost(5);
    const ucrTier = this.persistState.generalAddons.upgradeCostReduction;
    let cost = lv5Cost;
    if (ucrTier !== null && ucrTier !== undefined) {
      const reduction = UPGRADE_COST_REDUCTION_PCT[ucrTier] || 0;
      cost = Math.floor(cost * (1 - reduction));
    }
    if (this.runState.gold < cost) return;

    // Only deduct the cost if the specialization actually applied. Tower.specialize
    // can no-op (e.g. the variant is not unlocked in the worker's persistState),
    // and deducting unconditionally would silently lose gold with no effect.
    const applied = tower.specialize(variant as "A" | "B", this.persistState, cost);
    if (applied) setGold(this.runState, this.runState.gold - cost);
  }

  // Merges the main-thread-owned persist slices (unlocked + generalAddons) into
  // the worker's persistState, and applies the skill-tree gem delta to that same
  // copy. Returns true so the worker posts a fresh snapshot.
  syncPersist(
    unlocked: PersistState["unlocked"],
    generalAddons: PersistState["generalAddons"],
    gemDelta = 0,
    baseUnlocks?: PersistState["baseUnlocks"],
  ): boolean {
    if (unlocked) this.persistState.unlocked = unlocked;
    if (generalAddons) this.persistState.generalAddons = generalAddons;
    // baseUnlocks is main-thread-owned. Copying it here raises the live gold cap
    // after a mid-run gem purchase; omitting it leaves the worker copy unchanged.
    if (baseUnlocks) this.persistState.baseUnlocks = baseUnlocks;
    if (gemDelta !== 0) {
      this.persistState.gems += gemDelta;
      // This copy is what the next persist flush writes over persistStore.gems.
      // Leave it dirty so a spend with no other reward event is still saved,
      // instead of a later flush restoring the pre-purchase total.
      this.persistDirty = true;
    }
    return true;
  }

  // Debug-injection entry point for the DebugPanel. The debug buttons previously
  // wrote directly to the main-thread mirror stores, which the worker snapshot
  // overwrites every frame — so they did nothing. Routing them here mutates the
  // authoritative worker state instead. amount is optional (defaults applied per
  // kind) to keep the command payload small.
  debug(kind: DebugKind, amount?: number): void {
    switch (kind) {
      case "addGold": {
        const delta = amount ?? 0;
        if (!Number.isFinite(delta) || delta < 0) {
          console.warn(`debug addGold rejected invalid amount ${amount}`);
          break;
        }
        setGold(this.runState, this.runState.gold + delta);
        break;
      }
      case "addBaseHealth": {
        const delta = amount ?? 0;
        if (!Number.isFinite(delta)) {
          console.warn(`debug addBaseHealth rejected invalid amount ${amount}`);
          break;
        }
        this.runState.baseHealth = Math.max(0, Math.min(this.maxBaseHealth, this.runState.baseHealth + delta));
        break;
      }
      case "addGems": {
        const delta = amount ?? 0;
        if (!Number.isFinite(delta) || delta < 0) {
          console.warn(`debug addGems rejected invalid amount ${amount}`);
          break;
        }
        this.persistState.gems += delta;
        this.persistDirty = true;
        break;
      }
      case "setWave": {
        const wave = amount ?? this.runState.currentWave;
        if (!Number.isFinite(wave) || !Number.isInteger(wave) || wave < 0) {
          console.warn(`debug setWave rejected invalid amount ${amount}`);
          break;
        }
        this.debugSetWave(wave);
        break;
      }
      case "setTimeScale": {
        if (this.progressivePlacementHold) break;
        const scale = amount ?? this.runState.timeScale;
        if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
          console.warn(`debug setTimeScale rejected invalid amount ${amount}`);
          break;
        }
        this.runState.timeScale = scale;
        break;
      }
      case "skipWave":
        this.skipWave();
        break;
      case "killAll":
        this.enemyManager?.clear();
        break;
      case "setDebugPhysics":
        this.debugPhysicsEnabled = (amount ?? 0) > 0;
        break;
    }
  }

  // Debug wave jump through the same milestone/best-wave/unlock path as a natural
  // clear, with the wave manager parked between waves so betweenWaves, countdown,
  // and spawn states stay consistent instead of only moving the counter.
  private debugSetWave(wave: number): void {
    this.releasePlacementHold();
    setWave(this.runState, wave);
    this.waveManager?.debugJumpToWave(wave);
    this.runState.waveCountdown =
      this.waveManager === null ? null : { remaining: Math.ceil(BETWEEN_WAVES_TIMER), nextWave: wave + 1 };
    this.refreshBossPreview();
    this.applyWaveProgressRewards(wave);
    // Only the destination wave holds. Missed intervals are not replayed, and wave 100 is victory.
    if (this.isProgressiveHoldWave(wave) && this.armPlacementHold("countdown")) this.runState.waveCountdown = null;
  }

  private skipWave(): void {
    const holdWasOpen = this.progressivePlacementHold;
    this.releasePlacementHold();
    if (holdWasOpen) setGameState(this.runState, GameState.PLAYING);
    this.waveManager?.startNextWave();
  }

  sellSelected(): void {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) return;
    const tower = this.getSelectedTower();
    if (!tower) return;

    if (this.persistState.generalAddons.sellActive === "discount") {
      return;
    }

    // When cancel is still available, always cancel (full refund) instead of
    // selling — no confirm dialog.
    if (tower.canCancel()) {
      this.executeCancel(tower);
      return;
    }

    const towerId = tower.id;
    const isRefund = this.persistState.generalAddons.sellActive === "refund";
    // Single credit formula shared with executeSellById: the dialog amount, the
    // worker-side recompute, and the credited amount all come from here.
    const creditAmount = this.sellCreditFor(tower);
    // The confirm result resolves worker-side (confirmResult → resolveConfirm). A
    // granted confirm records a one-shot grant that executeSellById consumes, so
    // the follow-up executeSell is authorized rather than trusted.
    void this.host
      .requestConfirm({ towerId, towerType: tower.type, towerLevel: tower.level, sellValue: creditAmount, isRefund })
      .then((confirmed) => {
        if (confirmed) this.sellConfirmGrants.add(towerId);
      });
  }

  // Canonical sell credit: refund mode returns total invested, otherwise the
  // discounted sell value. Used for the confirm dialog, the worker-side recompute,
  // and the actual credit so all three always agree.
  private sellCreditFor(tower: Tower): number {
    const isRefund = this.persistState.generalAddons?.sellActive === "refund";
    return isRefund ? tower.totalInvested : tower.sellValue();
  }

  executeSellById(towerId: string, precomputedCreditAmount?: number): boolean {
    const tower = this.towerManager?.getTowerById(towerId);
    if (!tower) return false;
    if (tower.isGhost) return false;

    if (this.persistState.generalAddons?.sellActive === "discount") return false;

    // Contract: every executeSell must follow a user-granted confirm for the same
    // tower (recorded by sellSelected). The main thread is not trusted to withhold
    // the command, so the worker enforces it. One-shot: consumed on every attempt
    // past this point, valid or not.
    if (!this.sellConfirmGrants.has(towerId)) {
      const message = `sell rejected for tower ${towerId}: no confirmed sell request`;
      this.host.notifyUi({ type: "showNotification", message });
      throw new Error(message);
    }
    this.sellConfirmGrants.delete(towerId);

    // Reject-and-log on mismatch: the worker-side recompute is authoritative and
    // is the only value ever credited, so a forged precomputed amount grants nothing.
    const expectedCredit = this.sellCreditFor(tower);
    if (precomputedCreditAmount !== undefined && precomputedCreditAmount !== expectedCredit) {
      const message =
        `sell rejected for tower ${towerId}: credit mismatch ` +
        `(command ${precomputedCreditAmount} vs worker ${expectedCredit})`;
      this.host.notifyUi({ type: "showNotification", message });
      throw new Error(message);
    }
    this.towerManager!.sell(tower, this.persistState);
    this.host.syncGridTower(tower.tileX, tower.tileY, false);
    setGold(this.runState, this.runState.gold + expectedCredit);
    this.runState.selectedTowerId = null;
    this.persistDirty = true;
    return true;
  }

  selectTowerById(towerId: string | null): void {
    if (!towerId) {
      this.runState.selectedTowerId = null;
      return;
    }
    if (towerId === BASE_SELECTION_ID) {
      this.runState.selectedTowerType = null;
      this.runState.selectedTowerId = BASE_SELECTION_ID;
      return;
    }
    const tower = this.towerManager?.getTowerById(towerId);
    if (tower) {
      this.runState.selectedTowerId = towerId;
    }
  }

  executeSell(): boolean {
    if (!this.runState.selectedTowerId) return false;
    return this.executeSellById(this.runState.selectedTowerId);
  }

  cancelSelected(): void {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) return;
    const tower = this.getSelectedTower();
    if (!tower) return;
    if (this.persistState.generalAddons.sellActive === "discount") return;

    if (!tower.canCancel()) return;

    this.executeCancel(tower);
  }

  executeCancel(tower: Tower): void {
    const refund = tower.totalInvested;
    this.towerManager!.cancelBuild(tower);
    this.host.syncGridTower(tower.tileX, tower.tileY, false);
    setGold(this.runState, this.runState.gold + refund);
    this.runState.selectedTowerId = null;
    this.persistDirty = true;
  }

  downgradeSelected(): void {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) {
      this.downgradeBase();
      return;
    }
    const tower = this.getSelectedTower();
    if (!tower) return;
    if (tower.level <= 1) return;
    this.executeDowngrade();
  }

  executeDowngrade(): void {
    const tower = this.getSelectedTower();
    if (tower === null) return;
    if (tower.isGhost) return;

    const delta = this.towerManager!.downgradeTower(tower);
    const sellActive = this.persistState.generalAddons?.sellActive;
    // Discount mode: no cash-out on downgrade (mirrors "can't sell"); still level down.
    let refund = 0;
    if (sellActive === "refund") {
      refund = delta;
    } else if (sellActive !== "discount") {
      refund = Math.round(delta * SELL_VALUE_RATIO);
    }

    if (refund > 0) setGold(this.runState, this.runState.gold + refund);
  }

  setTargeting(mode: string): void {
    if (this.runState.selectedTowerId === BASE_SELECTION_ID) {
      this.baseDefense?.setTargeting(mode);
      return;
    }
    const tower = this.getSelectedTower();
    if (tower) {
      tower.targeting = mode;
      tower.cachedTargetId = null;
    }
  }

  setFixedAimDir(dir: "N" | "E" | "S" | "W" | null): void {
    const tower = this.getSelectedTower();
    if (tower) {
      tower.fixedAimDir = dir;
      tower.cachedTargetId = null;
    }
  }

  togglePause(): void {
    if (this.progressivePlacementHold) return;
    if (this.runState.bonusPicker) return;
    togglePauseState(this.runState);
    if (this.runState.state === GameState.PLAYING) this.applyPendingProgressiveResume();
  }

  cycleSpeed(): number {
    if (this.progressivePlacementHold) return this.runState.timeScale;
    return cycleTimeScale(this.runState, 1);
  }

  cycleSpeedReverse(): number {
    if (this.progressivePlacementHold) return this.runState.timeScale;
    return cycleTimeScale(this.runState, -1);
  }

  stop(): void {
    setGameState(this.runState, GameState.MENU);
  }

  dispose(): void {
    this.stop();
    this.crowdManager?.destroy();
    this.crowdManager = null;
    this.navMeshBuilder?.destroy();
    this.navMeshBuilder = null;
    this.forceFieldSystem.clear();
    this.contactProcessor?.clear();
    this.contactProcessor = null;
    this.navDistanceField = null;
    this.flightDistanceField = null;
    if (this.physicsWorld) {
      this.physicsWorld.dispose();
      this.physicsWorld = null;
    }
    this.waveGraphTracker?.dispose();
  }

  cancelBuildMode(): void {
    if (this.runState.selectedTowerType) {
      this.runState.selectedTowerType = null;
      setHoverTile(this.runState, null);
    }
  }

  placeProgressiveBlock(templateIndex: number, rotation: number, blockX: number, blockY: number): boolean {
    if (!this.progressivePlacementHold) return false;
    if (!this.progressiveOffer.includes(templateIndex)) return false;
    const board = this.progressiveBoard;
    const catalog = this.progressiveCatalog;
    const rng = this.progressiveRng;
    const config = progressiveConfigFromMap(this.runState.map);
    const grid = this.grid;
    const previousMap = this.runState.map;
    if (
      !board ||
      !catalog ||
      !rng ||
      !config ||
      !grid ||
      !previousMap ||
      !this.waveManager ||
      !this.enemyManager ||
      !this.towerManager ||
      !this.physicsWorld
    ) {
      return false;
    }
    const stamped = boardWithPlayerStamp(board, catalog, templateIndex, rotation, blockX, blockY);
    if (!stamped) return false;
    const probeMap = boardToGeneratedMap(config, stamped, catalog);
    const probe = probeWalkMesh(new Grid(probeMap));
    if (!probe.ok) return this.refuseWalkMesh(probe.error);

    const committed = commitPlacement(board, catalog, templateIndex, rotation, blockX, blockY, rng);
    if (!committed) return false;
    const nextMap = boardToGeneratedMap(config, committed.board, catalog);
    const stampCount = this.progressivePlacements.length;
    const capturedLayout = grid.captureLayout();
    this.progressiveBoard = committed.board;
    for (const block of committed.added) {
      this.progressivePlacements.push({
        templateIndex: block.templateIndex,
        rotation: block.rotation,
        blockX: block.blockX,
        blockY: block.blockY,
        fill: block.fill,
      });
    }
    const previousSpawns = previousMap.spawns;
    this.runState.map = nextMap;
    const previousWorldKeys = collectWorldKeys(grid);
    const shift = grid.replaceFromMap(nextMap);
    const keeper = new NavMeshBuilder(grid);
    if (!keeper.isSuccess() || !keeper.getNavMesh()) {
      const buildError = keeper.getError() ?? "unknown navmesh error";
      keeper.destroy();
      grid.restoreLayout(capturedLayout);
      this.progressiveBoard = board;
      this.progressivePlacements.length = stampCount;
      this.runState.map = previousMap;
      return this.refuseWalkMesh(buildError);
    }
    this.towerManager.shiftLayoutIndices(shift.shiftX, shift.shiftY);
    this.enemyManager.shiftLayoutIndices(shift.shiftX, shift.shiftY);
    this.sites.shift(shift.shiftX, shift.shiftY);
    const playerBlock = committed.added.find((block) => !block.fill);
    const stampWorldKeys = playerBlock ? this.playerStampKeys(playerBlock.blockX, playerBlock.blockY) : null;
    this.adoptLayoutSites(previousWorldKeys, playerPlacedBlockCount(this.progressivePlacements), stampWorldKeys);
    this.enemyManager.reindexSpawns(previousSpawns, nextMap.spawns);
    this.waveManager.map = nextMap;
    this.waveManager.resizeSpawnStatesById(previousSpawns, nextMap.spawns);
    invalidateNearestWalkableCache(grid);
    // Corridor and crowd swap run only after the keeper mesh exists. A failed
    // build restored the grid above and must not replace the live corridor.
    this.installWalkMesh(keeper);
    this.layoutGeneration += 1;
    this.gridLayoutCache = null;
    this.gridHeightsCache = null;
    // The commander feed turns off after the first layout. A stamp has to ship
    // the new rectangle, so the feed is armed again until the worker caches it.
    this.gridLayoutEnabled = true;
    this.completeProgressivePlacement(stampCount);
    return true;
  }

  // Host toast only. The board, stamp log, and hold stay as they were, so the
  // main thread still shows the pre-place sites and the player can pick another.
  private refuseWalkMesh(buildError: string): false {
    console.error("Navmesh build failed:", buildError);
    this.host.notifyUi({
      type: "showNotification",
      message: "That block cannot be placed. The walk mesh failed to build.",
    });
    return false;
  }

  private isProgressiveHoldWave(wave: number): boolean {
    if (this.runState.map?.style !== "progressive") return false;
    const placementInterval = this.theme?.maps?.progressive.placementInterval ?? PROGRESSIVE_PLACEMENT_INTERVAL;
    return wave % placementInterval === 0 && wave > 0 && wave < VICTORY_WAVE;
  }

  private progressiveChoiceCount(): number {
    return this.persistState.generalAddons.progressiveThirdChoice !== null ? 3 : 2;
  }

  private armPlacementHold(mode: "countdown" | "expire-advance"): boolean {
    if (!this.progressiveBoard || !this.progressiveCatalog || !this.progressiveRng) return false;
    const offer = drawBlockOffer(
      this.progressiveBoard,
      this.progressiveCatalog,
      this.progressiveChoiceCount(),
      this.progressiveRng,
    );
    if (offer.length === 0) return false;
    this.openPlacementHold(offer, mode);
    return true;
  }

  private openPlacementHold(offer: number[], mode: "countdown" | "expire-advance"): void {
    this.progressiveOffer = offer;
    this.progressivePlacementHold = true;
    this.progressiveResumeMode = mode;
    this.progressivePlacementUndo = null;
    if (this.waveManager) {
      this.waveManager.advanceHeld = true;
      this.waveManager.betweenWaves = true;
      this.waveManager.countdownActive = false;
      this.waveManager.active = false;
    }
    this.runState.selectedTowerType = null;
    this.runState.selectedTowerId = null;
    setGameState(this.runState, GameState.PAUSED);
    this.runState.waveCountdown = null;
    this.nextBossAbilityNames = [];
  }

  rerollProgressiveOffer(): boolean {
    if (!this.progressivePlacementHold) return false;
    const board = this.progressiveBoard;
    const catalog = this.progressiveCatalog;
    const rng = this.progressiveRng;
    if (!board || !catalog || !rng) return false;
    const cost = progressiveRerollGoldPerWave(this.theme?.maps) * this.runState.currentWave;
    if (this.runState.gold < cost) {
      this.host.notifyUi({ type: "showNotification", message: "Not enough gold to re-roll." });
      return false;
    }
    if (!offerHasAlternative(board, catalog, this.progressiveChoiceCount(), this.progressiveOffer)) {
      this.host.notifyUi({ type: "showNotification", message: "No other block choices." });
      return false;
    }
    setGold(this.runState, this.runState.gold - cost);
    this.progressiveOffer = drawBlockOffer(board, catalog, this.progressiveChoiceCount(), rng);
    return true;
  }

  private releasePlacementHold(): void {
    this.progressivePlacementHold = false;
    this.progressiveResumeMode = null;
    this.progressiveOffer = [];
    this.progressivePlacementUndo = null;
    if (this.waveManager) this.waveManager.advanceHeld = false;
    // The hold refused the open that queued a broken cache; retry now that the
    // hold no longer owns the UI.
    this.drainPendingBrokenCaches();
  }

  // Placement succeeded: close the offer UI and stash the undo record. The run
  // stays paused and progressiveResumeMode stays pending, so the countdown or the
  // expiry wave launch only runs when togglePause resumes the clock — which also
  // closes the undo window.
  private completeProgressivePlacement(stampCount: number): void {
    this.progressivePlacementUndo = { stampCount, offer: [...this.progressiveOffer] };
    this.progressivePlacementHold = false;
    this.progressiveOffer = [];
  }

  // The only path that applies a pending resume, reached from togglePause so every
  // player-facing unpause (HUD button, Space, dialog closes) runs it exactly once.
  private applyPendingProgressiveResume(): void {
    const mode = this.progressiveResumeMode;
    this.progressiveResumeMode = null;
    this.progressivePlacementUndo = null;
    if (mode === null || !this.waveManager) return;
    this.waveManager.advanceHeld = false;
    if (mode === "expire-advance") {
      this.waveManager.startNextWave();
      this.onWaveStart(this.waveManager.currentWave);
      return;
    }
    this.waveManager.betweenWaves = true;
    this.waveManager.countdownActive = true;
    this.waveManager.countdownTimer = BETWEEN_WAVES_TIMER;
    this.waveManager.betweenTimer = BETWEEN_WAVES_TIMER;
    this.waveManager.active = false;
    this.runState.waveCountdown = {
      remaining: Math.ceil(BETWEEN_WAVES_TIMER),
      nextWave: this.waveManager.currentWave + 1,
    };
    this.refreshBossPreview();
  }

  // Reverts the last placement inside the paused undo window: truncate the stamp
  // log to the stash, replay it into a board, and run the placement tail in
  // reverse (grid swap, keeper navmesh, index re-keys, corridor/crowd install),
  // then re-open the same hold so the player can pick again.
  undoProgressivePlacement(): boolean {
    const undo = this.progressivePlacementUndo;
    const config = progressiveConfigFromMap(this.runState.map);
    const grid = this.grid;
    const previousMap = this.runState.map;
    if (
      !undo ||
      this.progressivePlacementHold ||
      this.runState.state !== GameState.PAUSED ||
      this.progressiveResumeMode === null ||
      !config ||
      !grid ||
      !previousMap ||
      !this.waveManager ||
      !this.enemyManager ||
      !this.towerManager ||
      !this.physicsWorld
    ) {
      return false;
    }
    const resumeMode = this.progressiveResumeMode;
    const replayed = replayProgressiveBoard(config, this.progressivePlacements.slice(0, undo.stampCount));
    const nextMap = boardToGeneratedMap(config, replayed.board, replayed.catalog);
    const previousLength = this.progressivePlacements.length;
    const previousBoard = this.progressiveBoard;
    const capturedLayout = grid.captureLayout();
    this.progressivePlacements.length = undo.stampCount;
    this.progressiveBoard = replayed.board;
    this.runState.map = nextMap;
    const previousSpawns = previousMap.spawns;
    const previousWorldKeys = collectWorldKeys(grid);
    const shift = grid.replaceFromMap(nextMap);
    const keeper = new NavMeshBuilder(grid);
    if (!keeper.isSuccess() || !keeper.getNavMesh()) {
      const buildError = keeper.getError() ?? "unknown navmesh error";
      keeper.destroy();
      grid.restoreLayout(capturedLayout);
      this.progressiveBoard = previousBoard;
      this.progressivePlacements.length = previousLength;
      this.runState.map = previousMap;
      return this.refuseUndo(buildError);
    }
    this.towerManager.shiftLayoutIndices(shift.shiftX, shift.shiftY);
    this.enemyManager.shiftLayoutIndices(shift.shiftX, shift.shiftY);
    this.sites.shift(shift.shiftX, shift.shiftY);
    this.adoptLayoutSites(previousWorldKeys);
    this.enemyManager.reindexSpawns(previousSpawns, nextMap.spawns);
    this.waveManager.map = nextMap;
    this.waveManager.resizeSpawnStatesById(previousSpawns, nextMap.spawns);
    invalidateNearestWalkableCache(grid);
    this.installWalkMesh(keeper);
    this.layoutGeneration += 1;
    this.gridLayoutCache = null;
    this.gridHeightsCache = null;
    this.gridLayoutEnabled = true;
    this.openPlacementHold(undo.offer, resumeMode);
    return true;
  }

  private refuseUndo(buildError: string): false {
    console.error("Navmesh build failed:", buildError);
    this.host.notifyUi({
      type: "showNotification",
      message: "That placement cannot be undone. The walk mesh failed to build.",
    });
    return false;
  }

  private installWalkMesh(builder: NavMeshBuilder): void {
    const grid = this.grid;
    const enemyManager = this.enemyManager;
    const towerManager = this.towerManager;
    const physicsWorld = this.physicsWorld;
    const navMesh = builder.getNavMesh();
    if (!grid || !enemyManager || !towerManager || !physicsWorld || !navMesh) {
      builder.destroy();
      return;
    }
    physicsWorld.rebuildCorridor();
    for (const enemy of enemyManager.enemies) enemy.agent = null;
    this.crowdManager?.destroy();
    this.navMeshBuilder?.destroy();
    this.navMeshBuilder = builder;
    this.crowdManager = new CrowdManager(navMesh, grid.tileSize, GAMEPLAY_ENEMY_CAP);
    this.crowdManager.setForceFieldSystem(this.forceFieldSystem);
    enemyManager.setCrowdManager(this.crowdManager);
    const base = grid.getBase();
    const baseWorld = grid.tileToWorld(base.x, base.y);
    for (const enemy of enemyManager.enemies) {
      if (enemy.removed || enemy.flyingHeight > 0) {
        enemy.clearFlightPolyline();
        continue;
      }
      this.crowdManager.addAgent(enemy);
    }
    this.crowdManager.reissueMoveTargets(enemyManager.enemies);
    for (const enemy of enemyManager.enemies) {
      if (enemy.removed || enemy.flyingHeight > 0 || !enemy.agent || enemy.lastMoveTargetWorld) continue;
      this.crowdManager.setBaseTarget(enemy, baseWorld);
    }
    physicsWorld.rebuildTowers(towerManager);
    this.navMeshBuilder.syncTowers(towerManager.towers);
    this.navDistanceField?.setNavMeshBuilder(this.navMeshBuilder);
    this.navDistanceField?.ensureUpToDate(true);
    this.flightDistanceField?.ensureUpToDate(this.liveTowerAt, grid.pathVersion);
    this.lastPathVersion = grid.pathVersion;
    separateEnemiesFromTowers(enemyManager.enemies, towerManager.towers, grid, this.crowdManager);
  }

  private onEnemySpawned(enemy: Enemy): void {
    if (enemy.type !== "boss" || !this.grid) return;
    this.runState.bossesSpawned += 1;
    configureBossAbility(enemy, enemy.bossAbility, this.grid.tileSize);
    if (enemy.bossAbility !== "healAura") return;
    enemy.mendSuppresses = (source, ally) => nearerMendBlocksIn(this.mendSources, source, ally);
  }

  private stampBossAbilities(entries: readonly WaveEntry[], waveNumber: number): void {
    const map = this.runState.map;
    if (!map) return;
    const unstamped = entries.filter((entry) => entry.type === "boss" && entry.bossAbility === undefined);
    if (unstamped.length === 0) return;
    const vanillaFirst = this.runState.bossesSpawned === 0;
    const abilities = rollBossAbilities(map.seed, waveNumber, unstamped.length, vanillaFirst);
    for (let index = 0; index < unstamped.length; index++) {
      const ability = abilities[index];
      if (ability !== undefined) unstamped[index]!.bossAbility = ability;
    }
  }

  private refreshBossPreview(): void {
    const manager = this.waveManager;
    const map = this.runState.map;
    if (!manager || !map || !manager.countdownActive) {
      if (this.nextBossAbilityNames.length > 0) this.nextBossAbilityNames = [];
      return;
    }
    const nextWave = manager.currentWave + 1;
    const count = waveBossCount(nextWave, map.bossCadence);
    if (count === 0) {
      if (this.nextBossAbilityNames.length > 0) this.nextBossAbilityNames = [];
      return;
    }
    const vanillaFirst = this.runState.bossesSpawned === 0;
    const abilities = rollBossAbilities(map.seed, nextWave, count, vanillaFirst);
    const names = abilities.map((ability) => bossAbilityLabel(ability));
    if (names.join("|") !== this.nextBossAbilityNames.join("|")) this.nextBossAbilityNames = names;
  }

  private tickBossCombat(dt: number): void {
    const enemyManager = this.enemyManager;
    const grid = this.grid;
    if (!enemyManager || !this.towerManager || !grid) return;
    this.bossAbilityRuntime.tick(enemyManager.enemies, dt, grid.tileSize);
  }

  private bossShotTargets(): readonly BossShotTarget[] {
    return (this.towerManager?.towers ?? []).map((tower) => ({
      id: String(tower.id),
      x: tower.x,
      y: tower.y,
      isGhost: tower.isGhost,
    }));
  }

  private spawnBossMinions(boss: Enemy): void {
    const enemyManager = this.enemyManager;
    const grid = this.grid;
    const map = this.runState.map;
    if (!enemyManager || !grid || !map) return;
    const waveNumber = this.waveManager?.currentWave ?? boss.wave;
    const count = minionPulseCount(waveNumber, enemyManager.enemies.length, GAMEPLAY_ENEMY_CAP);
    const level = enemyLevelForWave(waveNumber, map.level);
    for (let index = 0; index < count; index++) {
      if (enemyManager.enemies.length >= GAMEPLAY_ENEMY_CAP) break;
      const minion = enemyManager.spawn("minion", level, boss.spawnIndex, waveNumber);
      if (!minion) continue;
      minion.bounty = 0;
      minion.summoned = true;
      minion.body?.setTranslation({ x: boss.x, y: boss.y }, true);
      minion.x = boss.x;
      minion.y = boss.y;
      minion.centerX = boss.x;
      minion.centerY = boss.y;
      this.crowdManager?.teleportAgent(minion, { x: boss.x, y: boss.y });
    }
  }

  // Rebuilt into one reused buffer each tick: TowerManager reads the list only
  // during the update call, so this keeps the per-tick array off the hot path.
  private cacheShotTargets(): readonly { id: number; x: number; y: number }[] {
    const grid = this.grid;
    const targets = this.cacheShotTargetBuffer;
    if (!grid) {
      targets.length = 0;
      return targets;
    }
    let count = 0;
    for (const cache of this.mapCaches) {
      if (cache.hp <= 0) continue;
      const world = grid.tileToWorld(cache.tileX, cache.tileY);
      const existing = targets[count];
      if (existing) {
        existing.id = cache.id;
        existing.x = world.x;
        existing.y = world.y;
      } else {
        targets.push({ id: cache.id, x: world.x, y: world.y });
      }
      count += 1;
    }
    targets.length = count;
    return targets;
  }

  private damageCache(cacheId: number, amount: number): void {
    if (amount <= 0) return;
    const cache = this.mapCaches.find((site) => site.id === cacheId);
    if (!cache || cache.hp <= 0) return;
    cache.hp -= amount;
    if (cache.hp > 0) return;
    // A broken cache keeps its tile, its offer, and its reservation. Shot targets
    // skip hp<=0 so towers stop firing it, and the free card claim below is what
    // finally removes it.
    cache.hp = 0;
    // Breaking it open is the damage unlock path: the cards become free to claim.
    cache.unlocked = true;
    this.host.notifyUi({
      type: "showNotification",
      message: "A cache was broken open. Click it to claim a card for free.",
    });
    this.pendingBrokenCaches.push({
      id: cacheId,
      wasPlaying: this.runState.bonusPicker?.wasPlaying ?? this.runState.state === GameState.PLAYING,
    });
    this.drainPendingBrokenCaches();
  }

  // Opens the next broken cache whose site still exists. Entries stay queued until
  // one actually opens, so a placement hold that refuses the open cannot lose it.
  private drainPendingBrokenCaches(): boolean {
    if (this.runState.bonusPicker) return false;
    while (this.pendingBrokenCaches.length > 0) {
      const next = this.pendingBrokenCaches[0]!;
      const cache = this.mapCaches.find((site) => site.id === next.id);
      if (!cache) {
        this.pendingBrokenCaches.shift();
        continue;
      }
      if (!this.openBonusPicker("cache", cache.id, next.wasPlaying)) return false;
      this.pendingBrokenCaches.shift();
      return true;
    }
    return false;
  }

  private playerStampKeys(blockX: number, blockY: number): Set<string> {
    return this.grid ? stampWorldKeysForBlock(this.grid, blockX, blockY) : new Set();
  }

  // Resolves everything the picker needs from the site itself: the curated offer,
  // the specialist type the typed cards promise, and the pause ownership. Resolving
  // here (not at click time) is what keeps a dismiss and reopen on the same roll.
  private openBonusPicker(
    source: "drop" | "cache",
    id: number,
    wasPlaying = this.runState.state === GameState.PLAYING,
  ): boolean {
    if (this.runState.bonusPicker || this.progressivePlacementHold) return false;
    const map = this.runState.map;
    if (!map) return false;
    const site =
      source === "drop"
        ? this.supplyDrops.find((drop) => drop.id === id)
        : this.mapCaches.find((cache) => cache.id === id);
    if (!site) return false;
    if (site.specialistType === undefined) {
      site.specialistType = rollSpecialistType(map.seed, id, this.specialistWeights());
    }
    const curated = curateBonusOffer(site.offer, { canApplySlow: this.canApplySlow() }, map.seed, id);
    if (curated !== site.offer) site.offer = curated;
    this.runState.bonusPicker = { source, id, offer: site.offer, wasPlaying, specialistType: site.specialistType };
    if (wasPlaying) setGameState(this.runState, GameState.PAUSED);
    return true;
  }

  private specialistWeights(): Partial<Record<TowerId, number>> {
    const weights: Partial<Record<TowerId, number>> = {};
    for (const tower of this.towerManager?.towers ?? []) {
      if (tower.isGhost) continue;
      const towerId = tower.type as TowerId;
      weights[towerId] = (weights[towerId] ?? 0) + 1;
    }
    return weights;
  }

  private canApplySlow(): boolean {
    return (this.towerManager?.towers ?? []).some(
      (tower) => !tower.isGhost && (tower.stats.slowAmt > 0 || tower.stats.frostAura),
    );
  }

  // The wave-scaled fee an intact, still-locked cache wants. Zero after either
  // unlock path: the gold fee is paid up front by unlockCache, and breaking the
  // cache open with tower fire is free by definition.
  private cacheOpenCost(cacheId: number): number | null {
    const cache = this.mapCaches.find((site) => site.id === cacheId);
    if (!cache) return null;
    if (cache.unlocked || cache.hp <= 0) return 0;
    return cacheOpenGold(this.runState.currentWave);
  }

  // Pays the fee and flips the site to unlocked, which is what lets the picker
  // show its cards. The unlocked flag makes the charge one-shot: a dismiss after
  // paying leaves the cache claimable for free on reopen.
  unlockCache(): boolean {
    const picker = this.runState.bonusPicker;
    if (picker?.source !== "cache") return false;
    const cost = this.cacheOpenCost(picker.id);
    if (cost === null) {
      this.closeBonusPicker(true);
      return false;
    }
    if (cost === 0) return false;
    if (this.runState.gold < cost) {
      this.host.notifyUi({ type: "showNotification", message: `${cost} gold is required to open a cache.` });
      return false;
    }
    setGold(this.runState, this.runState.gold - cost);
    const cache = this.mapCaches.find((site) => site.id === picker.id);
    if (cache) cache.unlocked = true;
    return true;
  }

  pickBonus(index: number): boolean {
    const picker = this.runState.bonusPicker;
    if (!picker || !Number.isInteger(index) || index < 0 || index > 2) return false;
    const bonusId = picker.offer[index];
    if (!bonusId) return false;
    if (picker.source === "cache") {
      const cache = this.mapCaches.find((site) => site.id === picker.id);
      if (!cache) {
        this.closeBonusPicker(true);
        return false;
      }
      // Cards are gated behind the unlock, and its fee was already charged there.
      if (!cache.unlocked) return false;
    }
    const context = { wave: this.runState.currentWave, specialistType: picker.specialistType };
    this.applyBonus(describeBonus(bonusId, context));
    this.sites.consume(this.grid, picker.source, picker.id);
    this.closeBonusPicker(true);
    return true;
  }

  dismissBonus(): boolean {
    if (!this.runState.bonusPicker) return false;
    this.closeBonusPicker(true);
    return true;
  }

  private closeBonusPicker(resume: boolean): void {
    const picker = this.runState.bonusPicker;
    if (!picker) return;
    this.runState.bonusPicker = null;
    // The next broken cache inherits the pause this one held, so the chain of
    // simultaneous breaks resumes exactly once at the end.
    if (this.drainPendingBrokenCaches()) return;
    if (resume && picker.wasPlaying && this.runState.state === GameState.PAUSED) {
      setGameState(this.runState, GameState.PLAYING);
    }
  }

  private applyBonus(application: BonusApplication): void {
    if (application.kind === "gold") {
      this.earnGold(application.amount);
      return;
    }
    if (application.kind === "mult") {
      this.runState.runBonuses[application.field] *= application.factor;
      this.refreshAllTowerBonuses();
      return;
    }
    if (application.kind === "typedMult") {
      const record = this.runState.runBonuses[application.field];
      record[application.towerType] = (record[application.towerType] ?? 1) * application.factor;
      this.refreshAllTowerBonuses();
      return;
    }
    this.repairField(application.fraction);
  }

  private repairField(fraction: number): void {
    const maxHealth = this.runState.maxBaseHealth;
    const before = this.runState.baseHealth;
    this.runState.baseHealth = Math.min(maxHealth, before + maxHealth * fraction);
    this.totalHealingReceived += this.runState.baseHealth - before;
    for (const tower of this.towerManager?.towers ?? []) {
      if (tower.isGhost) continue;
      tower.health = Math.min(tower.maxHealth, tower.health + tower.maxHealth * fraction);
    }
  }

  // Recomputes max health only when the multiplied value changes, so an unchanged
  // tower does not drift its current HP through a ratio round-trip.
  private refreshAllTowerBonuses(): void {
    const bonuses = this.runState.runBonuses;
    const defense = this.baseDefense;
    if (defense && defense.runHealthMult !== bonuses.healthMult) {
      defense.runHealthMult = bonuses.healthMult;
      defense.recomputeMaxHealth();
    }
    const towers = this.towerManager?.towers;
    if (!towers) return;
    for (const tower of towers) {
      const towerId = tower.type as TowerId;
      // The typed record folds into the run factor so every downstream consumer
      // (_statsKey, max health, the tower bonus line) keeps reading one number.
      // The base defense keeps the untyped health factor: it is not a tower.
      tower.runDamageMult = bonuses.damageMult * (bonuses.typeDamageMult[towerId] ?? 1);
      tower.runFireRateMult = bonuses.fireRateMult * (bonuses.typeFireRateMult[towerId] ?? 1);
      tower.runHealthMult = bonuses.healthMult * (bonuses.typeHealthMult[towerId] ?? 1);
      tower.runRangeMult = bonuses.rangeMult * (bonuses.typeRangeMult[towerId] ?? 1);
      tower.runSlowMult = bonuses.slowMult;
      tower.incomingDamageMult = bonuses.armorMult;
      const site = neighborBonus(tower.tileX, tower.tileY, this.mapBuildings);
      tower.siteDamageMult = site.damageMult;
      tower.siteFireRateMult = site.fireRateMult;
      tower.siteHealthMult = site.healthMult;
      tower.siteRangeMult = site.rangeMult;
      const previousMax = tower.maxHealth;
      tower.clearStatsCache();
      if (tower.computeMaxHealth() !== previousMax) tower.recomputeMaxHealth();
    }
  }

  private syncMapSites(
    previousWorldKeys: ReadonlySet<string> | null,
    placedBlocks = 0,
    stampWorldKeys: ReadonlySet<string> | null = null,
  ): void {
    // The manager reconciles sites and reservations; only a real reconcile can
    // move a site under a tower, so the bonus refresh runs only then.
    const synced = this.sites.syncMapSites(
      this.grid,
      this.runState.map,
      previousWorldKeys,
      placedBlocks,
      stampWorldKeys,
    );
    if (synced) this.refreshAllTowerBonuses();
  }

  private adoptLayoutSites(
    previousWorldKeys: ReadonlySet<string>,
    placedBlocks = 0,
    stampWorldKeys: ReadonlySet<string> | null = null,
  ): void {
    const grid = this.grid;
    if (!grid) return;
    this.sites.snapDropsToPath(grid);
    this.syncMapSites(previousWorldKeys, placedBlocks, stampWorldKeys);
    const picker = this.runState.bonusPicker;
    if (!picker) return;
    if (this.sites.siteExists(picker.source, picker.id)) return;
    this.closeBonusPicker(false);
  }
}

class BaseTarget implements AttackTarget {
  private engine: GameEngine;
  readonly isGhost = false;
  constructor(engine: GameEngine) {
    this.engine = engine;
  }
  takeDamage(amount: number, _attacker?: Enemy): void {
    this.engine.damageBase(amount * this.engine.runState.runBonuses.armorMult);
  }
  get centerX(): number {
    const base = this.engine.grid?.getBase();
    return base ? this.engine.grid!.tileToWorld(base.x, base.y).x : 0;
  }
  get centerY(): number {
    const base = this.engine.grid?.getBase();
    return base ? this.engine.grid!.tileToWorld(base.x, base.y).y : 0;
  }
  get health(): number {
    return this.engine.runState.baseHealth;
  }
}
