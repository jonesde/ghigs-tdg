// @ts-nocheck
import { createPinia, setActivePinia } from "pinia";
import { getGameContent } from "@/content/gameContent.js";
import type { MapThemeData } from "@/render/themes/index.js";
import { DEFAULT_THEME_ID } from "@/render/themes/index.js";
import type { GameStateValue } from "@/sim/GameRunState.js";
import type { Grid } from "@/sim/grid/Grid.js";
import type { GeneratedMap } from "@/sim/grid/Map.js";
import type {
  ConfirmPayload,
  HostBindings,
  PersistStateSlice,
  SoundName,
  ThemeBundle,
  UiEvent,
} from "@/sim/HostBindings.js";
import type { PersistState } from "@/sim/PersistState.js";
import { createDefaultPersistState } from "@/sim/PersistState.js";
import { useGameStore } from "@/stores/game.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { usePersistStore } from "@/stores/persist.js";
import { useUiStore } from "@/stores/ui.js";
import { makeMockRegionMapLayout, mockRegionMapImage } from "./regionMap.js";

type GameStore = ReturnType<typeof useGameStore>;
type PersistStore = ReturnType<typeof usePersistStore>;
type UiStore = ReturnType<typeof useUiStore>;
type MapThemeStore = ReturnType<typeof useMapThemeStore>;

export const mockDefaultTheme: MapThemeData = {
  id: DEFAULT_THEME_ID,
  label: "Default",
  towers: {
    basic: {
      name: "Rifle Tower",
      color: "#8fbc8f",
      icon: "\u2500",
      animation: {
        duration: 0.3,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
      walking: {
        duration: 0.6,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
    },
  },
  enemies: {
    minion: {
      name: "Minion",
      color: "#e85a6a",
      shape: "circle",
      walking: {
        duration: 0.784,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
      hitReaction: {
        duration: 0.12,
        referenceImages: [{ svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }],
      },
    },
  },
  spawns: { closed: "<svg></svg>", open: "<svg></svg>", transition: "<svg></svg>" },
  regions: [
    {
      id: 0,
      name: "Verdant Marches",
      tiles: {
        path: ["<svg></svg>"],
        terrain1: ["<svg></svg>"],
        terrain2: ["<svg></svg>"],
        terrain3: ["<svg></svg>"],
        terrain4: ["<svg></svg>"],
      },
      base: "",
      mapImage: mockRegionMapImage,
      mapLayout: makeMockRegionMapLayout(),
    },
    {
      id: 1,
      name: "Sunscorch Coast",
      tiles: {
        path: ["<svg></svg>"],
        terrain1: ["<svg></svg>"],
        terrain2: ["<svg></svg>"],
        terrain3: ["<svg></svg>"],
        terrain4: ["<svg></svg>"],
      },
      base: "",
      mapImage: mockRegionMapImage,
      mapLayout: makeMockRegionMapLayout(),
    },
    {
      id: 2,
      name: "Thornpeak Wilds",
      tiles: {
        path: ["<svg></svg>"],
        terrain1: ["<svg></svg>"],
        terrain2: ["<svg></svg>"],
        terrain3: ["<svg></svg>"],
        terrain4: ["<svg></svg>"],
      },
      base: "",
      mapImage: mockRegionMapImage,
      mapLayout: makeMockRegionMapLayout(),
    },
  ],
};

export function createTestGameStore(): GameStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useGameStore();
}

export function createTestPersistStore(): PersistStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = usePersistStore();
  store.$reset();
  return store;
}

export function createTestUiStore(): UiStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useUiStore();
}

export function createTestMapThemeStore(): MapThemeStore {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useMapThemeStore();
  store.activeThemeId = DEFAULT_THEME_ID as MapThemeStore["activeThemeId"];
  store.defaultTheme = mockDefaultTheme;
  store.activeTheme = mockDefaultTheme;
  return store;
}

export class MockHostBindings implements HostBindings {
  soundsPlayed: SoundName[] = [];
  uiEvents: UiEvent[] = [];
  persistSaves: PersistStateSlice[] = [];
  confirmPayloads: ConfirmPayload[] = [];
  confirmResult: boolean = true;

  playSound(name: SoundName): void {
    this.soundsPlayed.push(name);
  }
  notifyUi(event: UiEvent): void {
    this.uiEvents.push(event);
  }
  schedulePersistSave(state: PersistStateSlice): void {
    this.persistSaves.push(state);
  }
  syncGridTower(_x: number, _y: number, _placed: boolean): void {}
  requestConfirm(payload: ConfirmPayload): Promise<boolean> {
    this.confirmPayloads.push(payload);
    return Promise.resolve(this.confirmResult);
  }
}

export function createTestStores(): { game: GameStore; persist: PersistStore; ui: UiStore } {
  const pinia = createPinia();
  setActivePinia(pinia);
  const game = useGameStore();
  (game as unknown as Record<string, unknown>).initMap = vi.fn(
    (mapIndex: number, mapData: GeneratedMap, grid: Grid | null) => {
      game.mapIndex = mapIndex;
      game.map = mapData;
      game.grid = grid;
      game.baseHealth = getGameContent().economy.startingBaseHealth;
      game.maxBaseHealth = 100;
      game.gold = getGameContent().economy.startingGoldByRegion[mapData.regionId];
      game.currentWave = 0;
      game.milestoneRewardsClaimed = {};
      game.selectedTower = null;
      game.selectedTowerType = null;
    },
  );
  (game as unknown as Record<string, unknown>).togglePause = vi.fn(() => {
    if (game.state === "playing") game.state = "paused";
    else if (game.state === "paused") game.state = "playing";
  });
  (game as unknown as Record<string, unknown>).setState = vi.fn((newState: GameStateValue) => {
    game.state = newState;
  });
  return { game: game as GameStore, persist: usePersistStore(), ui: useUiStore() };
}

export function createTestThemeBundle(theme: MapThemeData | null = null): ThemeBundle {
  return { active: theme, defaultTowerVisuals: {}, defaultEnemyVisuals: {} };
}

export function createTestPersistState(): PersistState {
  return createDefaultPersistState();
}
