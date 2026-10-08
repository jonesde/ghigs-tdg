// @ts-nocheck
/** @vitest-environment node */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { Grid } from "@/sim/grid/Grid.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { TowerManager } from "@/sim/towers/TowerManager.js";
import { useMapThemeStore } from "@/stores/mapTheme.js";
import { makeBastionMap } from "../helpers/mock-grid";
import { makeParticleSystem, makeSoundManager } from "../helpers/mock-managers";
import { mockDefaultTheme } from "../helpers/mock-stores.js";

type TowerId = "basic" | "ice" | "sniper" | "cannon" | "lightning" | "railgun";

interface UnlockedState {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

interface SaveFixture {
  gems: number;
  unlocked: Record<TowerId, UnlockedState>;
  generalAddons: Record<string, unknown>;
}

function makeSave(): SaveFixture {
  return {
    gems: 99999,
    unlocked: {
      basic: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      ice: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      sniper: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      cannon: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      lightning: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
      railgun: {
        levels: [true, true, true, true, true, true, true],
        variantA: [true, true, true],
        variantB: [true, true, true],
        addons: [true, true, true],
      },
    },
    generalAddons: {
      extraHealth: null,
      startingGold: null,
      sellRefundUnlocked: false,
      sellDiscountUnlocked: false,
      sellActive: null,
      upgradeCostReduction: null,
      terrainHeightBonus: null,
      damageMilestoneBonus: null,
      progressiveThirdChoice: null,
    },
  };
}

describe("TowerManager", () => {
  let manager: TowerManager;
  let grid: Grid;
  let particles: ReturnType<typeof makeParticleSystem>;
  let sound: ReturnType<typeof makeSoundManager>;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const themeStore = useMapThemeStore();
    themeStore.defaultTheme = mockDefaultTheme;
    themeStore.activeTheme = mockDefaultTheme;

    const map = makeBastionMap();
    const realGrid = new Grid(map);
    grid = realGrid;

    particles = makeParticleSystem();
    sound = makeSoundManager();
    const projectiles = { spawn: () => {}, fireLightning: () => {}, spawnLightningFlash: () => {} };
    manager = new TowerManager(realGrid, particles, projectiles, sound);
  });

  it("starts with no towers", () => {
    expect(manager.towers).toHaveLength(0);
  });

  describe("build", () => {
    it("builds a tower on a valid terrain tile", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(tower.type).toBe("basic");
      expect(tower.tileX).toBe(0);
      expect(tower.tileY).toBe(0);
      expect(manager.towers).toHaveLength(1);
    });

    it("returns null when canBuild returns false", () => {
      // Base tile should not be buildable
      const tower = manager.build("basic", grid.base.x, grid.base.y, makeSave(), grid);
      expect(tower).toBeNull();
    });

    it("registers the tower on the grid", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      // For terrain tiles, should be in terrainTowers
      expect(grid.terrainTowers.has("0,0")).toBe(true);
    });

