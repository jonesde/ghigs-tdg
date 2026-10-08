import type { MapThemeAnimation, SpawnState } from "@/render/themes/index.js";
import type { ProgressiveStamp } from "@/sim/grid/ProgressiveMap.js";
import type { ParticleSpawnRequest } from "@/sim/ParticleSystem.js";
import type { ProjectileManager } from "@/sim/ProjectileManager.js";
import type { BossAbilityId } from "./bossAbilities.js";
import type { GameRunState } from "./GameRunState.js";
import type { ActiveBuildingBonus, BuildingKind } from "./mapSites.js";
import type { BonusOffer, BonusPickerState, RunBonuses } from "./runBonuses.js";

// Bump on incompatible schema changes. Builders stamp it; SnapshotStore.apply
// rejects (warn once, keep previous) any snapshot stamped with another version.
// 2: runBonuses gained the typed per-tower records and bonusPicker gained
// specialistType (boss abilities / run bonuses pass).
// 3: MapCacheSnapshot gained unlocked, gating the bonus cards behind a gold or
// damage unlock.
// 4: MapBuildingSnapshot gained active and meta gained activeBuildingEffects, so a
// render/HMR pairing can never show an unpowered building at full strength.
export const snapshotSchemaVersion = 4;

// Sim seconds one wave-graph dot covers. The worker flushes a dot on this cadence
// and stamps the dots array with a generation so it ships only on the ticks where
// the array's shape changed.
export const waveGraphIntervalSeconds = 5;
// Nominal dot-grid width the worker's retained window and the main-thread
// accumulation cap are both sized from. The worker has no DOM, so this is a
// stand-in container width, not a measured one.
export const waveGraphDotWidth = 2000;
// Dot-grid pitch. The renderer maps a dot index to its x position and hit-tests
// the pointer with it, so it has to be the same number waveGraphDotCapacity
// divides the container width by.
export const waveGraphDotSpacing = 8;
// Dots shipped per posted snapshot when the dots generation changed; the main
// thread merges each window into its accumulation.
export const waveGraphMaxDotsPerPost = 8;

// How many dots fit across a container at the dot spacing. Every dot-window cap
// (the worker's retained window, the main thread's accumulation, and the Vue
// graph's visible slice) derives from this, so the three cannot disagree.
export function waveGraphDotCapacity(containerWidth: number): number {
  return Math.ceil(containerWidth / waveGraphDotSpacing);
}

export interface LightningEffectSnapshot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  simSeconds: number;
}

export interface StunEffectSnapshot {
  x: number;
  y: number;
  simSeconds: number;
  targetId?: number;
}

export interface SimulationSnapshot {
  schemaVersion: number; // snapshotSchemaVersion; consumers reject mismatches
  frameId: number; // monotonic per-tick counter
  lastAppliedCommandId: number; // host uses this to confirm command application
  lastFailedCommandId: number; // last rejected command (validation or apply failure)
  meta: SnapshotMeta;
  enemies: EnemySnapshot[];
  towers: TowerSnapshot[];
  projectiles: ProjectileSnapshot[];
  // Sparse particle spawn requests emitted this tick. Present ONLY when the
  // worker's spawn buffer is non-empty, so quiet ticks send nothing — same sparse
  // policy as lightningEffects/stunEffects below. The main thread spawns each
  // request into its own ParticleSystem and consumes the array exactly once.
  particleSpawns: ParticleSpawnRequest[] | undefined;
  spawnStates: SpawnStateSnapshot[]; // for spawn-queue overlay renderer
  // Navmesh walkable-corridor triangle mesh (game (x,y) vertex pairs + triangle
  // `indices`) for the minimap corridor highlight. Refreshed on pathVersion change.
  navMeshCorridor: { positions: number[]; indices: number[] } | null;
  // Tower-aware nav field for commanders (distance-to-base, spawn reachability).
  // Shipped on pathVersion change; relay caches like gridLayout.
  navField: NavFieldSnapshotData | null;
  // Per-interval wave-graph dots (damage/gold/gems/peak enemy HP). The full
  // array is shipped ONLY when `waveGraphDotsGeneration` changed since the last
  // posted snapshot (a dot is flushed roughly every waveGraphIntervalSeconds,
  // so most posted frames omit it); the main thread keeps its cached copy on
  // frames where it is omitted. Typed `| undefined` (not `?`) so it can be
  // assigned undefined under exactOptionalPropertyTypes — the main thread treats
  // undefined as "unchanged, use cache".
  waveGraphDots: WaveGraphDot[] | undefined;
  // Monotonic counter bumped whenever the dots array's shape changes
  // (push/front-trim/dispose). Always included so a change is still detectable
  // even when the array itself is omitted.
  waveGraphDotsGeneration: number;
  // Constant grid-layout map for the commander worker (0=terrain, 1=path, 2=base,
  // 3=spawn), built once from engine.grid.tiles. Gated by the engine's
  // gridLayoutEnabled data-feed toggle: present only while enabled, undefined once
  // the client has toggled the feed off (it caches the map and never needs it again).
  // Placement log for progressive maps. Shipped only when layoutGeneration
  // changes, the same way waveGraphDots ships on its generation. Undefined means
  // the main thread keeps the log it already applied.
  progressivePlacements?: ProgressiveStamp[] | undefined;
  gridLayout?: number[][] | undefined;
  // Stored tile height, same dimensions as gridLayout. Shipped in the same
  // one-shot feed. A live tower adds 1; that bonus is not baked into this array.
  heights?: number[][] | undefined;
  // Ephemeral visual effects generated this tick: lightning bolt segments and
  // stun aura positions. Populated by the simulation during update() and shipped
  // sparsely: undefined when the corresponding buffer is empty (quiet ticks send
  // nothing), exactly like particleSpawns. Cleared only after a successful
  // postMessage (WorkerEntry consumes), never during build, so a snapshot that
  // was built but not posted keeps its effects for the next build.
  //
  // `simSeconds` is the engine clock when the effect resolved. Effects ride a
  // buffered stream that the ack gate can stall, so the renderer ages an arriving
  // effect by (meta.simSeconds - effect.simSeconds) and drops it once that exceeds
  // its lifetime. Without the stamp a delayed effect restarts at full life on a
  // position the world has already left. A stun effect's `targetId` lets the
  // renderer key one mark per enemy and center it on that enemy's live position;
  // `x`/`y` are the fall-back for an enemy that has since left the frame.
  lightningEffects: LightningEffectSnapshot[] | undefined;
  stunEffects: StunEffectSnapshot[] | undefined;
  // Rapier debug-render line soup (flat 2D vertices: [x1,y1,x2,y2,...]). Always
  // shipped so the ASCII minimap can stroke collider outlines.
  debugPhysics: { vertices: number[] } | null;
}

