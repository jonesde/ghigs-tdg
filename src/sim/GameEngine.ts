import type { MapThemeData, SpawnState } from "@/render/themes/index.js";
import type { DebugKind } from "@/sim/Command.js";
import { ICE_AURA_RANGE, STATIC_FIELD_RANGE } from "@/sim/ConstantsTower.js";
import type { AttackTarget, Enemy } from "@/sim/enemies/Enemy.js";
import { resetEnemyId } from "@/sim/enemies/Enemy.js";
import { EnemyManager } from "@/sim/enemies/EnemyManager.js";
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
import { forkRunSeed, generateRandomMap, getMap, mulberry32 } from "@/sim/grid/Map.js";
import type { HostBindings, ThemeBundle } from "@/sim/HostBindings.js";
import { CrowdManager, restoreCrowdAgentVelocity } from "@/sim/navmesh/CrowdManager.js";
import { toRecast } from "@/sim/navmesh/coords.js";
import { NavDistanceField } from "@/sim/navmesh/NavDistanceField.js";
import { NavMeshBuilder } from "@/sim/navmesh/NavMeshBuilder.js";
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
import type { Tower } from "@/sim/towers/Tower.js";
import { TowerManager } from "@/sim/towers/TowerManager.js";
import { WaveGraphTracker } from "@/sim/WaveGraphTracker.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import {
  BETWEEN_WAVES_TIMER,
  BONUS_GEM_BASE,
  DIFFICULTY_MULT_GEM_BASE,
  FIXED_DT,
  GAMEPLAY_ENEMY_CAP,
  GameState,
  MAP_GEM_MULTIPLIERS,
  MILESTONE_GEMS,
  MILESTONE_WAVES,
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
import { GHOST_PARTICLE_COUNT, GHOST_PARTICLE_DURATION, TOWER_META } from "./ConstantsTower.js";

