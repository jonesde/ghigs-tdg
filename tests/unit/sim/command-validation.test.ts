import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { applyCommand } from "@/sim/applyCommand.js";
import type { Command } from "@/sim/Command.js";
import type { CommandDispatcher } from "@/sim/CommandDispatcher.js";
import { dispatchCommand, setCommandDispatcher } from "@/sim/commandBus.js";
import { createCommandQueueReceipt, drainCommandQueue } from "@/sim/commandDrain.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { GameState } from "@/sim/GameRunState.js";
import { cacheOpenGold } from "@/sim/runBonuses.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { type CommandGridInfo, validateCommand } from "@/sim/validateCommand.js";
import { WorkerCommandDispatcher } from "@/sim/WorkerCommandDispatcher.js";
import {
  createTestMapThemeStore,
  createTestPersistState,
  createTestThemeBundle,
  MockHostBindings,
} from "../../helpers/mock-stores.js";

const testGrid: CommandGridInfo = { width: 20, height: 15, tileSize: 36 };

describe("validateCommand (pure)", () => {
  it("rejects an unknown towerType for selectBuildType", () => {
    const reason = validateCommand({ commandId: 1, type: "action:selectBuildType", towerType: "doombringer" });
    expect(reason).toMatch(/unknown towerType/);
  });

  it("accepts a known towerType and null for selectBuildType", () => {
    expect(validateCommand({ commandId: 1, type: "action:selectBuildType", towerType: "basic" })).toBeNull();
    expect(validateCommand({ commandId: 1, type: "action:selectBuildType", towerType: null })).toBeNull();
  });

  it("rejects prototype-chain names as towerType", () => {
    for (const prototypeName of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const reason = validateCommand({
        commandId: 1,
        type: "action:selectBuildType",
        towerType: prototypeName,
      } as unknown as Command);
      expect(reason).toMatch(/unknown towerType/);
    }
  });

  it("rejects NaN and out-of-bounds clicks", () => {
    expect(validateCommand({ commandId: 1, type: "input:click", worldX: Number.NaN, worldY: 10 }, testGrid)).toMatch(
      /finite/,
    );
    expect(
      validateCommand(
        { commandId: 1, type: "input:click", worldX: testGrid.width * testGrid.tileSize + 5, worldY: 10 },
        testGrid,
      ),
    ).toMatch(/bounds/);
    expect(validateCommand({ commandId: 1, type: "input:click", worldX: -5, worldY: 10 }, testGrid)).toMatch(/bounds/);
  });

  it("accepts an in-bounds click", () => {
    expect(validateCommand({ commandId: 1, type: "input:click", worldX: 40, worldY: 40 }, testGrid)).toBeNull();
  });

  it("accepts undoProgressivePlacement", () => {
    expect(validateCommand({ commandId: 1, type: "action:undoProgressivePlacement" }, testGrid)).toBeNull();
  });

  it("bounds the progressive block template index at the catalog size", () => {
    const base = { commandId: 1, rotation: 0, blockX: 1, blockY: 1 } as const;
    expect(validateCommand({ ...base, type: "action:placeProgressiveBlock", templateIndex: 11 }, testGrid)).toBeNull();
    expect(validateCommand({ ...base, type: "action:placeProgressiveBlock", templateIndex: 12 }, testGrid)).toMatch(
      /0-11/,
    );
    expect(validateCommand({ ...base, type: "action:placeProgressiveBlock", templateIndex: -1 }, testGrid)).toMatch(
      /0-11/,
    );
  });

  it("rejects a bad targeting mode and an invalid variant/dir", () => {
    expect(validateCommand({ commandId: 1, type: "action:setTargeting", mode: "bogus" })).toMatch(/mode/);
    expect(validateCommand({ commandId: 1, type: "action:specialize", variant: "C" as unknown as "A" })).toMatch(
      /variant/,
    );
    expect(validateCommand({ commandId: 1, type: "action:setFixedAimDir", dir: "X" as unknown as "N" })).toMatch(/dir/);
  });

  it("accepts the documented targeting modes, variants, and dirs", () => {
    for (const mode of ["first", "last", "closest", "strong", "furthest"]) {
      expect(validateCommand({ commandId: 1, type: "action:setTargeting", mode })).toBeNull();
    }
    expect(validateCommand({ commandId: 1, type: "action:specialize", variant: "A" })).toBeNull();
    expect(validateCommand({ commandId: 1, type: "action:setFixedAimDir", dir: null })).toBeNull();
  });

  it("caps enemyIds and waypoints at 256 entries", () => {
    const manyIds = Array.from({ length: 257 }, (_, index) => index + 1);
    expect(
      validateCommand({ commandId: 1, type: "llm:routeGroup", enemyIds: manyIds, waypoints: [] }, testGrid),
    ).toMatch(/256/);
    const manyWaypoints = Array.from({ length: 257 }, () => ({ x: 0, y: 0 }));
    expect(
      validateCommand({ commandId: 1, type: "llm:routeGroup", enemyIds: [1], waypoints: manyWaypoints }, testGrid),
    ).toMatch(/256/);
  });

  it("rejects non-integer and out-of-bounds hold/waypoint tiles", () => {
    expect(
      validateCommand(
        { commandId: 1, type: "llm:routeGroup", enemyIds: [1], hold: true, holdTile: { x: 1.5, y: 2 }, waypoints: [] },
        testGrid,
      ),
    ).toMatch(/finite integer/);
    expect(
      validateCommand({ commandId: 1, type: "llm:routeGroup", enemyIds: [1], waypoints: [{ x: 99, y: 0 }] }, testGrid),
    ).toMatch(/bounds/);
    expect(
      validateCommand({ commandId: 1, type: "llm:siegeTower", enemyIds: [1], towerTile: { x: 0, y: -1 } }, testGrid),
    ).toMatch(/bounds/);
  });

  it("rejects bad debug amounts and sell credit amounts", () => {
    expect(validateCommand({ commandId: 1, type: "action:debug", kind: "setTimeScale", amount: 16 })).toMatch(
      /1, 2, 4, 8/,
    );
    expect(validateCommand({ commandId: 1, type: "action:debug", kind: "addGold", amount: -5 })).toMatch(
      /non-negative/,
    );
    expect(validateCommand({ commandId: 1, type: "action:debug", kind: "setWave", amount: 1.5 })).toMatch(/integer/);
    expect(
      validateCommand({ commandId: 1, type: "action:executeSell", towerId: "tower-1", creditAmount: Number.NaN }),
    ).toMatch(/creditAmount/);
    expect(validateCommand({ commandId: 1, type: "action:executeSell", towerId: "" })).toMatch(/towerId/);
  });

  it("bounds the bonus card index and accepts the picker actions", () => {
    expect(validateCommand({ commandId: 1, type: "action:pickBonus", index: 3 })).toMatch(/0-2/);
    expect(validateCommand({ commandId: 1, type: "action:pickBonus", index: 0 })).toBeNull();
    expect(validateCommand({ commandId: 1, type: "action:dismissBonus" })).toBeNull();
    expect(validateCommand({ commandId: 1, type: "action:unlockCache" })).toBeNull();
  });
});