// Per-interval wave-graph data point (damage/gold/gems/peak enemy HP for a
// waveGraphIntervalSeconds window). Produced by WaveGraphTracker in the
// worker; serialized into the snapshot so the main-thread WaveGraph.vue can
// render without reaching into the engine. Kept here (not in game/) so the sim
// layer stays free of a sim→game dependency.
export interface WaveGraphDot {
  damage: number;
  peakEnemyHp: number;
  gold: number;
  gems: number;
  baseHealth: number;
  baseHealthColor: string;
  waveStart: boolean;
}

export interface WaveTopTowerSnapshot {
  towerId: string;
  rank: number;
  damage: number;
  simSeconds: number;
}

export interface BaseGunStatsSnapshot {
  range: number;
  damage: number;
  fireRate: number;
}

export interface BaseSentrySnapshot {
  x: number;
  y: number;
  angle: number;
  tileX: number;
  tileY: number;
  fireAnimTime: number;
  // Theme tower key the renderers resolve to the `tower-${sprite}-f${i}` symbol
  // and text icon: "basic" for corner turrets, "sniper" for edge turrets.
  sprite: "basic" | "sniper";
}

export interface BaseDefenseSnapshot {
  level: number;
  maxLevel: number;
  targeting: string;
  totalDamageDealt: number;
  waveDamage: number;
  previousWaveDamage: number;
  upgradeCost: number;
  nextLevel: number;
  canUpgrade: boolean;
  blockedReason: string | null;
  downgradeRefund: number;
  shortStats: BaseGunStatsSnapshot | null;
  longStats: BaseGunStatsSnapshot | null;
  sentries: BaseSentrySnapshot[];
}