interface WaveManagerRef {
  currentWave: number;
  betweenWaves: boolean;
  countdownActive: boolean;
  countdownTimer: number;
  baseReached: boolean;
  waveComposition: Record<string, number>;
  active: boolean;
  _waveGameTime: number;
  spawnStates: SpawnState[];
  update(
    dt: number,
    onWaveCleared: ((wave: number) => void) | null,
    onWaveStart: ((wave: number) => void) | null,
    onWaveExpired: ((wave: number) => void) | null,
  ): void;
  startNextWave(): void;
  debugJumpToWave(wave: number): void;
  getRemainingScheduledSpawns(): number;
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
  // Last grid.pathVersion we rebuilt tower/corridor colliders + nav field for.
  private lastPathVersion = -1;
  waveManager: WaveManagerRef | null;
  projectileManager: ProjectileManager | null;
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
  // Monotonic run identifier, bumped on every (re)load in _initMap. The commander
  // relay/worker key their gridLayout cache + one-shot feed-off toggle to it so a
  // stale layout from a previous run is never forwarded and the toggle re-arms on a
  // run restart (robust even for same-map replays, where mapIndex/layout are equal).
  runId: number = 0;
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
  }

  loadMap(mapIndex: number = this.mapIndex): void {
    const mapData = getMap(mapIndex);
    this._initMap(mapIndex, mapData, this.persistState);
  }

  loadRandomMap(width: number, height: number, level: number, style: string, regionId: number, seed: number): void {
    const mapData = generateRandomMap(width, height, style, regionId, level, seed);
    this._initMap(-1, mapData, this.persistState);
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
    this.projectileManager = new ProjectileManager(this.enemyManager, this.particleSpawner, null, this.grid);
    this.towerManager = new TowerManager(
      this.grid,
      this.particleSpawner,
      this.projectileManager,
      this.host,
      this.theme,
      this.themeBundle.defaultTowerVisuals,
    );
    this.projectileManager.setTowerLookup((towerId) => this.towerManager?.getTowerById(towerId) ?? null);
    // Fork the per-run combat-roll source from (map seed, runId) and hand it to
    // every sim roller, so the same run replays identically and distinct runs diverge.
    this.simRng = mulberry32(forkRunSeed(mapData.seed, this.runId));
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
    this.towerManager.setNavDistanceToBase(
      (tileX, tileY) => this.navDistanceField?.getDistanceToBase(tileX, tileY) ?? -1,
    );
    this.enemyManager.setBlockedApproachLookup(
      (tileX, tileY) => this.navDistanceField?.getBlockedApproach(tileX, tileY) ?? null,
    );
    this.enemyManager.setDistanceToBaseLookup(
      (tileX, tileY) => this.navDistanceField?.getDistanceToBase(tileX, tileY) ?? -1,
    );
    this.physicsWorld.rebuildTowers(this.towerManager);
    this.enemyManager.baseTarget = new BaseTarget(this);
    this.projectileManager.setOnGoldReward((amount) => {
      this.waveGraphTracker?.onGoldBounty(amount);
      this.earnGold(amount);
    });
    this.waveManager = new WaveManager(mapData, this.enemyManager);

    this.waveGraphTracker = new WaveGraphTracker(
      this.runState,
      this.persistState,
      this.towerManager!,
      this.enemyManager!,
    );

    this._applyStartingBonuses();

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
    if (ehTier !== null && ehTier !== undefined) {
      this.runState.baseHealth += STARTING_HEALTH_BONUS[ehTier] || 0;
    }

    this.maxBaseHealth = this.runState.baseHealth;
    this.runState.maxBaseHealth = this.runState.baseHealth;

    const sgTier = generalAddons.startingGold;
    if (sgTier !== null && sgTier !== undefined) {
      this.runState.gold += STARTING_GOLD_BONUS[sgTier] || 0;
    }
  }

  onBossKilled(): void {
    this.runState.bossesKilledThisRun++;

    const base = 1;
    const diffMult = getDifficultyMultiplier(this.persistState);
    const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
    const mapMult = this.runState.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[this.runState.mapIndex] || 1 : 1;

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

    // Per-tick backlog drain (not only on death): releases queued enemies whenever
    // the live count is under the gameplay cap, so immortal base-attackers can
    // never pin the pending queue. Runs pre-step so released enemies join this tick.
    this.enemyManager.drainPendingQueues();

    const wm = this.waveManager;
    if (wm.countdownActive) {
      const currentRemaining = Math.ceil(wm.countdownTimer);
      const stored: { remaining: number; nextWave: number } | null = this.runState.waveCountdown;
      if (!stored || stored.remaining !== currentRemaining) {
        this.runState.waveCountdown = { remaining: currentRemaining, nextWave: wm.currentWave + 1 };
      }
    } else if (this.runState.waveCountdown !== null) {
      this.runState.waveCountdown = null;
    }

    if (this.grid!.pathVersion !== this.lastPathVersion) {
      this.physicsWorld!.rebuildTowers(this.towerManager!);
      const towersConverged = this.navMeshBuilder?.syncTowers(this.towerManager!.towers) ?? true;
      this.navDistanceField?.ensureUpToDate(true);
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
    this.towerManager.update(dt, this.enemyManager);

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
      if (enemy.removed || enemy.ballisticTimer <= 0) continue;
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
  }

  // Timer-expiry seam, distinct from the killed path above. Expiry currently pays
  // the same progress rewards (see WaveManager.update: milestones/best-wave/unlock
  // track waves survived, not kills); the separate method exists so a future
  // economy change can price expiry differently with a one-method edit.
  onWaveExpired(wave: number): void {
    setWave(this.runState, wave);
    this.applyWaveProgressRewards(wave);
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
          persistHasClaimedMilestone(this.persistState, this.runState.mapIndex, milestoneWave);
        const base = MILESTONE_GEMS[milestoneWave] ?? 0;
        const diffMult = getDifficultyMultiplier(this.persistState);
        const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
        const mapMult = this.runState.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[this.runState.mapIndex] || 1 : 1;

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
          persistMarkFirstTimeMilestone(this.persistState, this.runState.mapIndex, milestoneWave);
        }

        this.persistState.gems += afterFirstTime;
        this.runState.runGemsEarned += afterFirstTime;
      }
    }

    if (this.runState.mapIndex >= 0) {
      persistUpdateBestWave(this.persistState, this.runState.mapIndex, wave);
      if (wave >= 15) {
        persistMaybeUnlockNextMap(this.persistState, this.runState.mapIndex);
      }
    }
    this.persistDirty = true;
  }

  onWaveStart(wave: number): void {
    setWave(this.runState, wave);
    this.waveGraphTracker?.onWaveStart(wave);

    const towers = this.towerManager!.towers;
    const sorted = towers
      .map((tower) => ({ tower, dmg: tower.waveDamage }))
      .filter((entry) => entry.dmg > 0)
      .sort(
        (entryA, entryB) => entryB.dmg - entryA.dmg || entryB.tower.totalDamageDealt - entryA.tower.totalDamageDealt,
      )
      .slice(0, 3);
    this.waveTopTowers =
      sorted.length > 0
        ? sorted.map((entry, i) => ({
            towerId: entry.tower.id,
            rank: i + 1,
            damage: entry.dmg,
            simSeconds: this.simSeconds,
          }))
        : null;

    this.towerManager!.towers.forEach((tower) => {
      tower.waveDamage = 0;
    });

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
    const bounty = enemy.bounty || 1;
    this.waveGraphTracker?.onGoldBounty(bounty);
    this.earnGold(bounty);
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

    persistClearActiveWave(this.persistState, this.runState.mapIndex);

    const finalWave = this.waveManager!.currentWave;
    const lastLevel = Math.floor(finalWave / 10);
    const perWaveRate = Math.floor(BONUS_GEM_BASE ** lastLevel);
    const totalBonus = Math.floor((finalWave * perWaveRate) / 10);

    if (totalBonus > 0) {
      const diffMult = getDifficultyMultiplier(this.persistState);
      const gemMult = 1 + DIFFICULTY_MULT_GEM_BASE * (diffMult - 1);
      const mapMult = this.runState.mapIndex >= 0 ? MAP_GEM_MULTIPLIERS[this.runState.mapIndex] || 1 : 1;
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
      if (!persistHasCleared(this.persistState, this.runState.mapIndex)) {
        const breakdown = this.runState.gemBreakdown;
        const subtotal =
          breakdown.bossKills.afterFirstTime +
          breakdown.milestones.afterFirstTime +
          breakdown.waveCompletion.afterFirstTime;
        const bonus = subtotal * 2;
        this.runState.gemBreakdown.firstClearBonus = bonus;
        this.persistState.gems += bonus;
        this.runState.runGemsEarned += bonus;
        persistMarkFirstClear(this.persistState, this.runState.mapIndex);
      }
    }

    this.persistDirty = true;

    const historyEntry: Record<string, unknown> = {
      mapIndex: this.runState.mapIndex,
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

    if (this.runState.mapIndex === -1 && this.runState.randomMapParams) {
      historyEntry.randomMapParams = this.runState.randomMapParams;
    }

    persistAddRunToHistory(this.persistState, historyEntry);
    this.persistDirty = true;

    triggerEnd(this.runState, victory, {
      wave: this.waveManager!.currentWave,
      gems: this.runState.runGemsEarned,
      gemBreakdown: this.runState.gemBreakdown,
    });
  }

  private isUpgradeBtnAt(worldX: number, worldY: number): boolean {
    const selectedTower = this.getSelectedTower();
    if (!selectedTower || this.runState.selectedTowerType) return false;
    const tileSize = this.grid?.tileSize || 36;
    const buildX = (selectedTower.tileX + 1) * tileSize - 12;
    const buildY = selectedTower.tileY * tileSize + 2;
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

    const tileSize = this.grid?.tileSize || 36;
    const tx = Math.floor(worldX / tileSize),
      ty = Math.floor(worldY / tileSize);

    if (this.isUpgradeBtnAt(worldX, worldY)) {
      this.upgradeSelected();
      return;
    }

    if (!this.grid.inBounds(tx, ty)) {
      if (this.runState.selectedTowerType) this.runState.selectedTowerType = null;
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

  upgradeSelected(): void {
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
  // the worker's persistState. The skill tree mutates these on the main thread
  // (persistStore); this keeps the worker authoritative-copy in sync so mid-run
  // unlocks reach Tower.specialize / cost calculations. Returns true so the
  // worker posts a fresh snapshot reflecting the updated slice.
  syncPersist(unlocked: PersistState["unlocked"], generalAddons: PersistState["generalAddons"]): boolean {
    if (unlocked) this.persistState.unlocked = unlocked;
    if (generalAddons) this.persistState.generalAddons = generalAddons;
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
        const scale = amount ?? this.runState.timeScale;
        if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
          console.warn(`debug setTimeScale rejected invalid amount ${amount}`);
          break;
        }
        this.runState.timeScale = scale;
        break;
      }
      case "skipWave":
        this.waveManager?.startNextWave();
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
    setWave(this.runState, wave);
    this.waveManager?.debugJumpToWave(wave);
    this.runState.waveCountdown =
      this.waveManager === null ? null : { remaining: Math.ceil(BETWEEN_WAVES_TIMER), nextWave: wave + 1 };
    this.applyWaveProgressRewards(wave);
  }

  sellSelected(): void {
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
    togglePauseState(this.runState);
  }

  cycleSpeed(): number {
    return cycleTimeScale(this.runState, 1);
  }

  cycleSpeedReverse(): number {
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
}

class BaseTarget implements AttackTarget {
  private engine: GameEngine;
  readonly isGhost = false;
  constructor(engine: GameEngine) {
    this.engine = engine;
  }
  takeDamage(amount: number, _attacker?: Enemy): void {
    this.engine.damageBase(amount);
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
