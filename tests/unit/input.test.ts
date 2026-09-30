import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInput } from "@/composables/Input.js";
import type { Command } from "@/sim/Command.js";
import { GameState } from "@/sim/Constants.js";
import { TowerIds } from "@/sim/ConstantsTower.js";
import { setCommandDispatcher } from "@/sim/commandBus.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import { buildSnapshot } from "@/sim/SnapshotSerializer.js";
import { SnapshotStore } from "@/sim/SnapshotStore.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { useGameStore } from "@/stores/game.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import { buildTestTowers, createTestEngine } from "../helpers/engine-snapshot.js";

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

type Dispatcher = { commands: Command[]; dispatch(command: Command): void };

function makeDispatcher(): Dispatcher {
  const commands: Command[] = [];
  return {
    commands,
    dispatch(command: Command): void {
      commands.push(command);
    },
  };
}

function makeEvent(key: string, opts: Record<string, unknown> = {}) {
  const event = new KeyboardEvent("keydown", { key, ...opts });
  return event;
}

describe("useInput", () => {
  let gameStore: ReturnType<typeof useGameStore>;
  let uiStore: ReturnType<typeof useUiStore>;
  let persistStore: ReturnType<typeof usePersistStore>;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    gameStore = useGameStore();
    uiStore = useUiStore();
    persistStore = usePersistStore();
    persistStore.$reset();
    dispatcher = makeDispatcher();
    // Tower selection is routed through the global command bus; wire it to the
    // test dispatcher so action:selectTower commands are captured.
    setCommandDispatcher(dispatcher);
  });

  afterEach(() => {
    window.removeEventListener("keydown", () => {});
    setCommandDispatcher(null);
    warnSpy.mockRestore();
  });

  function triggerInput(key: string, opts: Record<string, unknown> = {}) {
    window.dispatchEvent(makeEvent(key, opts));
  }

  function dispatched(type: Command["type"]): boolean {
    return dispatcher.commands.some((command) => command.type === type);
  }

  function lastOfType<T extends Command["type"]>(type: T): Extract<Command, { type: T }> | undefined {
    const matches = dispatcher.commands.filter((command) => command.type === type) as Array<
      Extract<Command, { type: T }>
    >;
    return matches[matches.length - 1];
  }

  // In the worker architecture, tower selection is applied via an
  // action:selectTower command (handled by the worker and reflected in the
  // snapshot), not by mutating gameStore.selectedTower synchronously. These
  // helpers assert on the dispatched command instead.
  function lastSelectedTowerId(): string | null | undefined {
    const command = lastOfType("action:selectTower");
    return command ? command.towerId : undefined;
  }

  // Builds real towers into a fresh engine at the given buildable tiles and
  // pushes the resulting snapshot into the SnapshotStore, so Input.ts tower
  // navigation reads it through the public snapshot path (getLatestSnapshot)
  // instead of an injected internal store field. Returns the engine and the
  // snapshot towers (engine-assigned ids) so tests can bind role objects.
  function applyTowerSnapshot(coords: Array<{ tileX: number; tileY: number }>): {
    engine: ReturnType<typeof createTestEngine>;
    towers: ReturnType<typeof buildSnapshot>["towers"];
  } {
    const engine = createTestEngine(0);
    buildTestTowers(engine, coords);
    const snapshot = buildSnapshot(engine, 0);
    new SnapshotStore(gameStore).apply(snapshot);
    return { engine, towers: snapshot.towers };
  }

  describe("returns early in non-play states", () => {
    it("returns early in MENU state", () => {
      gameStore.setState(GameState.MENU);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput(" ");
      expect(dispatched("action:togglePause")).toBe(false);
    });

    it("returns early in GAME_OVER state", () => {
      gameStore.setState(GameState.GAME_OVER);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput(" ");
      expect(dispatched("action:togglePause")).toBe(false);
    });

    it("returns early in VICTORY state", () => {
      gameStore.setState(GameState.VICTORY);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput(" ");
      expect(dispatched("action:togglePause")).toBe(false);
    });
  });

  describe("Space bar", () => {
    it("toggles pause via command", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput(" ");
      expect(dispatched("action:togglePause")).toBe(true);
    });

    it("does not take space while a text field is focused", () => {
      gameStore.setState(GameState.PLAYING);
      let capturedHandler: ((event: KeyboardEvent) => void) | null = null;
      const originalAddEventListener = window.addEventListener;
      window.addEventListener = vi.fn((event: string, handler: (keyboardEvent: KeyboardEvent) => void) => {
        if (event === "keydown") capturedHandler = handler;
        originalAddEventListener.call(window, event, handler as unknown as EventListener);
      }) as never;
      useInput(gameStore, dispatcher, uiStore);
      window.addEventListener = originalAddEventListener;
      const textarea = document.createElement("textarea");
      const testEvent = makeEvent(" ");
      Object.defineProperty(testEvent, "target", { value: textarea });
      testEvent.preventDefault = vi.fn();
      (capturedHandler as ((event: KeyboardEvent) => void) | null)?.(testEvent);
      expect(dispatched("action:togglePause")).toBe(false);
      expect(testEvent.preventDefault).not.toHaveBeenCalled();
    });

    it("calls preventDefault", () => {
      gameStore.setState(GameState.PLAYING);
      let capturedHandler: ((event: KeyboardEvent) => void) | null = null;
      const originalAddEventListener = window.addEventListener;
      window.addEventListener = vi.fn((event: string, handler: (e: KeyboardEvent) => void) => {
        if (event === "keydown") capturedHandler = handler;
        originalAddEventListener.call(window, event, handler as unknown as EventListener);
      }) as never;
      useInput(gameStore, dispatcher, uiStore);
      window.addEventListener = originalAddEventListener;
      expect(capturedHandler).toBeDefined();
      const testEvent = makeEvent(" ");
      testEvent.preventDefault = vi.fn();
      (capturedHandler as ((e: KeyboardEvent) => void) | null)?.(testEvent);
      expect(testEvent.preventDefault).toHaveBeenCalled();
    });

    it("closes pause menu and unpauses when menu is open", () => {
      gameStore.setState(GameState.PAUSED);
      uiStore.openPauseMenu();
      useInput(gameStore, dispatcher, uiStore);
      triggerInput(" ");
      expect(uiStore.showPauseMenu).toBe(false);
    });
  });

  describe("Escape key", () => {
    it("closes all dialogs when a dialog is open", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      uiStore.showConfirm({ title: "T", message: "M" });
      triggerInput("Escape");
      expect(uiStore.confirmDialog).toBeNull();
    });

    it("cancels build mode when build mode is active", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = "cannon";
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Escape");
      expect(dispatched("action:cancelBuildMode")).toBe(true);
    });

    it("deselects tower when a tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Escape");
      expect(lastSelectedTowerId()).toBeNull();
    });

    it("opens pause menu when no dialog is open and no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Escape");
      expect(uiStore.showPauseMenu).toBe(true);
    });

    it("closes pause menu on second press", () => {
      gameStore.setState(GameState.PAUSED);
      uiStore.openPauseMenu();
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Escape");
      expect(uiStore.showPauseMenu).toBe(false);
    });

    it("closes debug panel when visible", () => {
      gameStore.setState(GameState.PLAYING);
      uiStore.debugPanelVisible = true;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Escape");
      expect(uiStore.debugPanelVisible).toBe(false);
    });
  });

  describe("u key (upgrade)", () => {
    it("dispatches upgradeSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("u");
      expect(dispatched("action:upgradeSelected")).toBe(true);
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("u");
      expect(dispatched("action:upgradeSelected")).toBe(false);
    });
  });

  describe("w/u keys (upgrade / specialize gate)", () => {
    it("dispatches upgradeSelected when a tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = {
        id: "t1",
        type: "basic",
        level: 3,
        canUpgrade: { ok: true, cost: 100, nextLevel: 4 },
      } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("w");
      expect(dispatched("action:upgradeSelected")).toBe(true);
      triggerInput("u");
      expect(dispatched("action:upgradeSelected")).toBe(true);
    });

    it("does not dispatch upgradeSelected when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("w");
      expect(dispatched("action:upgradeSelected")).toBe(false);
    });

    it("dispatches upgradeSelected even when the tower needs a specialization (engine auto-picks)", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = {
        id: "t1",
        type: "basic",
        level: 4,
        canUpgrade: { ok: false, needVariant: true, reason: "Choose specialization" },
      } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("w");
      expect(dispatched("action:upgradeSelected")).toBe(true);
      expect(dispatched("action:specialize")).toBe(false);
    });
  });

  describe("e key (specialize A)", () => {
    it("dispatches specialize A when tower needs variant and variant A is unlocked", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantA[0] = true;
      persistStore.unlocked.basic!.variantB[0] = false;
      const tower = {
        id: "t1",
        type: "basic",
        level: 4,
        canUpgrade: { ok: false, needVariant: true, reason: "Choose specialization" },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("e");
      const spec = lastOfType("action:specialize");
      expect(spec?.variant).toBe("A");
    });

    it("does nothing when variant A is not unlocked", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantA[0] = false;
      persistStore.unlocked.basic!.variantB[0] = true;
      const tower = {
        id: "t1",
        type: "basic",
        level: 4,
        canUpgrade: { ok: false, needVariant: true, reason: "Choose specialization" },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("e");
      expect(dispatched("action:specialize")).toBe(false);
    });

    it("does nothing when tower does not need variant", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantA[0] = true;
      const tower = {
        id: "t1",
        type: "basic",
        level: 3,
        canUpgrade: { ok: true, cost: 100, nextLevel: 4 },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("e");
      expect(dispatched("action:specialize")).toBe(false);
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("e");
      expect(dispatched("action:specialize")).toBe(false);
    });
  });

  describe("c key (specialize B)", () => {
    it("dispatches specialize B when tower needs variant and variant B is unlocked", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantA[0] = false;
      persistStore.unlocked.basic!.variantB[0] = true;
      const tower = {
        id: "t1",
        type: "basic",
        level: 4,
        canUpgrade: { ok: false, needVariant: true, reason: "Choose specialization" },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("c");
      const spec = lastOfType("action:specialize");
      expect(spec?.variant).toBe("B");
    });

    it("does nothing when variant B is not unlocked", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantA[0] = true;
      persistStore.unlocked.basic!.variantB[0] = false;
      const tower = {
        id: "t1",
        type: "basic",
        level: 4,
        canUpgrade: { ok: false, needVariant: true, reason: "Choose specialization" },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("c");
      expect(dispatched("action:specialize")).toBe(false);
    });

    it("does nothing when tower does not need variant", () => {
      gameStore.setState(GameState.PLAYING);
      persistStore.unlocked.basic!.variantB[0] = true;
      const tower = {
        id: "t1",
        type: "basic",
        level: 3,
        canUpgrade: { ok: true, cost: 100, nextLevel: 4 },
      } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("c");
      expect(dispatched("action:specialize")).toBe(false);
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("c");
      expect(dispatched("action:specialize")).toBe(false);
    });
  });

  describe("Up Arrow (tower selection / build position)", () => {
    it("moves build position up when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 2 });
    });

    it("clamps build position to grid bounds on up", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 0 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowUp");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 0 });
    });

    it("selects tower above when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 3, tileY: 4 },
        { tileX: 3, tileY: 2 },
      ]);
      const below = towers.find((t) => t.tileX === 3 && t.tileY === 4)!;
      const above = towers.find((t) => t.tileX === 3 && t.tileY === 2)!;
      gameStore.selectedTower = below as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowUp");
      expect(lastSelectedTowerId()).toBe(above.id);
    });

    it("selects topmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 3, tileY: 4 },
        { tileX: 5, tileY: 1 },
      ]);
      const t2 = towers.find((t) => t.tileX === 5 && t.tileY === 1)!;
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowUp");
      expect(lastSelectedTowerId()).toBe(t2.id);
    });
  });

  describe("s key (downgrade/sell)", () => {
    it("dispatches downgradeSelected when tower level > 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1, level: 3 } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("s");
      expect(dispatched("action:downgradeSelected")).toBe(true);
      expect(dispatched("action:sellSelected")).toBe(false);
    });

    it("dispatches sellSelected when tower level === 1", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1, level: 1 } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("s");
      expect(dispatched("action:sellSelected")).toBe(true);
      expect(dispatched("action:downgradeSelected")).toBe(false);
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("s");
      expect(dispatched("action:sellSelected")).toBe(false);
      expect(dispatched("action:downgradeSelected")).toBe(false);
    });
  });

  describe("ArrowDown (tower selection / build position)", () => {
    it("moves build position down when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 4 });
    });

    it("clamps build position to grid bounds on down", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 9 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 9 });
    });

    it("selects tower below when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 3, tileY: 2 },
        { tileX: 3, tileY: 4 },
      ]);
      const above = towers.find((t) => t.tileX === 3 && t.tileY === 2)!;
      const below = towers.find((t) => t.tileX === 3 && t.tileY === 4)!;
      gameStore.selectedTower = above as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(lastSelectedTowerId()).toBe(below.id);
    });

    it("selects bottommost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 3, tileY: 4 },
        { tileX: 5, tileY: 1 },
      ]);
      const t1 = towers.find((t) => t.tileX === 3 && t.tileY === 4)!;
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(lastSelectedTowerId()).toBe(t1.id);
    });
  });

  describe("Right Arrow (tower selection / build position)", () => {
    it("moves build position right when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 3, tileY: 2 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 4, tileY: 2 });
    });

    it("clamps build position to grid bounds on right", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 9, tileY: 5 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 9, tileY: 5 });
    });

    it("starts from map center when hoverTile is null in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(gameStore.hoverTile).toEqual({ tileX: 5, tileY: 5 });
    });

    it("selects tower to the right when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 2, tileY: 3 },
        { tileX: 4, tileY: 3 },
      ]);
      const left = towers.find((t) => t.tileX === 2 && t.tileY === 3)!;
      const right = towers.find((t) => t.tileX === 4 && t.tileY === 3)!;
      gameStore.selectedTower = left as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(lastSelectedTowerId()).toBe(right.id);
    });

    it("selects rightmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 2, tileY: 3 },
        { tileX: 5, tileY: 1 },
      ]);
      const t2 = towers.find((t) => t.tileX === 5 && t.tileY === 1)!;
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(lastSelectedTowerId()).toBe(t2.id);
    });

    it("prefers same row over diagonal when moving right", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 3, tileY: 3 },
        { tileX: 4, tileY: 2 },
        { tileX: 5, tileY: 3 },
      ]);
      const center = towers.find((t) => t.tileX === 3 && t.tileY === 3)!;
      const sameRow = towers.find((t) => t.tileX === 5 && t.tileY === 3)!;
      gameStore.selectedTower = center as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(lastSelectedTowerId()).toBe(sameRow.id);
    });
  });

  describe("Left Arrow (tower selection / build position)", () => {
    it("moves build position left when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.hoverTile).toEqual({ tileX: 4, tileY: 3 });
    });

    it("clamps build position to grid bounds on left", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 0, tileY: 5 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(gameStore.hoverTile).toEqual({ tileX: 0, tileY: 5 });
    });

    it("selects tower to the left when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 2, tileY: 3 },
        { tileX: 4, tileY: 3 },
      ]);
      const left = towers.find((t) => t.tileX === 2 && t.tileY === 3)!;
      const right = towers.find((t) => t.tileX === 4 && t.tileY === 3)!;
      gameStore.selectedTower = right as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(lastSelectedTowerId()).toBe(left.id);
    });

    it("selects leftmost tower when no tower selected", () => {
      gameStore.setState(GameState.PLAYING);
      const { towers } = applyTowerSnapshot([
        { tileX: 2, tileY: 3 },
        { tileX: 5, tileY: 1 },
      ]);
      const t1 = towers.find((t) => t.tileX === 2 && t.tileY === 3)!;
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(lastSelectedTowerId()).toBe(t1.id);
    });
  });

  describe("Arrow key wrap-around (tower selection)", () => {
    it("wraps right from rightmost tower to leftmost tower on same row", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 14, tileY: 5 },
        { tileX: 2, tileY: 5 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const rightmost = towers.find((t) => t.tileX === 14 && t.tileY === 5)!;
      const leftmost = towers.find((t) => t.tileX === 2 && t.tileY === 5)!;
      gameStore.selectedTower = rightmost as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowRight");
      expect(lastSelectedTowerId()).toBe(leftmost.id);
    });

    it("wraps left from leftmost tower to rightmost tower on same row", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 2, tileY: 5 },
        { tileX: 14, tileY: 5 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const leftmost = towers.find((t) => t.tileX === 2 && t.tileY === 5)!;
      const rightmost = towers.find((t) => t.tileX === 14 && t.tileY === 5)!;
      gameStore.selectedTower = leftmost as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(lastSelectedTowerId()).toBe(rightmost.id);
    });

    it("wraps up from topmost tower to bottommost tower on same column", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 5, tileY: 1 },
        { tileX: 5, tileY: 13 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const topmost = towers.find((t) => t.tileX === 5 && t.tileY === 1)!;
      const bottommost = towers.find((t) => t.tileX === 5 && t.tileY === 13)!;
      gameStore.selectedTower = topmost as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowUp");
      expect(lastSelectedTowerId()).toBe(bottommost.id);
    });

    it("wraps down from bottommost tower to topmost tower on same column", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 5, tileY: 1 },
        { tileX: 5, tileY: 13 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const topmost = towers.find((t) => t.tileX === 5 && t.tileY === 1)!;
      const bottommost = towers.find((t) => t.tileX === 5 && t.tileY === 13)!;
      gameStore.selectedTower = bottommost as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(lastSelectedTowerId()).toBe(topmost.id);
    });

    it("finds tower at x+1,y-2 when pressing down from (x,y)", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 5, tileY: 5 },
        { tileX: 6, tileY: 3 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const origin = towers.find((t) => t.tileX === 5 && t.tileY === 5)!;
      const offAxis = towers.find((t) => t.tileX === 6 && t.tileY === 3)!;
      gameStore.selectedTower = origin as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowDown");
      expect(lastSelectedTowerId()).toBe(offAxis.id);
    });

    it("finds tower at x-2,y+1 when pressing left from (x,y)", () => {
      gameStore.setState(GameState.PLAYING);
      const { engine, towers } = applyTowerSnapshot([
        { tileX: 10, tileY: 7 },
        { tileX: 8, tileY: 8 },
      ]);
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, engine.grid as unknown as Grid);
      const origin = towers.find((t) => t.tileX === 10 && t.tileY === 7)!;
      const offAxis = towers.find((t) => t.tileX === 8 && t.tileY === 8)!;
      gameStore.selectedTower = origin as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("ArrowLeft");
      expect(lastSelectedTowerId()).toBe(offAxis.id);
    });
  });

  describe("number keys 1-9 (build mode)", () => {
    it("key 1 activates first tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("1");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("key 2 activates second tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("2");
      expect(gameStore.selectedTowerType).toBe(TowerIds.ICE);
    });

    it("key 6 activates sixth tower build mode", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("6");
      expect(gameStore.selectedTowerType).toBe(TowerIds.RAILGUN);
    });

    it("key 7 selects sturdyWall (index 6)", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("7");
      expect(gameStore.selectedTowerType).toBe(TowerIds.STURDY_WALL);
    });

    it("key 9 wraps to first tower", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("9");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("non-digit keys are ignored", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("x");
      expect(gameStore.selectedTowerType).toBeNull();
    });
  });

  describe("Tab key (cycle)", () => {
    it("cycles build mode to next tower type", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.BASIC;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTowerType).toBe(TowerIds.ICE);
    });

    it("cycles from last tower back to first in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.SHOTGUN_TANK;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab");
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("cycles speed forward outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab");
      expect(gameStore.timeScale).toBe(2);
    });

    it("cycles speed from 8x back to 1x outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 8;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("Shift+Tab key (reverse cycle)", () => {
    it("cycles build mode to previous tower type", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = TowerIds.ICE;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.selectedTowerType).toBe(TowerIds.BASIC);
    });

    it("cycles speed reverse outside build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.timeScale).toBe(8);
    });

    it("cycles speed reverse from 2x to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 2;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Tab", { shiftKey: true });
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("Enter key (confirm dialog)", () => {
    it("executes confirm when dialog is active", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      uiStore.showConfirm({ title: "T", message: "M", onConfirm: () => {} });
      triggerInput("Enter");
      expect(uiStore.confirmDialog).toBeNull();
    });

    it("does nothing when no confirm dialog is active", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Enter");
      expect(gameStore.state).toBe(GameState.PLAYING);
    });

    it("attempts to build at hoverTile when in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      const grid = {
        width: 10,
        height: 10,
        tileToWorld: (tx: number, ty: number) => ({ x: tx * 36 + 18, y: ty * 36 + 18 }),
      };
      gameStore.initMap(0, { regionId: 0, tiles: [] } as unknown as GeneratedMap, grid as unknown as Grid);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Enter");
      const click = lastOfType("input:click");
      expect(click?.worldX).toBe(5 * 36 + 18);
      expect(click?.worldY).toBe(3 * 36 + 18);
    });

    it("does nothing when in build mode but hoverTile is null", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = "cannon";
      gameStore.hoverTile = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Enter");
      expect(dispatched("input:click")).toBe(false);
    });

    it("does nothing when not in build mode", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTowerType = null;
      gameStore.hoverTile = { tileX: 5, tileY: 3 };
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("Enter");
      expect(dispatched("input:click")).toBe(false);
    });
  });

  describe("d key (cycle speed forward)", () => {
    it("cycles timeScale forward", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("d");
      expect(gameStore.timeScale).toBe(2);
    });

    it("cycles from 8x back to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 8;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("d");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("w key (upgrade)", () => {
    it("dispatches upgradeSelected when tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = { id: 1 } as unknown as Tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("w");
      expect(dispatched("action:upgradeSelected")).toBe(true);
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("w");
      expect(dispatched("action:upgradeSelected")).toBe(false);
    });
  });

  describe("a key (cycle speed reverse)", () => {
    it("cycles timeScale reverse", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 1;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("a");
      expect(gameStore.timeScale).toBe(8);
    });

    it("cycles from 2x to 1x", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.timeScale = 2;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("a");
      expect(gameStore.timeScale).toBe(1);
    });
  });

  describe("f key (cycle targeting)", () => {
    it("cycles targeting mode on selected tower", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "first" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("f");
      expect(lastOfType("action:setTargeting")?.mode).toBe("last");
    });

    it("cycles through all targeting modes", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "last" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("f");
      expect(lastOfType("action:setTargeting")?.mode).toBe("closest");
    });

    it("wraps from furthest back to first", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1, targeting: "furthest" } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("f");
      expect(lastOfType("action:setTargeting")?.mode).toBe("first");
    });

    it("defaults to first when targeting is undefined", () => {
      gameStore.setState(GameState.PLAYING);
      const tower = { id: 1 } as unknown as Tower;
      gameStore.selectedTower = tower;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("f");
      expect(lastOfType("action:setTargeting")?.mode).toBe("last");
    });

    it("does nothing when no tower is selected", () => {
      gameStore.setState(GameState.PLAYING);
      gameStore.selectedTower = null;
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("f");
      expect(dispatched("action:setTargeting")).toBe(false);
    });
  });

  describe("unknown keys", () => {
    it("does nothing for unknown keys", () => {
      gameStore.setState(GameState.PLAYING);
      useInput(gameStore, dispatcher, uiStore);
      triggerInput("q");
      expect(dispatched("action:togglePause")).toBe(false);
      expect(dispatched("action:upgradeSelected")).toBe(false);
      expect(dispatched("action:sellSelected")).toBe(false);
      expect(dispatched("action:downgradeSelected")).toBe(false);
    });
  });
});