    it("spawns particles at tower position", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[0].x).toBe(0 * 36 + 18);
      expect(particles.spawns[0].y).toBe(0 * 36 + 18);
    });

    it("plays place sound", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(sound.plays).toContain("place");
    });

    it("does not consume a tower ID when grid registration fails", () => {
      let allowRegister = false;
      const stubGrid = {
        tileSize: 36,
        canBuild: () => true,
        registerTower: () => allowRegister,
        unregisterTower: () => true,
        getBase: () => ({ x: 0, y: 0 }),
        tileToWorld: (tileX: number, tileY: number) => ({ x: tileX * 36 + 18, y: tileY * 36 + 18 }),
        worldToTile: (worldX: number, worldY: number) => ({ x: Math.floor(worldX / 36), y: Math.floor(worldY / 36) }),
      } as unknown as Grid;
      const stubProjectiles = { spawn: () => {}, fireLightning: () => {}, spawnLightningFlash: () => {} };
      const stubManager = new TowerManager(stubGrid, particles, stubProjectiles, sound);
      // Registration fails: build should return null and must NOT burn an ID.
      allowRegister = false;
      const failed = stubManager.build("basic", 0, 0, makeSave(), stubGrid);
      expect(failed).toBeNull();
      // Now registration succeeds: the first successful build must get id 'tower-1'.
      allowRegister = true;
      const tower = stubManager.build("basic", 0, 0, makeSave(), stubGrid) as Tower;
      expect(tower.id).toBe("tower-1");
    });

    it("can build multiple towers on different tiles", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      manager.build("basic", 1, 0, makeSave(), grid);
      manager.build("basic", 2, 0, makeSave(), grid);
      expect(manager.towers).toHaveLength(3);
    });
  });

  describe("sell", () => {
    it("removes tower from manager and grid", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(manager.towers).toHaveLength(1);
      const _val = manager.sell(tower, makeSave());
      expect(manager.towers).toHaveLength(0);
      expect(grid.terrainTowers.has("0,0")).toBe(false);
    });

    it("does not compute a sell value itself (credit is decided by the engine)", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      const val = manager.sell(tower, makeSave());
      expect(val).toBeUndefined();
      // The authoritative sell value still lives on the tower.
      expect(tower.sellValue()).toBe(Math.round(tower.totalInvested * getGameContent().towers.tuning.sellValueRatio));
    });

    it("spawns sell particles", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.sell(tower, makeSave());
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[particles.spawns.length - 1].color).toBe("#ffcf4d");
    });

    it("plays sell sound", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.sell(tower, makeSave());
      expect(sound.plays).toContain("sell");
    });
  });

  describe("cancelBuild", () => {
    it("removes tower from manager and grid", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(manager.towers).toHaveLength(1);
      const refund = manager.cancelBuild(tower);
      expect(manager.towers).toHaveLength(0);
      expect(grid.terrainTowers.has("0,0")).toBe(false);
      expect(refund).toBe(tower.totalInvested);
    });

    it("spawns cancel particles", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.cancelBuild(tower);
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[particles.spawns.length - 1].color).toBe("#88ff88");
    });

    it("plays cancel sound", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      manager.cancelBuild(tower);
      expect(sound.plays).toContain("cancel");
    });
  });

  describe("downgradeTower", () => {
    it("reduces tower level by 1", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      // Upgrade to level 2 first
      tower.doUpgrade(makeSave(), tower.upgradeCost(2));
      expect(tower.level).toBe(2);
      const beforeInvested = tower.totalInvested;
      const delta = manager.downgradeTower(tower);
      expect(tower.level).toBe(1);
      expect(delta).toBe(beforeInvested - tower.totalInvested);
    });

    it("resets variant when downgrading from specialized tower (level 5)", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      for (let i = 0; i < 3; i++) {
        tower.doUpgrade(makeSave(), tower.upgradeCost(i + 2));
      }
      tower.specialize("A", makeSave(), tower.upgradeCost(5));
      expect(tower.level).toBe(5);
      expect(tower.variant).toBe("A");
      const beforeInvested = tower.totalInvested;
      const delta = manager.downgradeTower(tower);
      expect(tower.level).toBe(4);
      expect(tower.variant).toBeNull();
      expect(delta).toBe(beforeInvested - tower.totalInvested);
    });

    it("returns the upgrade cost delta", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      const costToLevel2 = tower.upgradeCost(2);
      tower.doUpgrade(makeSave(), costToLevel2);
      expect(tower.level).toBe(2);
      const delta = manager.downgradeTower(tower);
      expect(delta).toBe(costToLevel2);
    });

    it("spawns downgrade particles", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      tower.doUpgrade(makeSave(), tower.upgradeCost(2));
      manager.downgradeTower(tower);
      expect(particles.spawns.length).toBeGreaterThan(0);
      expect(particles.spawns[particles.spawns.length - 1].color).toBe("#ffd060");
    });

    it("does not go below totalInvested zero", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      expect(tower.level).toBe(1);
      manager.downgradeTower(tower);
      expect(tower.totalInvested).toBeGreaterThanOrEqual(0);
    });

    it("removes the highest level cost when downgrading a specialized high-level tower (C4)", () => {
      const tower = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      for (let i = 0; i < 3; i++) {
        tower.doUpgrade(makeSave(), tower.upgradeCost(i + 2));
      }
      tower.specialize("A", makeSave(), tower.upgradeCost(5));
      tower.doUpgrade(makeSave(), tower.upgradeCost(6));
      tower.doUpgrade(makeSave(), tower.upgradeCost(7));
      expect(tower.level).toBe(7);
      const level7Cost = tower.upgradeCost(7);
      const investedBefore = tower.totalInvested;
      const delta = manager.downgradeTower(tower);
      expect(tower.level).toBe(6);
      expect(delta).toBe(level7Cost);
      expect(tower.totalInvested).toBe(investedBefore - level7Cost);
      // The specialization cost must still be present; only the last level cost was popped.
      expect(tower.levelCosts).toContain(tower.upgradeCost(5));
    });
  });

  describe("towerAt", () => {
    it("returns the tower at the given grid coords", () => {
      const tower = manager.build("basic", 3, 2, makeSave(), grid);
      expect(manager.towerAt(3, 2)).toBe(tower);
    });

    it("returns null when no tower at coords", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(manager.towerAt(5, 5)).toBeFalsy();
    });

    it("returns null for out-of-bounds coords", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      expect(manager.towerAt(-1, -1)).toBeFalsy();
    });
  });

  describe("shiftLayoutIndices", () => {
    it("re-keys tileMap when towers sit one shift apart", () => {
      const first = manager.build("basic", 0, 0, makeSave(), grid) as Tower;
      const second = manager.build("basic", 5, 0, makeSave(), grid) as Tower;
      manager.shiftLayoutIndices(5, 0);
      expect(first.tileX).toBe(5);
      expect(first.tileY).toBe(0);
      expect(second.tileX).toBe(10);
      expect(second.tileY).toBe(0);
      expect(manager.towerAt(5, 0)).toBe(first);
      expect(manager.towerAt(10, 0)).toBe(second);
      expect(manager.towerAt(0, 0)).toBeUndefined();
      expect(manager.towers).toHaveLength(2);
    });

    it("is a no-op for a zero shift", () => {
      const tower = manager.build("basic", 3, 2, makeSave(), grid) as Tower;
      manager.shiftLayoutIndices(0, 0);
      expect(tower.tileX).toBe(3);
      expect(tower.tileY).toBe(2);
      expect(manager.towerAt(3, 2)).toBe(tower);
    });
  });

  describe("clear", () => {
    it("removes all towers", () => {
      manager.build("basic", 0, 0, makeSave(), grid);
      manager.build("basic", 1, 0, makeSave(), grid);
      manager.clear();
      expect(manager.towers).toHaveLength(0);
    });
  });
});