describe("command intake through applyCommand", () => {
  let engine: GameEngine;
  let persistState: ReturnType<typeof createTestPersistState>;
  let mockHost: MockHostBindings;

  beforeEach(() => {
    createTestMapThemeStore();
    persistState = createTestPersistState();
    mockHost = new MockHostBindings();
    engine = new GameEngine(persistState, createTestThemeBundle(), mockHost, 0);
    engine.loadMap(0);
  });

  function buildAgedTower(): Tower {
    const grid = engine.grid!;
    for (let tileX = 0; tileX < grid.width; tileX++) {
      for (let tileY = 0; tileY < grid.height; tileY++) {
        if (!grid.canBuild(tileX, tileY)) continue;
        if (engine.towerManager!.towerAt(tileX, tileY)) continue;
        const tower = engine.towerManager!.build("basic", tileX, tileY, persistState, grid);
        if (!tower) continue;
        tower._gameSeconds = (getGameContent().towers.tuning.cancelBuildWindowMs + 1000) / 1000;
        return tower;
      }
    }
    throw new Error("no buildable tile found");
  }

  async function grantSellConfirm(towerId: string): Promise<void> {
    engine.runState.selectedTowerId = towerId;
    engine.sellSelected();
    await Promise.resolve();
  }

  it("rejects a bad towerType without mutating state", () => {
    const applied = applyCommand(engine, { commandId: 11, type: "action:selectBuildType", towerType: "doombringer" });
    expect(applied).toBe(false);
    expect(engine.runState.selectedTowerType).toBeNull();
    expect(mockHost.uiEvents.some((event) => event.type === "showNotification")).toBe(true);
  });

  it("rejects NaN and out-of-bounds clicks without mutating state", () => {
    const goldBefore = engine.runState.gold;
    expect(applyCommand(engine, { commandId: 12, type: "input:click", worldX: Number.NaN, worldY: 10 })).toBe(false);
    const grid = engine.grid!;
    const outsideX = grid.width * grid.tileSize + 50;
    expect(applyCommand(engine, { commandId: 13, type: "input:click", worldX: outsideX, worldY: 10 })).toBe(false);
    expect(engine.runState.gold).toBe(goldBefore);
    expect(engine.runState.selectedTowerType).toBeNull();
  });

  it("charges action:unlockCache exactly once for the open cache", () => {
    const cache = engine.mapCaches[0];
    const grid = engine.grid;
    if (!cache || !grid) throw new Error("no cache");
    const cost = cacheOpenGold(engine.runState.currentWave);
    const world = grid.tileToWorld(cache.tileX, cache.tileY);
    engine.runState.state = GameState.PLAYING;
    engine.handleClick(world.x, world.y);
    if (!engine.runState.bonusPicker) throw new Error("picker did not open");

    engine.runState.gold = cost - 1;
    expect(applyCommand(engine, { commandId: 34, type: "action:unlockCache" })).toBe(false);
    expect(cache.unlocked).toBe(false);
    expect(engine.runState.gold).toBe(cost - 1);

    engine.runState.gold = cost;
    expect(applyCommand(engine, { commandId: 35, type: "action:unlockCache" })).toBe(true);
    expect(cache.unlocked).toBe(true);
    expect(engine.runState.gold).toBe(0);

    engine.runState.gold = cost;
    expect(applyCommand(engine, { commandId: 36, type: "action:unlockCache" })).toBe(false);
    expect(engine.runState.gold).toBe(cost);
  });

  it("rejects undoProgressivePlacement when there is no undo stash", () => {
    expect(engine.progressivePlacementUndo).toBeNull();
    expect(applyCommand(engine, { commandId: 17, type: "action:undoProgressivePlacement" })).toBe(false);
  });

  it("rejects a bad tower targeting mode without mutating state", () => {
    const tower = buildAgedTower();
    engine.runState.selectedTowerId = tower.id;
    const targetingBefore = tower.targeting;
    expect(applyCommand(engine, { commandId: 14, type: "action:setTargeting", mode: "bogus" })).toBe(false);
    expect(tower.targeting).toBe(targetingBefore);
  });

  it("rejects oversized enemyIds and waypoint lists", () => {
    const manyIds = Array.from({ length: 300 }, (_, index) => index + 1);
    const command: Command = { commandId: 15, type: "llm:routeGroup", enemyIds: manyIds, waypoints: [] };
    expect(applyCommand(engine, command)).toBe(false);
    const manyWaypoints = Array.from({ length: 300 }, () => ({ x: 0, y: 0 }));
    expect(
      applyCommand(engine, { commandId: 16, type: "llm:routeGroup", enemyIds: [], waypoints: manyWaypoints }),
    ).toBe(false);
  });

  it("rejects a sell with a mismatched credit: no gold, tower kept, failure recorded", () => {
    const tower = buildAgedTower();
    const goldBefore = engine.runState.gold;
    const expectedCredit = tower.sellValue();
    return grantSellConfirm(tower.id).then(() => {
      const errors: string[] = [];
      const receipt = createCommandQueueReceipt();
      const sellCommand: Command = {
        commandId: 21,
        type: "action:executeSell",
        towerId: tower.id,
        creditAmount: expectedCredit + 1,
      };
      drainCommandQueue(engine, [sellCommand], receipt, (message) => {
        errors.push(message);
      });
      expect(receipt.lastFailedCommandId).toBe(21);
      expect(receipt.lastAppliedCommandId).toBe(0);
      expect(errors).toHaveLength(1);
      expect(engine.runState.gold).toBe(goldBefore);
      expect(engine.towerManager!.getTowerById(tower.id)).not.toBeNull();
      expect(mockHost.uiEvents.some((event) => event.type === "showNotification")).toBe(true);
    });
  });

  it("consumes the sell grant one-shot: a retry without a fresh confirm is rejected", () => {
    const tower = buildAgedTower();
    const goldBefore = engine.runState.gold;
    const expectedCredit = tower.sellValue();
    return grantSellConfirm(tower.id).then(() => {
      const receipt = createCommandQueueReceipt();
      const mismatched: Command = {
        commandId: 22,
        type: "action:executeSell",
        towerId: tower.id,
        creditAmount: expectedCredit + 1,
      };
      drainCommandQueue(engine, [mismatched], receipt, () => {});
      expect(receipt.lastFailedCommandId).toBe(22);
      const retry: Command = {
        commandId: 23,
        type: "action:executeSell",
        towerId: tower.id,
        creditAmount: expectedCredit,
      };
      drainCommandQueue(engine, [retry], receipt, () => {});
      expect(receipt.lastFailedCommandId).toBe(23);
      expect(engine.runState.gold).toBe(goldBefore);
      expect(engine.towerManager!.getTowerById(tower.id)).not.toBeNull();
    });
  });

  it("rejects executeSell with no prior confirm", () => {
    const tower = buildAgedTower();
    const goldBefore = engine.runState.gold;
    expect(() => engine.executeSellById(tower.id, tower.sellValue())).toThrow(/no confirmed sell request/);
    expect(engine.runState.gold).toBe(goldBefore);
    expect(engine.towerManager!.getTowerById(tower.id)).not.toBeNull();
  });

  it("sells with the worker-recomputed credit on the granted path", () => {
    const tower = buildAgedTower();
    const goldBefore = engine.runState.gold;
    const expectedCredit = tower.sellValue();
    return grantSellConfirm(tower.id).then(() => {
      expect(engine.executeSellById(tower.id, expectedCredit)).toBe(true);
      expect(engine.runState.gold).toBe(goldBefore + expectedCredit);
      expect(engine.towerManager!.getTowerById(tower.id)).toBeUndefined();
      expect(engine.runState.selectedTowerId).toBeNull();
    });
  });

  it("routes debug setWave through milestones, best-wave, and between-wave state", () => {
    const waveManager = engine.waveManager!;
    waveManager.startNextWave();
    expect(waveManager.active).toBe(true);
    const applied = applyCommand(engine, { commandId: 31, type: "action:debug", kind: "setWave", amount: 50 });
    expect(applied).toBe(true);
    expect(engine.runState.currentWave).toBe(50);
    expect(waveManager.currentWave).toBe(50);
    expect(waveManager.betweenWaves).toBe(true);
    expect(waveManager.countdownActive).toBe(true);
    const betweenWavesTimer = getGameContent().economy.betweenWavesTimer;
    expect(waveManager.countdownTimer).toBe(betweenWavesTimer);
    expect(waveManager.active).toBe(false);
    expect(engine.runState.waveCountdown).toEqual({ remaining: Math.ceil(betweenWavesTimer), nextWave: 51 });
    for (const spawnState of waveManager.spawnStates) {
      expect(spawnState.visualState).toBe("closed");
    }
    for (const milestoneWave of getGameContent().economy.milestoneWaves) {
      if (milestoneWave <= 50) expect(engine.runState.milestoneRewardsClaimed[milestoneWave]).toBe(true);
    }
    expect(persistState.themeProgress.default?.bestWaves.best_0).toBe(50);
  });

  it("clamps debug gold and time scale instead of applying them", () => {
    const goldBefore = engine.runState.gold;
    const scaleBefore = engine.runState.timeScale;
    expect(applyCommand(engine, { commandId: 32, type: "action:debug", kind: "setTimeScale", amount: 3 })).toBe(false);
    expect(engine.runState.timeScale).toBe(scaleBefore);
    expect(applyCommand(engine, { commandId: 33, type: "action:debug", kind: "addGold", amount: -100 })).toBe(false);
    expect(engine.runState.gold).toBe(goldBefore);
  });

  it("failed commands do not advance lastAppliedCommandId", () => {
    const errors: string[] = [];
    const receipt = createCommandQueueReceipt();
    const queue: Command[] = [
      { commandId: 41, type: "input:click", worldX: Number.NaN, worldY: 10 },
      { commandId: 42, type: "action:togglePause" },
    ];
    const stateBefore = engine.runState.state;
    const mutated = drainCommandQueue(engine, queue, receipt, (message) => {
      errors.push(message);
    });
    expect(mutated).toBe(true);
    expect(receipt.lastFailedCommandId).toBe(41);
    expect(receipt.lastAppliedCommandId).toBe(42);
    expect(errors).toHaveLength(1);
    expect(engine.runState.state).not.toBe(stateBefore);
    expect(queue).toHaveLength(0);
  });
});

