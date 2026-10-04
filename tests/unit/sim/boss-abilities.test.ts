/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  BOMBARD_DAMAGE_FRACTION,
  bossAbilityLabel,
  collectMendSources,
  configureBossAbility,
  minionPulseCount,
  nearerMendBlocksIn,
  rollBossAbilities,
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

  it("emits capped minions at the boss with no bounty", () => {
    expect(minionPulseCount(10, 0, 100)).toBe(5);
    expect(minionPulseCount(16, 0, 100)).toBe(8);
    expect(minionPulseCount(10, 97, 100)).toBe(3);
    expect(minionPulseCount(10, 100, 100)).toBe(0);

    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss || !engine.waveManager) throw new Error("no boss");
    engine.waveManager.currentWave = 10;
    configureBossAbility(boss, "spawnMinions", grid.tileSize);
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
    expect(minions).toHaveLength(5);
    for (const minion of minions) {
      expect(minion.bounty).toBe(0);
      expect(minion.summoned).toBe(true);
      expect(Math.hypot(minion.x - destination.x, minion.y - destination.y)).toBeLessThan(grid.tileSize);
    }
    expect(engine.enemyManager?.getTotalPendingCount()).toBe(pendingBefore);
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
});
