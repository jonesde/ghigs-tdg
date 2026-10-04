/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { FIXED_DT, GameState, STARTING_BASE_HEALTH } from "@/sim/Constants.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import {
  type BonusOffer,
  cacheOpenGold,
  curateBonusOffer,
  isTypedBonusId,
  largePurseGold,
  rollBonusOfferFor,
  rollSpecialistType,
  smallPurseGold,
} from "@/sim/runBonuses.js";
import type { MockHostBindings } from "../../helpers/mock-stores";
import {
  buildableTileNear,
  buildBasic,
  firstTile,
  freshEngine,
  pick,
  pinEnemy,
  sampleOffer,
  waveManagerOf,
} from "../../helpers/simFixtures";

describe("bonus offers", () => {
  it("draws three distinct cards from the map seed and the package id", () => {
    const first = rollBonusOfferFor(10112, 4);
    const second = rollBonusOfferFor(10112, 4);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(rollBonusOfferFor(10112, 5)).not.toEqual(first);
  });

  it("stacks persistent cards by multiplication and scales base health with the ratio", () => {
    const engine = freshEngine();
    const tower = buildBasic(engine);
    const unbuffed = tower.stats.damage;
    pick(engine, "sharpened");
    expect(tower.stats.damage / unbuffed).toBeCloseTo(1.1, 5);
    pick(engine, "sharpened");
    expect(engine.runState.runBonuses.damageMult).toBeCloseTo(1.21, 5);
    expect(tower.stats.damage / unbuffed).toBeCloseTo(1.21, 5);

    const healthBefore = engine.runState.baseHealth;
    const maxBefore = engine.runState.maxBaseHealth;
    pick(engine, "fortify");
    expect(engine.runState.maxBaseHealth / maxBefore).toBeCloseTo(1.1, 5);
    expect(engine.runState.baseHealth / engine.runState.maxBaseHealth).toBeCloseTo(healthBefore / maxBefore, 5);
    expect(engine.runState.maxBaseHealth).toBeCloseTo(STARTING_BASE_HEALTH * 1.1, 5);
  });

  it("draws at most one typed card per offer, into the first slot", () => {
    let typedOffers = 0;
    for (let packageId = 1; packageId <= 300; packageId++) {
      const offer = rollBonusOfferFor(10112, packageId);
      const typed = offer.filter((bonusId) => isTypedBonusId(bonusId));
      expect(new Set(offer).size).toBe(3);
      expect(typed.length).toBeLessThanOrEqual(1);
      if (typed.length === 0) continue;
      typedOffers += 1;
      expect(offer[0]).toBe(typed[0]);
    }
    expect(typedOffers).toBeGreaterThan(100);
    expect(typedOffers).toBeLessThan(280);
    expect(rollBonusOfferFor(10112, 7)).toEqual(rollBonusOfferFor(10112, 7));
  });

  it("applies a typed card to towers of its specialist type only", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const towers = engine.towerManager;
    if (!grid || !towers) throw new Error("no grid");
    const basicTower = buildBasic(engine);
    const sniperTile = firstTile(
      grid,
      (tileX, tileY) =>
        grid.isTerrain(tileX, tileY) &&
        grid.canBuild(tileX, tileY) &&
        (tileX !== basicTower.tileX || tileY !== basicTower.tileY),
    );
    if (!sniperTile) throw new Error("no second tile");
    const sniperTower = towers.build("sniper", sniperTile.x, sniperTile.y, engine.persistState, grid, 0);
    if (!sniperTower) throw new Error("build failed");
    const basicDamage = basicTower.stats.damage;
    const sniperDamage = sniperTower.stats.damage;

    engine.runState.bonusPicker = {
      source: "drop",
      id: -1,
      offer: ["sharpenedType", "smallPurse", "largePurse"],
      wasPlaying: false,
      specialistType: "basic",
    };
    expect(engine.pickBonus(0)).toBe(true);

    expect(basicTower.stats.damage / basicDamage).toBeCloseTo(1.1, 5);
    expect(sniperTower.stats.damage / sniperDamage).toBeCloseTo(1, 5);
    expect(engine.runState.runBonuses.typeDamageMult.basic).toBeCloseTo(1.1, 5);
    expect(sniperTower.runDamageMult).toBe(1);
    expect(engine.runState.runBonuses.damageMult).toBe(1);
  });

  it("refreshes typed range, fire rate, and health on the specialist tower only", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const towers = engine.towerManager;
    if (!grid || !towers) throw new Error("no grid");
    const basicTower = buildBasic(engine);
    const sniperTile = firstTile(
      grid,
      (tileX, tileY) =>
        grid.isTerrain(tileX, tileY) &&
        grid.canBuild(tileX, tileY) &&
        (tileX !== basicTower.tileX || tileY !== basicTower.tileY),
    );
    if (!sniperTile) throw new Error("no second tile");
    const sniperTower = towers.build("sniper", sniperTile.x, sniperTile.y, engine.persistState, grid, 0);
    if (!sniperTower) throw new Error("build failed");
    const basicRange = basicTower.stats.range;
    const basicRate = basicTower.stats.fireRate;
    const basicMaxHealth = basicTower.maxHealth;
    const basicHealth = basicTower.health;
    const sniperRange = sniperTower.stats.range;
    const sniperRate = sniperTower.stats.fireRate;
    const sniperMaxHealth = sniperTower.maxHealth;

    pick(engine, "farSightType");
    pick(engine, "quickHandsType");
    pick(engine, "fortifyType");

    expect(basicTower.stats.range / basicRange).toBeCloseTo(1.1, 5);
    expect(basicTower.stats.fireRate / basicRate).toBeCloseTo(1.1, 5);
    expect(basicTower.maxHealth / basicMaxHealth).toBeCloseTo(1.1, 5);
    expect(basicTower.health / basicTower.maxHealth).toBeCloseTo(basicHealth / basicMaxHealth, 5);
    expect(basicTower.runRangeMult).toBeCloseTo(1.1, 5);
    expect(basicTower.runFireRateMult).toBeCloseTo(1.1, 5);
    expect(basicTower.runHealthMult).toBeCloseTo(1.1, 5);

    expect(sniperTower.stats.range / sniperRange).toBeCloseTo(1, 5);
    expect(sniperTower.stats.fireRate / sniperRate).toBeCloseTo(1, 5);
    expect(sniperTower.maxHealth / sniperMaxHealth).toBeCloseTo(1, 5);
    expect(engine.runState.runBonuses.typeRangeMult.basic).toBeCloseTo(1.1, 5);
    expect(engine.runState.runBonuses.typeRangeMult.sniper).toBeUndefined();
  });

  it("weights the specialist draw by live tower counts and falls back to a uniform roll", () => {
    for (let packageId = 1; packageId <= 40; packageId++) {
      expect(rollSpecialistType(10112, packageId, { basic: 3 })).toBe("basic");
    }
    const draws = new Set<string>();
    for (let packageId = 1; packageId <= 120; packageId++) {
      draws.add(rollSpecialistType(10112, packageId, { basic: 3, sniper: 1 }));
    }
    expect(draws.size).toBe(2);
    expect(draws).toEqual(new Set(["basic", "sniper"]));
    const fallback = new Set<string>();
    for (let packageId = 1; packageId <= 60; packageId++) {
      fallback.add(rollSpecialistType(10112, packageId, {}));
    }
    expect(fallback.size).toBeGreaterThan(1);
    expect([...fallback].every((towerId) => towerId !== "sturdyWall")).toBe(true);
  });

  it("swaps Heavy Frost out of a cache offer when the run cannot apply a slow", () => {
    const offer: BonusOffer = ["heavyFrost", "sharpened", "smallPurse"];
    const curated = curateBonusOffer(offer, { canApplySlow: false }, 10112, 4);
    expect(curated).not.toContain("heavyFrost");
    expect(curated).toHaveLength(3);
    expect(new Set(curated).size).toBe(3);
    expect(curateBonusOffer(offer, { canApplySlow: false }, 10112, 4)).toEqual(curated);
    expect(curateBonusOffer(offer, { canApplySlow: true }, 10112, 4)).toEqual(offer);
    expect(curateBonusOffer(["sharpened", "smallPurse", "bounty"], { canApplySlow: false }, 10112, 4)).toEqual([
      "sharpened",
      "smallPurse",
      "bounty",
    ]);
  });

  it("never swaps in a typed card, so the curated offer keeps the one-typed-card rule", () => {
    let swapped = 0;
    for (let packageId = 1; packageId <= 240; packageId++) {
      const rolled = rollBonusOfferFor(10112, packageId);
      if (!rolled.includes("heavyFrost")) continue;
      const curated = curateBonusOffer(rolled, { canApplySlow: false }, 10112, packageId);
      swapped += 1;
      expect(curated).not.toContain("heavyFrost");
      expect(new Set(curated).size).toBe(3);
      const typed = curated.filter(isTypedBonusId);
      expect(typed.length).toBeLessThanOrEqual(1);
      if (typed.length > 0) expect(curated[0]).toBe(typed[0]);
    }
    expect(swapped).toBeGreaterThan(10);
  });

  it("cuts enemy attack damage before it lands on a tower or the base", () => {
    const engine = freshEngine();
    const tower = buildBasic(engine);
    const attack = { flyingHeight: 0 } as Enemy;
    tower.health = tower.maxHealth;
    tower.takeDamage(100, attack);
    const unarmoredLoss = tower.maxHealth - tower.health;
    tower.health = tower.maxHealth;
    pick(engine, "armor");
    tower.takeDamage(100, attack);
    expect(tower.maxHealth - tower.health).toBeCloseTo(unarmoredLoss * 0.9, 5);

    const base = engine.enemyManager?.baseTarget;
    if (!base) throw new Error("no base");
    const baseBefore = engine.runState.baseHealth;
    base.takeDamage(100, attack);
    expect(baseBefore - engine.runState.baseHealth).toBeCloseTo(90, 5);
  });

  it("pays multiplied kill gold and nothing for a summoned minion", () => {
    const engine = freshEngine();
    const minion = engine.enemyManager?.spawn("minion", 1, 0, 1);
    if (!minion) throw new Error("no minion");
    const listed = minion.bounty || 1;
    const before = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold - before).toBe(listed);

    pick(engine, "bounty");
    const again = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold - again).toBeCloseTo(listed * 1.1, 5);

    minion.summoned = true;
    minion.bounty = 0;
    const held = engine.runState.gold;
    engine.onEnemyKill(minion);
    expect(engine.runState.gold).toBe(held);
  });

  it("scales purses and the cache fee together so the break-even holds", () => {
    expect(cacheOpenGold(1)).toBe(50);
    expect(smallPurseGold(1)).toBe(50);
    expect(largePurseGold(1)).toBe(100);
    expect(cacheOpenGold(10)).toBe(95);
    expect(largePurseGold(10)).toBe(cacheOpenGold(10) * 2);
    expect(smallPurseGold(10)).toBe(cacheOpenGold(10));
    expect(largePurseGold(40)).toBe(cacheOpenGold(40) * 2);
  });
});