export interface SnapshotMeta {
  // Scalar state from GameRunState. Subset that the renderer/UI need.
  state: GameRunState["state"];
  mapIndex: number;
  baseHealth: number;
  maxBaseHealth: number;
  gold: number;
  currentWave: number;
  waveCountdown: { remaining: number; nextWave: number } | null;
  timeScale: number;
  // Present when the serializer ran. Optional so hand-built test metas can omit it.
  commanderHold?: boolean;
  selectedTowerId: string | null;
  selectedTowerType: string | null;
  runGemsEarned: number;
  bossesKilledThisRun: number;
  bossesReachedBaseThisRun: number;
  // camera is excluded — main-thread-only UI state, read from gameStore.camera directly
  lastScaledDt: number; // renderer uses this for animation interpolation
  simSeconds?: number;
  // Sim seconds discarded by the accumulator cap / tick-error path (see
  // GameEngine.droppedSimSeconds). Optional so hand-built test metas can omit it.
  droppedSimSeconds?: number;
  // Enemies evicted from (or refused entry to) bounded pending queues since run
  // start, so overflow is never silent in the UI/tests. Optional like the field above.
  pendingOverflowDropped?: number;
  waveTopTowers?: WaveTopTowerSnapshot[] | null;
  totalGoldEarned?: number;
  totalHealingReceived?: number;
  waveComposition?: Record<string, number>;
  endScreenData: GameRunState["endScreenData"];
  // Commander data-feed scalars (Phase 1 enemy commander). Always populated by the
  // serializer; optional here so existing test literals that construct SnapshotMeta
  // by hand need not list them.
  tileSize?: number; // grid tile size, so the worker converts world x/y → tile coords
  waveActive?: boolean; // WaveManager.active — included for future use, not a rush signal
  remainingScheduledSpawns?: number; // enemies still scheduled to spawn this wave (queue.length)
  // Monotonic run identifier (GameEngine.runId), bumped on every (re)load. The
  // commander relay/worker use it to detect a run restart so a stale cached
  // gridLayout is never forwarded and the one-shot feed-off toggle re-arms. Optional
  // so existing hand-built test literals need not list it.
  runId?: number;
  // Worker lifecycle generation (WorkerEntry workerGeneration), bumped on every
  // init/dispose. Stamped post-build by the worker; lets the main thread tell which
  // run produced a snapshot and drop stale ones. Optional like runId.
  workerGeneration?: number;
  // Spawn tiles in WaveManager's index order, and the latched emerge orders.
  // Optional so hand-built test metas can omit them. The serializer always sets both.
  spawns?: SpawnPointSnapshot[];
  spawnOrders?: SpawnOrderView[];
  // NOTE: gemBreakdown and milestoneRewardsClaimed are intentionally NOT mirrored
  // into the snapshot. `gemBreakdown` is delivered to the UI via
  // `endScreenData` (set on triggerEnd), and `milestoneRewardsClaimed` is only
  // read worker-side for persist-flush decisions (directly from runState). Both
  // were previously deep-cloned every postMessage for no consumer on the main thread.
  // Command receipt for the last drained command batch (Block C feedback). Optional
  // so hand-built test literals need not list them; the serializer always sets them.
  lastAppliedCommandId?: number;
  lastAppliedCount?: number;
  lastSkippedCount?: number;
  lastFailedCommandId?: number;
  // Progressive placement. Optional so hand-built test metas can omit them.
  // The serializer always sets them. worldOrigin defaults to 0 for normal maps.
  progressivePlacementHold?: boolean;
  progressiveOffer?: number[];
  // True only while the paused undo window after a placement is open; the worker
  // clears it on the unpause that resumes the run.
  progressiveUndoAvailable?: boolean;
  worldOriginX?: number;
  worldOriginY?: number;
  layoutGeneration?: number;
  // Optional so hand-built test metas compile. The serializer always sets it.
  baseDefense?: BaseDefenseSnapshot;
  // Run rewards and map sites. Optional so hand-built test metas compile.
  // The serializer always sets them.
  runBonuses?: RunBonuses;
  // The whole-board product every powered building pays, and how many are paying.
  // Optional so hand-built test metas compile; the serializer always sets it.
  activeBuildingEffects?: ActiveBuildingBonus;
  bonusPicker?: BonusPickerState | null;
  supplyDrops?: SupplyDropSnapshot[];
  mapCaches?: MapCacheSnapshot[];
  mapBuildings?: MapBuildingSnapshot[];
  nextBossAbilityNames?: string[];
  bombardShots?: BombardShotSnapshot[];
}

export interface SupplyDropSnapshot {
  id: number;
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  offer: BonusOffer;
}

export interface MapCacheSnapshot {
  id: number;
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  hp: number;
  maxHp: number;
  offer: BonusOffer;
  // False while the cards are still gated behind a gold unlock or tower damage.
  unlocked: boolean;
}

export interface MapBuildingSnapshot {
  id: number;
  kind: BuildingKind;
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  // True while a live tower stands on one of the 8 tiles around it, so the render
  // layer can dim an unpowered building without re-deriving the tower set.
  active: boolean;
}

export interface BombardShotSnapshot {
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  progress: number;
}

// Entity snapshots — plain data only, no methods, no closures.
// Field set is the union of everything the render managers currently read
// off the live entity objects.

export interface NavFieldSnapshotData {
  pathVersion: number;
  distanceToBase: number[][];
  spawnReachable: boolean[];
  pathMetrics: Array<{
    spawnIndex: number;
    pathLengthWorld: number;
    reachable: boolean;
    chokeTile?: { x: number; y: number };
  }>;
  spawnPaths?: Array<Array<{ x: number; y: number }>>;
}

