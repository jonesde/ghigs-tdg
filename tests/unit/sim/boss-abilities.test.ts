/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  BOMBARD_DAMAGE_FRACTION,
  BOMBARD_TELEGRAPH_SECONDS,
  bossAbilityLabel,
  collectMendSources,
  configureBossAbility,
  MINION_CAP,
  MINION_FIRST_DELAY_SECONDS,
  MINION_INTERVAL_SECONDS,
  nearerMendBlocksIn,
  rollBossAbilities,
  trickleSpawnCount,
} from "@/sim/bossAbilities.js";
import { FIXED_DT } from "@/sim/Constants.js";
import { enemyLevelForWave, waveBossCount } from "@/sim/ConstantsEnemy.js";
import { buildBasic, firstTile, freshEngine, pinEnemy, waveManagerOf } from "../../helpers/simFixtures";

describe("boss abilities", () => {
  it("does not consume the wave composition stream", () => {
    const first = freshEngine();
    const second = freshEngine();
    waveManagerOf(first).currentWave = 9;
    waveManagerOf(first).startNextWave();
    const other = waveManagerOf(second).generateWave(10);
    expect(other.map((entry) => [entry.type, entry.level, entry.delay])).toEqual(
      waveManagerOf(first).queue.map((entry) => [entry.type, entry.level, entry.delay]),
    );
    const bosses = waveManagerOf(first).queue.filter((entry) => entry.type === "boss");
    expect(bosses.length).toBeGreaterThan(0);
    expect(bosses.every((entry) => entry.bossAbility !== undefined)).toBe(true);
    expect(other.every((entry) => entry.bossAbility === undefined)).toBe(true);
  });

  it("gives the first boss of a run no ability and draws the rest without replacement", () => {
    const vanilla = rollBossAbilities(10112, 10, 4, true);
    expect(vanilla[0]).toBe("none");
    expect(new Set(vanilla.slice(1)).size).toBe(3);
    expect(vanilla.slice(1).includes("none")).toBe(false);
    const drawn = rollBossAbilities(10112, 20, 4, false);
    expect(new Set(drawn).size).toBe(4);
    expect(drawn.includes("none")).toBe(false);
    expect(bossAbilityLabel("healAura")).toBe("Mend");
  });

  it("stamps the wave a debug jump lands on, with the abilities the preview promised", () => {
    const engine = freshEngine();
    const map = engine.runState.map;
    if (!map) throw new Error("no map");
    let wave = 1;
    while (waveBossCount(wave, map.bossCadence) === 0 && wave <= 40) wave += 1;
    const bossCount = waveBossCount(wave, map.bossCadence);
    expect(bossCount).toBeGreaterThan(0);

    engine.debug("setWave", wave - 1);
    const preview = [...engine.nextBossAbilityNames];
    expect(preview).toHaveLength(bossCount);

    waveManagerOf(engine).startNextWave();
    const bosses = waveManagerOf(engine).queue.filter((entry) => entry.type === "boss");
    expect(bosses).toHaveLength(bossCount);
    expect(
      bosses.map((entry) => (entry.bossAbility === undefined ? "missing" : bossAbilityLabel(entry.bossAbility))),
    ).toEqual(preview);
  });

  it("bombards a terrain tower that enemy attacks cannot touch, for a real share of its health", () => {
    const shares: number[] = [];
    for (const wave of [10, 40]) {
      const engine = freshEngine();
      const grid = engine.grid;
      const towers = engine.towerManager;
      const map = engine.runState.map;
      if (!grid || !towers || !map) throw new Error("no grid");
      const tower = buildBasic(engine);
      expect(tower.enemyAttackImmune).toBe(true);
      const boss = engine.enemyManager?.spawn("boss", enemyLevelForWave(wave, map.level), 0, wave);
      if (!boss) throw new Error("no boss");
      configureBossAbility(boss, "towerShot", grid.tileSize);
      boss.bombardTimer = 0;
      const bombardDamage = boss.attackDamage * BOMBARD_DAMAGE_FRACTION;
      const maxHealth = tower.maxHealth;
      // One bombard outdamages a fresh tower outright, so the tower gets enough
      // health to survive the hit and let the test measure the damage exactly.
      const healthBefore = Math.max(maxHealth, bombardDamage + 10);
      tower.health = healthBefore;
      const beside = grid.tileToWorld(tower.tileX, tower.tileY);
      let healthDropped = false;
      for (let frame = 0; frame < 600 && !healthDropped; frame++) {
        pinEnemy(boss, beside.x + grid.tileSize * 3, beside.y);
        engine.update(FIXED_DT);
        healthDropped = tower.health < healthBefore;
      }
      expect(healthDropped).toBe(true);
      expect(healthBefore - tower.health).toBeCloseTo(bombardDamage, 5);
      shares.push(bombardDamage / maxHealth);
    }
    for (const share of shares) expect(share).toBeGreaterThanOrEqual(0.1);
  });

  it("emits one capped minion per pulse at the host with no bounty", () => {
    expect(MINION_INTERVAL_SECONDS).toBe(3);
    expect(MINION_FIRST_DELAY_SECONDS).toBe(3);
    expect(MINION_CAP).toBe(10);
    expect(trickleSpawnCount(10, 0, 0, 100)).toBe(1);
    expect(trickleSpawnCount(10, 9, 50, 100)).toBe(1);
    expect(trickleSpawnCount(10, 10, 50, 100)).toBe(0);
    expect(trickleSpawnCount(10, 0, 100, 100)).toBe(0);
    expect(trickleSpawnCount(4, 3, 50, 100)).toBe(1);
    expect(trickleSpawnCount(4, 4, 50, 100)).toBe(0);

    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.waveManager) throw new Error("no boss");
    engine.waveManager.currentWave = 10;
    configureBossAbility(boss, "spawnMinions", grid.tileSize);
    expect(boss.minionTimer).toBe(MINION_FIRST_DELAY_SECONDS);
    engine.update(FIXED_DT);
    expect(
      (engine.enemyManager?.enemies ?? []).filter((enemy) => enemy !== boss && enemy.type === "minion"),
    ).toHaveLength(0);
    boss.minionTimer = FIXED_DT;
    const farPath = firstTile(grid, (tileX, tileY) => {
      if (!grid.isPath(tileX, tileY)) return false;
      const world = grid.tileToWorld(tileX, tileY);
      return Math.hypot(world.x - boss.x, world.y - boss.y) > grid.tileSize * 4;
    });
    if (!farPath) throw new Error("no distant path");
    const destination = grid.tileToWorld(farPath.x, farPath.y);
    boss.x = destination.x;
    boss.y = destination.y;
    const pendingBefore = engine.enemyManager?.getTotalPendingCount() ?? 0;
    engine.update(FIXED_DT);
    const minions = (engine.enemyManager?.enemies ?? []).filter((enemy) => enemy !== boss && enemy.type === "minion");
    expect(minions).toHaveLength(1);
    for (const minion of minions) {
      expect(minion.bounty).toBe(0);
      expect(minion.summoned).toBe(true);
      expect(minion.summonedBy).toBe(boss.id);
      expect(Math.hypot(minion.x - destination.x, minion.y - destination.y)).toBeLessThan(grid.tileSize);
    }
    expect(engine.enemyManager?.getTotalPendingCount()).toBe(pendingBefore);
  });

  it("holds broodwing pulses at the broodwing live-child cap", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    if (!grid || !engine.enemyManager) throw new Error("no engine");
    const broodwing = engine.enemyManager.spawn("broodwing", 20, 0, 70);
    if (!broodwing) throw new Error("no broodwing");
    expect(broodwing.spawnsMinions).toBe(true);
    expect(broodwing.spawnCap).toBe(4);
    expect(broodwing.minionTimer).toBe(3);
    broodwing.minionTimer = 0;
    for (let pulse = 0; pulse < 6; pulse++) {
      broodwing.minionTimer = 0;
      engine.update(FIXED_DT);
    }
    const children = (engine.enemyManager.enemies ?? []).filter(
      (enemy) => enemy !== broodwing && enemy.summonedBy === broodwing.id,
    );
    expect(children.length).toBeLessThanOrEqual(4);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.type).toBe("minion");
      expect(child.bounty).toBe(0);
    }
  });

  it("drops an airborne host's ground child on walkable ground", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    if (!grid || !engine.enemyManager) throw new Error("no engine");
    const broodwing = engine.enemyManager.spawn("broodwing", 20, 0, 70);
    if (!broodwing) throw new Error("no broodwing");
    const hoverTile = firstTile(grid, (tileX, tileY) => {
      if (grid.isPath(tileX, tileY)) return false;
      const neighbors: Array<[number, number]> = [
        [tileX + 1, tileY],
        [tileX - 1, tileY],
        [tileX, tileY + 1],
        [tileX, tileY - 1],
      ];
      return neighbors.some(
        ([neighborX, neighborY]) =>
          neighborX >= 0 &&
          neighborY >= 0 &&
          neighborX < grid.width &&
          neighborY < grid.height &&
          grid.isPath(neighborX, neighborY),
      );
    });
    if (!hoverTile) throw new Error("no off-path tile beside the path");
    const hover = grid.tileToWorld(hoverTile.x, hoverTile.y);
    pinEnemy(broodwing, hover.x, hover.y);
    broodwing.minionTimer = 0;
    engine.update(FIXED_DT);
    const children = (engine.enemyManager.enemies ?? []).filter(
      (enemy) => enemy !== broodwing && enemy.summonedBy === broodwing.id,
    );
    expect(children).toHaveLength(1);
    const childTile = grid.worldToTile(children[0]!.x, children[0]!.y);
    expect(grid.isPath(childTile.x, childTile.y)).toBe(true);
  });

  it("lets the nearer Mend source heal and suppresses a farther one", () => {
    const source = { id: 1, x: 0, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const ally = { id: 2, x: 10, y: 0, removed: false, healSelf: false, antiHealTimer: 0 };
    const nearer = { id: 3, x: 9, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const sources = [source, ally, nearer];
    expect(nearerMendBlocksIn(collectMendSources(sources), source, ally)).toBe(true);
    expect(nearerMendBlocksIn(collectMendSources(sources), nearer, ally)).toBe(false);

    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.enemyManager) throw new Error("no boss");
    configureBossAbility(boss, "healAura", grid.tileSize);
    boss.mendSuppresses = (mendSource, mendAlly) =>
      nearerMendBlocksIn(collectMendSources(engine.enemyManager?.enemies ?? []), mendSource, mendAlly);
    boss.hp = boss.maxHp * 0.5;
    engine.update(FIXED_DT);
    engine.update(FIXED_DT);
    expect(boss.hp).toBeGreaterThan(boss.maxHp * 0.5);
    const healed = boss.hp;
    boss.antiHealTimer = 5;
    engine.update(FIXED_DT);
    expect(boss.hp).toBeCloseTo(healed, 5);
  });

  it("collects only the sources the full scan would consider, per tick", () => {
    const source = { id: 1, x: 0, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const ally = { id: 2, x: 10, y: 0, removed: false, healSelf: false, antiHealTimer: 0 };
    const nearer = { id: 3, x: 9, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const farHealer = { id: 4, x: 40, y: 0, removed: false, healSelf: true, antiHealTimer: 0 };
    const suppressedHealer = { id: 5, x: 5, y: 0, removed: false, healSelf: true, antiHealTimer: 3 };
    const normalHealer = { id: 6, x: 1, y: 0, removed: false, healSelf: false, antiHealTimer: 0 };
    const removedHealer = { id: 7, x: 2, y: 0, removed: true, healSelf: true, antiHealTimer: 0 };
    const enemies = [source, ally, nearer, farHealer, suppressedHealer, normalHealer, removedHealer];
    const sources = collectMendSources(enemies);
    expect(sources.map((entry) => entry.id)).toEqual([source.id, nearer.id, farHealer.id]);
    // Whoever asks, the nearest eligible source decides: a farther Mend boss is
    // suppressed by the nearer one, and the nearer one by nothing.
    expect(nearerMendBlocksIn(sources, source, ally)).toBe(true);
    expect(nearerMendBlocksIn(sources, nearer, ally)).toBe(false);
    expect(nearerMendBlocksIn(sources, farHealer, ally)).toBe(true);
    expect(nearerMendBlocksIn(sources, source, { ...ally, x: source.x + 1, y: source.y })).toBe(false);
    expect(nearerMendBlocksIn([], source, ally)).toBe(false);
  });

  it("hastens the boss by 1.2 and other enemies in range by 1.5", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const near = engine.enemyManager?.spawn("minion", 1, 0, 10);
    const far = engine.enemyManager?.spawn("minion", 1, 0, 10);
    if (!grid || !boss || !near || !far) throw new Error("no enemies");
    configureBossAbility(boss, "speedAura", grid.tileSize);
    near.x = boss.x;
    near.y = boss.y;
    far.x = boss.x + grid.tileSize * 10;
    far.y = boss.y;
    engine.update(FIXED_DT);
    expect(boss.hasteFactor).toBeCloseTo(1.2, 5);
    expect(near.hasteFactor).toBeCloseTo(1.5, 5);
    expect(far.hasteFactor).toBe(1);
  });

  it("holds the minion pulse while the boss is stunned", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.waveManager) throw new Error("no boss");
    engine.waveManager.currentWave = 10;
    configureBossAbility(boss, "spawnMinions", grid.tileSize);
    boss.minionTimer = FIXED_DT; // would pulse on the next tick if the boss were free
    boss.stunTimer = 10;
    engine.update(FIXED_DT);
    const minions = (engine.enemyManager?.enemies ?? []).filter((enemy) => enemy !== boss && enemy.type === "minion");
    expect(minions).toHaveLength(0);
    expect(boss.minionTimer).toBeCloseTo(FIXED_DT, 5);
  });

  it("holds the shield pulse while the boss is stunned", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const ally = engine.enemyManager?.spawn("minion", 1, 0, 10);
    if (!grid || !boss || !ally) throw new Error("no enemies");
    configureBossAbility(boss, "shieldPulse", grid.tileSize);
    ally.x = boss.x;
    ally.y = boss.y;
    boss.shieldTimer = FIXED_DT; // would pulse on the next tick if the boss were free
    boss.stunTimer = 10;
    engine.update(FIXED_DT);
    expect(boss.shield).toBe(0);
    expect(ally.shield).toBe(0);
    expect(boss.shieldTimer).toBeCloseTo(FIXED_DT, 5);
  });

  it("drops the haste aura, its own included, while the boss is stunned", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const near = engine.enemyManager?.spawn("minion", 1, 0, 10);
    if (!grid || !boss || !near) throw new Error("no enemies");
    configureBossAbility(boss, "speedAura", grid.tileSize);
    near.x = boss.x;
    near.y = boss.y;
    engine.update(FIXED_DT);
    expect(boss.hasteFactor).toBeCloseTo(1.2, 5);
    expect(near.hasteFactor).toBeCloseTo(1.5, 5);
    boss.stunTimer = 10;
    engine.update(FIXED_DT);
    expect(boss.hasteFactor).toBe(1);
    expect(near.hasteFactor).toBe(1);
  });

  it("stops the Mend aura from healing while the boss is stunned", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss) throw new Error("no boss");
    configureBossAbility(boss, "healAura", grid.tileSize);
    boss.hp = boss.maxHp * 0.5;
    boss.stunTimer = 10;
    engine.update(FIXED_DT);
    engine.update(FIXED_DT);
    expect(boss.hp).toBeCloseTo(boss.maxHp * 0.5, 5);
  });

  it("holds an armed bombard telegraph until the stun drops", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const map = engine.runState.map;
    if (!grid || !map) throw new Error("no grid");
    const tower = buildBasic(engine);
    const boss = engine.enemyManager?.spawn("boss", enemyLevelForWave(10, map.level), 0, 10);
    if (!boss) throw new Error("no boss");
    configureBossAbility(boss, "towerShot", grid.tileSize);
    const beside = grid.tileToWorld(tower.tileX, tower.tileY);
    pinEnemy(boss, beside.x + grid.tileSize, beside.y);
    // Arm the telegraph on the tower, then stun it before the countdown runs out.
    boss.bombardTargetId = String(tower.id);
    boss.bombardTelegraphRemaining = BOMBARD_TELEGRAPH_SECONDS;
    boss.stunTimer = 10;
    const healthBefore = tower.health;
    engine.update(FIXED_DT);
    expect(tower.health).toBe(healthBefore);
    expect(boss.bombardTelegraphRemaining).toBeCloseTo(BOMBARD_TELEGRAPH_SECONDS, 5);
  });
});