describe("commandBus", () => {
  afterEach(() => {
    setCommandDispatcher(null);
  });

  it("does not mutate the caller object when assigning commandId", () => {
    const received: Command[] = [];
    const fakeDispatcher: CommandDispatcher = {
      dispatch: (command) => {
        received.push(command);
      },
    };
    setCommandDispatcher(fakeDispatcher);
    const outgoing: Command = { commandId: 0, type: "action:togglePause" };
    dispatchCommand(outgoing);
    expect(outgoing.commandId).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]!.commandId).toBeGreaterThan(0);
  });

  it("queues while the dispatcher is null and flushes on register", () => {
    setCommandDispatcher(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      dispatchCommand({ commandId: 0, type: "action:togglePause" });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
    const received: Command[] = [];
    setCommandDispatcher({
      dispatch: (command) => {
        received.push(command);
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.commandId).toBeGreaterThan(0);
  });

  it("bounds the null-dispatcher queue and drops oldest", () => {
    setCommandDispatcher(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let index = 0; index < 105; index++) {
        dispatchCommand({ commandId: 0, type: "action:togglePause" });
      }
    } finally {
      warnSpy.mockRestore();
    }
    const received: Command[] = [];
    setCommandDispatcher({
      dispatch: (command) => {
        received.push(command);
      },
    });
    expect(received).toHaveLength(100);
  });
});