describe("supply drops and the bonus picker", () => {
  it("drops a package on the death path tile and snaps back onto a path", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    if (!grid) throw new Error("no grid");
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!boss) throw new Error("no boss");
    const path = firstTile(grid, (tileX, tileY) => grid.isPath(tileX, tileY));
    const terrain = firstTile(grid, (tileX, tileY) => grid.isTerrain(tileX, tileY));
    if (!path || !terrain) throw new Error("map has no path");
    const pathWorld = grid.tileToWorld(path.x, path.y);
    boss.x = pathWorld.x;
    boss.y = pathWorld.y;
    engine.onEnemyKill(boss);
    expect(engine.supplyDrops).toHaveLength(1);
    expect(engine.supplyDrops[0]).toMatchObject({ tileX: path.x, tileY: path.y });
    // The corridor tile stays a corridor tile, but the package reserves it: a
    // tower built there would sit on a package the player still has to click.
    const reservedDrop = engine.supplyDrops[0]!;
    expect(grid.canBuild(reservedDrop.tileX, reservedDrop.tileY)).toBe(false);
    expect(
      engine.towerManager?.build("basic", reservedDrop.tileX, reservedDrop.tileY, engine.persistState, grid, 0),
    ).toBeNull();

    const terrainWorld = grid.tileToWorld(terrain.x, terrain.y);
    boss.x = terrainWorld.x;
    boss.y = terrainWorld.y;
    engine.onEnemyKill(boss);
    const snapped = engine.supplyDrops[1];
    if (!snapped) throw new Error("second drop missing");
    expect(grid.isPath(snapped.tileX, snapped.tileY)).toBe(true);
  });

  it("pauses only when the run was playing, and dismiss leaves the package", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss) throw new Error("no boss");
    engine.onEnemyKill(boss);
    const drop = engine.supplyDrops[0];
    if (!drop) throw new Error("no drop");
    const world = grid.tileToWorld(drop.tileX, drop.tileY);

    engine.runState.state = GameState.PLAYING;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.runState.bonusPicker?.id).toBe(drop.id);
    expect(engine.dismissBonus()).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(engine.supplyDrops).toHaveLength(1);
    expect(engine.runState.bonusPicker).toBeNull();

    engine.runState.state = GameState.PAUSED;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker).not.toBeNull();
    engine.dismissBonus();
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.supplyDrops).toHaveLength(1);

    engine.handleClick(world.x, world.y);
    const gold = engine.runState.gold;
    engine.pickBonus(0);
    expect(engine.supplyDrops).toHaveLength(0);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.runState.gold).toBeGreaterThanOrEqual(gold);
    expect(grid.canBuild(drop.tileX, drop.tileY)).toBe(true);
  });

  it("does not stack two packages on one corridor tile", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    if (!grid) throw new Error("no grid");
    const path = firstTile(grid, (tileX, tileY) => grid.isPath(tileX, tileY));
    if (!path) throw new Error("no path");
    const world = grid.tileToWorld(path.x, path.y);
    const first = engine.enemyManager?.spawn("boss", 1, 0, 10);
    const second = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!first || !second) throw new Error("no boss");
    first.x = world.x;
    first.y = world.y;
    second.x = world.x;
    second.y = world.y;
    engine.onEnemyKill(first);
    engine.onEnemyKill(second);
    expect(engine.supplyDrops).toHaveLength(2);
    const tiles = new Set(engine.supplyDrops.map((drop) => `${drop.tileX},${drop.tileY}`));
    expect(tiles.size).toBe(2);
    expect(engine.supplyDrops.every((drop) => grid.isPath(drop.tileX, drop.tileY))).toBe(true);
  });

  it("swaps Heavy Frost out of a drop offer when the run cannot apply a slow", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const boss = engine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!grid || !boss) throw new Error("no boss");
    engine.onEnemyKill(boss);
    const drop = engine.supplyDrops[0];
    if (!drop) throw new Error("no drop");
    drop.offer = ["heavyFrost", "sharpened", "smallPurse"];
    const world = grid.tileToWorld(drop.tileX, drop.tileY);
    engine.runState.state = GameState.PLAYING;
    engine.handleClick(world.x, world.y);
    const picker = engine.runState.bonusPicker;
    if (!picker) throw new Error("drop picker did not open");
    expect(picker.offer).not.toContain("heavyFrost");
    expect([...picker.offer]).toEqual([...drop.offer]);
    expect(picker.offer.filter(isTypedBonusId)).toHaveLength(0);
    expect(new Set(picker.offer).size).toBe(3);
    expect(drop.offer).not.toContain("heavyFrost");
  });
});

