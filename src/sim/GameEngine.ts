import { ENEMY_POOL_SIZE } from "@/render/svg/types.js";
import type { MapThemeData, SpawnState } from "@/render/themes/index.js";
import type { DebugKind } from "@/sim/Command.js";
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
import { generateRandomMap, getMap } from "@/sim/grid/Map.js";
import type { HostBindings, ThemeBundle } from "@/sim/HostBindings.js";
import { CrowdManager } from "@/sim/navmesh/CrowdManager.js";
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
} from "@/sim/PersistState.js";
import { ProjectileManager } from "@/sim/ProjectileManager.js";
import { ContactProcessor } from "@/sim/physics/ContactProcessor.js";
import { ForceFieldSystem } from "@/sim/physics/ForceFieldSystem.js";
import { PhysicsWorld } from "@/sim/physics/PhysicsWorld.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { TowerManager } from "@/sim/towers/TowerManager.js";
import { WaveGraphTracker } from "@/sim/WaveGraphTracker.js";
import { WaveManager } from "@/sim/waves/WaveManager.js";
import {
  BONUS_GEM_BASE,
  BOUNTY_BLOCKED_RATIO,
  DIFFICULTY_MULT_GEM_BASE,
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
  active: boolean;
  _waveGameTime: number;
  spawnStates: SpawnState[];
  update(
    dt: number,
    onWaveCleared: ((wave: number) => void) | null,
    onWaveStart: ((wave: number) => void) | null,
  ): void;
  startNextWave(): void;
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
  waveTopTowers: { tower: Tower; rank: number; dmg: number; startTime: number }[] | null;
  lastScaledDt: number = 0;
  // Path-version gate for snapshot serialization: the last grid.pathVersion we
  // included in a posted snapshot. Resets per run so each engine starts clean
  // (see _initMap). Engine-scoped (not module-scoped) so direct buildSnapshot
  // callers in tests behave deterministically.
  lastPostedPathVersion: number = 0;
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
    this.waveTopTowers = null;
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
    this.lastPostedPathVersion = 0;
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
      selectedTowerId: null,
      selectedTowerType: null,
      hoverTile: null,
      hoverUpgradeBtn: false,
      upgradeBtnClickAnim: 0,
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
    if (navBuilder.isSuccess() && navBuilder.getNavMesh()) {
      this.crowdManager = new CrowdManager(navBuilder.getNavMesh()!, this.grid.tileSize, ENEMY_POOL_SIZE);
      this.crowdManager.setForceFieldSystem(this.forceFieldSystem);
      this.enemyManager.setCrowdManager(this.crowdManager);
      this.physicsWorld.setEnemyEnemyCollisions(false);
    } else {
      console.error("navmesh build failed:", navBuilder.getError());
      this.crowdManager = null;
    }
    this.navDistanceField = new NavDistanceField(this.grid, this.navMeshBuilder);
    this.navDistanceField.rebuild();
    this.physicsWorld.rebuildTowers(this.towerManager);
    this.enemyManager.baseTarget = new BaseTarget(this);
    this.grid.towerLookup = {
      towerAt: (tileX: number, tileY: number) => this.towerManager?.towerAt(tileX, tileY) ?? null,
    };
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

    this.waveManager.update(
      dt,
      (wave) => this.onWaveCleared(wave),
      (wave) => this.onWaveStart(wave),
    );

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
      this.navMeshBuilder?.syncTowers(this.towerManager!.towers);
      this.navDistanceField?.ensureUpToDate(true);
      this.lastPathVersion = this.grid!.pathVersion;
    }
    const onEnemyKill = (enemy: Enemy): void => {
      if (enemy.removed) {
        if (enemy.type === "boss") {
          this.onBossKilled();
        }
        if (enemy.onPathBlocked) {
          const bounty = Math.ceil((enemy.bounty || 1) * BOUNTY_BLOCKED_RATIO);
          this.waveGraphTracker?.onGoldBounty(bounty);
          this.earnGold(bounty);
        } else {
          this.onEnemyKill(enemy);
        }
      }
    };
    const onEnemyBeginAttackBase = (enemy: Enemy): void => {
      this.waveManager!.baseReached = true;
      if (enemy.type === "boss") {
        this.runState.bossesReachedBaseThisRun++;
      }
    };

    this.enemyManager.preStep(dt);
    this.crowdManager?.update(dt, this.enemyManager.enemies);
    this.forceFieldSystem.apply(dt, this.enemyManager.enemies);
    // Homing projectiles set kinematic velocities before the physics step.
    this.projectileManager?.prePhysics(dt);
    this.physicsWorld!.step();
    // PhysicsWorld.step already projected contact flags onto enemies; drain the
    // projectile hit queue for postPhysics resolution.
    const projectileHits = this.contactProcessor?.drainProjectileHits() ?? [];
    this.enemyManager.postStep(dt, onEnemyKill, onEnemyBeginAttackBase);
    // Projectiles read body positions and resolve hits (contacts + cast fallback).
    this.projectileManager?.postPhysics(dt, projectileHits);
    this.clampBallisticEnemiesToNavMesh();

    this.towerManager.update(dt, this.enemyManager);

    // Resolve any towers that died this frame: spawn the ghost explosion, drop
    // the block so enemies may route through the tile, and recompute paths.
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

  // Knockback impulses can shove a body off the navmesh; snap back to the nearest
  // walkable point so Detour and Rapier stay aligned after the ballistic window.
  private clampBallisticEnemiesToNavMesh(): void {
    const builder = this.navMeshBuilder;
    if (!builder || !this.enemyManager) return;
    for (const enemy of this.enemyManager.enemies) {
      if (enemy.removed || enemy.ballisticTimer <= 0) continue;
      const nearest = builder.nearestWalkableWorld({ x: enemy.x, y: enemy.y });
      if (!nearest) continue;
      const drift = Math.hypot(nearest.x - enemy.x, nearest.y - enemy.y);
      if (drift < enemy.radius * 0.25) continue;
      enemy.body?.setTranslation({ x: nearest.x, y: nearest.y }, true);
      enemy.x = nearest.x;
      enemy.y = nearest.y;
      enemy.centerX = nearest.x;
      enemy.centerY = nearest.y;
      this.crowdManager?.teleportAgent(enemy, nearest);
    }
  }

  onWaveCleared(wave: number): void {
    setWave(this.runState, wave);

    for (const m of MILESTONE_WAVES) {
      if (wave >= m && !hasClaimedMilestoneRun(this.runState, m)) {
        this.runState.milestoneRewardsClaimed[m] = true;

        const hasClaimed =
          this.runState.mapIndex >= 0 && persistHasClaimedMilestone(this.persistState, this.runState.mapIndex, m);
        const base = MILESTONE_GEMS[m] ?? 0;
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
          persistMarkFirstTimeMilestone(this.persistState, this.runState.mapIndex, m);
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
    if (sorted.length > 0) {
      this.waveTopTowers = sorted.map((entry, i) => ({
        tower: entry.tower,
        rank: i + 1,
        dmg: entry.dmg,
        startTime: performance.now(),
      }));
    }

    this.towerManager!.towers.forEach((tower) => {
      tower.waveDamage = 0;
    });

    // Full-restore all towers at wave start, then clear any that were ghosted
    // so their tiles re-block in a single path recompute. Reposition enemies
    // that were standing on a tile that just became blocked again.
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
      date: Date.now(),
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
    if (!this.enemyManager) return [];
    const enemiesById = new Map(this.enemyManager.enemies.map((enemy) => [enemy.id, enemy]));
    const matchedEnemies: Enemy[] = [];
    for (const enemyId of enemyIds) {
      const enemy = enemiesById.get(enemyId);
      if (enemy) matchedEnemies.push(enemy);
    }
    return matchedEnemies;
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
      case "addGold":
        setGold(this.runState, this.runState.gold + (amount ?? 0));
        break;
      case "addBaseHealth":
        this.runState.baseHealth = Math.max(0, Math.min(this.maxBaseHealth, this.runState.baseHealth + (amount ?? 0)));
        break;
      case "addGems":
        this.persistState.gems += amount ?? 0;
        this.persistDirty = true;
        break;
      case "setWave": {
        const wave = amount ?? this.runState.currentWave;
        this.runState.currentWave = wave;
        if (this.waveManager) this.waveManager.currentWave = wave;
        break;
      }
      case "setTimeScale":
        this.runState.timeScale = amount ?? this.runState.timeScale;
        break;
      case "skipWave":
        this.waveManager?.startNextWave();
        break;
      case "killAll":
        this.enemyManager?.clear();
        break;
    }
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
    // Compute sell value once for the confirm dialog. Sell executes only via
    // action:executeSell from the main thread (creditAmount carried on the command).
    const creditAmount = isRefund ? tower.totalInvested : tower.sellValue();
    void this.host.requestConfirm({
      towerId,
      towerType: tower.type,
      towerLevel: tower.level,
      sellValue: creditAmount,
      isRefund,
    });
  }

  executeSellById(towerId: string, precomputedCreditAmount?: number): void {
    const tower = this.towerManager?.getTowerById(towerId);
    if (!tower) return;
    if (tower.isGhost) return;

    if (this.persistState.generalAddons?.sellActive === "discount") return;

    const isRefund = this.persistState.generalAddons?.sellActive === "refund";
    // Prefer the value computed in sellSelected (already shown in the confirm dialog),
    // otherwise compute it here (e.g. the non-confirm executeSell path).
    const creditedAmount = precomputedCreditAmount ?? (isRefund ? tower.totalInvested : tower.sellValue());
    this.towerManager!.sell(tower, this.persistState);
    this.host.syncGridTower(tower.tileX, tower.tileY, false);
    this.runState.gold += creditedAmount;
    this.runState.selectedTowerId = null;
    this.persistDirty = true;
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

  executeSell(): void {
    if (!this.runState.selectedTowerId) return;
    this.executeSellById(this.runState.selectedTowerId);
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