describe("WorkerCommandDispatcher", () => {
  it("never posts correlation 0 and never mutates the caller object", () => {
    const posted: Array<{ command: Command }> = [];
    const fakeWorker = {
      postMessage: (message: { command: Command }) => {
        posted.push(message);
      },
    };
    const dispatcher = new WorkerCommandDispatcher(fakeWorker as unknown as Worker);
    const outgoing: Command = { commandId: 0, type: "action:togglePause" };
    dispatcher.dispatch(outgoing);
    expect(outgoing.commandId).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.command.commandId).toBeGreaterThan(0);
  });

  it("posts a plain copy of nested persist slices", () => {
    const posted: Array<{ command: Command }> = [];
    const fakeWorker = {
      postMessage: (message: { command: Command }) => {
        posted.push(message);
      },
    };
    const dispatcher = new WorkerCommandDispatcher(fakeWorker as unknown as Worker);
    const persist = createTestPersistState();
    persist.generalAddons.progressiveThirdChoice = 0;
    const outgoing: Command = {
      commandId: 0,
      type: "action:syncPersist",
      unlocked: persist.unlocked,
      generalAddons: persist.generalAddons,
      baseUnlocks: persist.baseUnlocks,
      gemDelta: -100,
    };
    dispatcher.dispatch(outgoing);
    const postedCommand = posted[0]?.command;
    if (postedCommand?.type !== "action:syncPersist") throw new Error("expected action:syncPersist");
    expect(postedCommand.generalAddons).not.toBe(persist.generalAddons);
    expect(postedCommand.generalAddons.progressiveThirdChoice).toBe(0);
    expect(postedCommand.gemDelta).toBe(-100);
    persist.generalAddons.progressiveThirdChoice = null;
    expect(postedCommand.generalAddons.progressiveThirdChoice).toBe(0);
  });
});