describe("cache claims", () => {
  it("spends the wave's cache fee when a card is taken and nothing when the offer is declined", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const cache = engine.mapCaches[0];
    if (!grid || !cache) throw new Error("no cache");
    const openCost = cacheOpenGold(engine.runState.currentWave);
    const world = grid.tileToWorld(cache.tileX, cache.tileY);
    const host = engine.host as MockHostBindings;
    engine.runState.state = GameState.PLAYING;
    engine.runState.gold = openCost - 1;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(engine.runState.gold).toBe(openCost - 1);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(
      host.uiEvents.some(
        (event) => event.type === "showNotification" && event.message === "50 gold is required to open a cache.",
      ),
    ).toBe(true);

    engine.runState.gold = openCost;
    engine.handleClick(world.x, world.y);
    expect(engine.runState.bonusPicker?.source).toBe("cache");
    expect(engine.runState.state).toBe(GameState.PAUSED);
    // First open fixes the specialist type and the curated offer on the site, so a
    // dismiss and reopen cannot reroll what the cards promise.
    const firstSpecialistType = engine.runState.bonusPicker?.specialistType;
    const firstOffer = [...(engine.runState.bonusPicker?.offer ?? [])];
    expect(firstSpecialistType).toBeTruthy();
    expect(engine.dismissBonus()).toBe(true);
    expect(engine.runState.gold).toBe(openCost);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(false);

    engine.handleClick(world.x, world.y);
    const picker = engine.runState.bonusPicker;
    if (!picker) throw new Error("picker did not open");
    expect(picker.specialistType).toBe(firstSpecialistType);
    expect([...picker.offer]).toEqual(firstOffer);
    engine.runState.gold = openCost - 1;
    expect(engine.pickBonus(0)).toBe(false);
    expect(engine.runState.bonusPicker?.id).toBe(cache.id);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(true);
    expect(engine.runState.gold).toBe(openCost - 1);

    engine.runState.gold = openCost;
    picker.offer = sampleOffer();
    expect(engine.pickBonus(0)).toBe(true);
    expect(engine.runState.gold).toBe(0);
    expect(engine.runState.runBonuses.damageMult).toBeCloseTo(1.1, 5);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(false);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(true);
    expect(engine.runState.state).toBe(GameState.PLAYING);

    const dropEngine = freshEngine();
    const dropGrid = dropEngine.grid;
    const boss = dropEngine.enemyManager?.spawn("boss", 1, 0, 10);
    if (!dropGrid || !boss) throw new Error("no boss");
    dropEngine.onEnemyKill(boss);
    const drop = dropEngine.supplyDrops[0];
    if (!drop) throw new Error("no drop");
    const dropWorld = dropGrid.tileToWorld(drop.tileX, drop.tileY);
    const goldBeforeDrop = dropEngine.runState.gold;
    dropEngine.runState.state = GameState.PLAYING;
    dropEngine.handleClick(dropWorld.x, dropWorld.y);
    const dropPicker = dropEngine.runState.bonusPicker;
    if (!dropPicker) throw new Error("drop picker did not open");
    dropPicker.offer = sampleOffer();
    expect(dropEngine.pickBonus(0)).toBe(true);
    expect(dropEngine.runState.gold).toBe(goldBeforeDrop);
    expect(dropEngine.supplyDrops).toHaveLength(0);
    expect(dropEngine.runState.runBonuses.damageMult).toBeCloseTo(1.1, 5);
  });

  it("lets an idle tower break a cache and leaves the cache alone while an enemy is in range", () => {
    const engine = freshEngine();
    const grid = engine.grid;
    const towers = engine.towerManager;
    const cache = engine.mapCaches[0];
    if (!grid || !towers || !cache) throw new Error("no cache");
    const tile = buildableTileNear(grid, cache.tileX, cache.tileY, 2.5);
    if (!tile) throw new Error("no tower tile in range of the cache");
    const tower = towers.build("basic", tile.x, tile.y, engine.persistState, grid, 0);
    if (!tower) throw new Error("build failed");
    const minion = engine.enemyManager?.spawn("minion", 1, 0, 1);
    if (!minion) throw new Error("no minion");
    minion.attackDamage = 0;
    minion.hp = 100000;
    minion.maxHp = 100000;
    waveManagerOf(engine).advanceHeld = true;
    const beside = grid.tileToWorld(tower.tileX, tower.tileY);
    const besideX = beside.x + grid.tileSize * 0.4;
    const healthAtStart = cache.hp;
    const goldAtStart = engine.runState.gold;
    const shotDamage = tower.stats.damage;
    // A cache shot fired on the first tick would land inside this window. Pinning
    // the minion keeps it inside range, so the tower keeps firing at the minion.
    for (let frame = 0; frame < 90; frame++) {
      pinEnemy(minion, besideX, beside.y);
      engine.update(FIXED_DT);
    }
    expect(cache.hp).toBe(healthAtStart);
    expect(engine.runState.gold).toBe(goldAtStart);

    const far = firstTile(grid, (tileX, tileY) => {
      const world = grid.tileToWorld(tileX, tileY);
      return Math.hypot(world.x - tower.x, world.y - tower.y) > grid.tileSize * 6;
    });
    if (!far) throw new Error("no tile outside tower range");
    const farWorld = grid.tileToWorld(far.x, far.y);
    tower.cooldown = 0;
    let healthDropped = false;
    for (let frame = 0; frame < 120 && !healthDropped; frame++) {
      pinEnemy(minion, farWorld.x, farWorld.y);
      engine.update(FIXED_DT);
      if (cache.hp < healthAtStart) healthDropped = true;
    }
    expect(healthDropped).toBe(true);
    expect(healthAtStart - cache.hp).toBeCloseTo(shotDamage, 5);
    expect(engine.runState.gold).toBe(goldAtStart);

    cache.hp = shotDamage;
    tower.cooldown = 0;
    for (let frame = 0; frame < 120 && cache.hp > 0; frame++) {
      pinEnemy(minion, farWorld.x, farWorld.y);
      engine.update(FIXED_DT);
    }
    // A broken cache keeps its tile and offer: towers stop targeting hp<=0, the
    // tile stays reserved, and the break opens the free claim immediately.
    expect(cache.hp).toBe(0);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(true);
    expect(engine.runState.gold).toBe(goldAtStart);
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(false);
    expect(engine.runState.bonusPicker).toMatchObject({ source: "cache", id: cache.id });
    const goldBeforeClaim = engine.runState.gold;
    expect(engine.pickBonus(0)).toBe(true);
    expect(engine.runState.gold).toBeGreaterThanOrEqual(goldBeforeClaim);
    expect(engine.mapCaches.some((site) => site.id === cache.id)).toBe(false);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(grid.canBuild(cache.tileX, cache.tileY)).toBe(true);
    const rebuilt = towers.build("basic", cache.tileX, cache.tileY, engine.persistState, grid, 0);
    expect(rebuilt).toBeTruthy();
  });

  it("queues a second broken cache and opens it as soon as the first claim closes", () => {
    const engine = freshEngine(12);
    const grid = engine.grid;
    const towers = engine.towerManager;
    const firstCache = engine.mapCaches[0];
    const secondCache = engine.mapCaches[1];
    if (!grid || !towers || !firstCache || !secondCache) throw new Error("need two caches");
    const cachesBefore = engine.mapCaches.length;
    const firstTileNear = buildableTileNear(grid, firstCache.tileX, firstCache.tileY, 2.5);
    const secondTileNear = buildableTileNear(grid, secondCache.tileX, secondCache.tileY, 2.5);
    if (!firstTileNear || !secondTileNear) throw new Error("no tower tile in range of both caches");
    const firstTower = towers.build("basic", firstTileNear.x, firstTileNear.y, engine.persistState, grid, 0);
    const secondTower = towers.build("basic", secondTileNear.x, secondTileNear.y, engine.persistState, grid, 0);
    if (!firstTower || !secondTower) throw new Error("build failed");
    const minion = engine.enemyManager?.spawn("minion", 1, 0, 1);
    if (!minion) throw new Error("no minion");
    minion.attackDamage = 0;
    minion.hp = 100000;
    minion.maxHp = 100000;
    waveManagerOf(engine).advanceHeld = true;
    const outsideBoth = firstTile(grid, (tileX, tileY) => {
      const world = grid.tileToWorld(tileX, tileY);
      return (
        Math.hypot(world.x - firstTower.x, world.y - firstTower.y) > grid.tileSize * 6 &&
        Math.hypot(world.x - secondTower.x, world.y - secondTower.y) > grid.tileSize * 6
      );
    });
    if (!outsideBoth) throw new Error("no tile outside both tower ranges");
    const outsideWorld = grid.tileToWorld(outsideBoth.x, outsideBoth.y);
    engine.runState.state = GameState.PLAYING;
    firstCache.hp = firstTower.stats.damage;
    secondCache.hp = secondTower.stats.damage;
    firstTower.cooldown = 0;
    secondTower.cooldown = 0;
    for (let frame = 0; frame < 400 && (firstCache.hp > 0 || secondCache.hp > 0); frame++) {
      pinEnemy(minion, outsideWorld.x, outsideWorld.y);
      engine.update(FIXED_DT);
    }
    expect(firstCache.hp).toBe(0);
    expect(secondCache.hp).toBe(0);

    expect(engine.mapCaches).toHaveLength(cachesBefore);
    expect(engine.mapCaches.filter((site) => site.hp <= 0)).toHaveLength(2);
    expect(grid.canBuild(firstCache.tileX, firstCache.tileY)).toBe(false);
    expect(grid.canBuild(secondCache.tileX, secondCache.tileY)).toBe(false);
    const openPicker = engine.runState.bonusPicker;
    if (!openPicker) throw new Error("no picker opened for the first break");
    expect(openPicker.wasPlaying).toBe(true);
    expect(engine.runState.state).toBe(GameState.PAUSED);
    expect(engine.pendingBrokenCaches).toHaveLength(1);
    const queuedId = engine.pendingBrokenCaches[0]!.id;
    expect(queuedId).not.toBe(openPicker.id);

    expect(engine.pickBonus(0)).toBe(true);
    expect(engine.mapCaches.some((site) => site.id === openPicker.id)).toBe(false);
    expect(engine.pendingBrokenCaches).toHaveLength(0);
    expect(engine.runState.bonusPicker).toMatchObject({ source: "cache", id: queuedId });
    expect(engine.runState.state).toBe(GameState.PAUSED);

    expect(engine.pickBonus(0)).toBe(true);
    expect(engine.runState.bonusPicker).toBeNull();
    expect(engine.pendingBrokenCaches).toHaveLength(0);
    expect(engine.mapCaches).toHaveLength(cachesBefore - 2);
    expect(engine.runState.state).toBe(GameState.PLAYING);
    expect(grid.canBuild(firstCache.tileX, firstCache.tileY)).toBe(true);
    expect(grid.canBuild(secondCache.tileX, secondCache.tileY)).toBe(true);
  });
});