export interface SpawnPointSnapshot {
  spawnIndex: number;
  x: number;
  y: number;
}

// One latched emerge order. No spawnIndex means the default slot.
export interface SpawnOrderView {
  spawnIndex?: number;
  hold?: boolean;
  holdTile?: { x: number; y: number };
  waypoints?: Array<{ x: number; y: number }>;
  targetingMode?: string;
  towerTile?: { x: number; y: number };
}

export interface EnemySnapshot {
  id: number;
  type: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  angle: number; // moveAngle
  level: number;
  removed: boolean;
  slowFactor: number; // 1.0 = not slowed
  slowTimer: number;
  burnTimer: number;
  gameSeconds: number;
  hitAnimTime: number;
  attackAnimTime: number;
  isBoss: boolean;
  statusEffects: StatusEffectSnapshot[];
  // NOTE: animation frame payloads (walking/hitReaction/attackAnimation theme
  // objects with referenceImages SVG arrays) are intentionally NOT shipped. They
  // are constant per enemy type and already present in the render's active theme
  // defs, so the render proxy resolves frame timing by `type` from the theme it
  // was initialized with. Shipping them cloned full SVG payloads every tick.
  // Full-physics routing state for commanders / debug.
  routingMode?: "default" | "hold" | "route" | "siege";
  wave?: number;
  spawnIndex?: number;
  attackingBase?: boolean;
  blockedByTowerTile?: { x: number; y: number } | null;
  distanceToBase?: number;
  flyingHeight?: number;
  nextCorner?: { x: number; y: number } | null;
  targetingMode?: string | null;
  // Present on bosses. Omitted for every other enemy so the payload stays small.
  bossAbility?: BossAbilityId;
  mendSuppressed?: boolean;
}

export interface StatusEffectSnapshot {
  kind: "slow" | "stun" | "burn" | "shield" | "heal" | "mark";
  remaining: number;
  magnitude: number;
}

// Result of Tower.canUpgrade — precomputed by the serializer (in the worker,
// where the live Tower and PersistState live) so the render/UI path can only
// *read* the decision without calling a method on the snapshot.
export interface TowerUpgradeCheck {
  ok: boolean;
  cost?: number;
  nextLevel?: number;
  reason?: string;
  needVariant?: boolean;
}

// Subset of Tower.stats the UI binds to. Plain data only.
export interface TowerStatsSnapshot {
  damage: number;
  range: number;
  fireRate: number;
  splash: number;
  chain: number;
  groundOnly: boolean;
}

export interface TowerSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  level: number;
  variant: "A" | "B" | null;
  angle: number;
  cooldown: number;
  targeting: string;
  totalInvested: number;
  waveDamage: number;
  // Per-tower "Previous Wave" damage. Derived on the main-thread projection
  // (SnapshotStore) from the deserialized snapshots, NOT the sim engine. The
  // engine resets `waveDamage` to 0 at wave start; the projection captures the
  // just-finished wave's total here, keyed per tower, so the UI reads it without
  // reaching into the simulation. Optional because the serializer (which reads
  // the sim Tower) does not produce it — the projection stamps it instead.
  previousWaveDamage?: number;
  totalDamageDealt: number;
  fireAnimTime: number;
  fixedAimDir: "N" | "E" | "S" | "W" | null;
  isGhost: boolean;
  health: number;
  maxHealth: number;
  color: string;
  animation: MapThemeAnimation | null;
  // Cheap per-tower fields (always present).
  base: { fixedAim: boolean };
  placedAt: number; // elapsed sim ms since place; TowerPanel derives cancel window locally
  // Derived UI-decision fields — COMPUTED ONLY for the selected tower (see
  // SnapshotSerializer.snapshotTower). They are optional here because
  // non-selected towers omit them to avoid per-tower recompute every tick.
  canUpgrade?: TowerUpgradeCheck;
  upgradeCostAt5?: number; // cost to specialize to level 5
  levelCosts?: number[];
  sellValue?: number;
  // Gold the worker credits for a sell or the next downgrade, after sellActive.
  sellCredit?: number;
  downgradeRefund?: number;
  milestoneBonus?: { damagePct: number; speedPct: number; tiers: number; threshold: number };
  stats?: TowerStatsSnapshot;
  // Selected tower only. Persistent run cards and adjacent buildings, as one line.
  bonusLine?: string;
}

// Projectile snapshot reuses the sim getRenderData() DTO shape (id, x, y, radius, color, icon).
// Particles never ride the snapshot: the main-thread ParticleSystem emits RenderParticle directly.
export type ProjectileSnapshot = ReturnType<ProjectileManager["getRenderData"]>[number];

export type SpawnStateSnapshot = SpawnState & { pendingCount: number };
