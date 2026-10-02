/** @vitest-environment node */
import { beforeEach, describe, expect, it } from "vitest";
import { Enemy, resetEnemyId } from "@/sim/enemies/Enemy.js";
import { selectTargetingTower, type TargetingTower } from "@/sim/enemies/targeting.js";
import { Grid } from "@/sim/grid/Grid.js";
import type { Tower } from "@/sim/towers/Tower.js";
import { makeBastionMap } from "../../helpers/mock-grid";

interface FakeTower extends TargetingTower {
  isGhost: boolean;
}

function tower(tileX: number, tileY: number, health: number, isGhost = false): FakeTower {
  return { tileX, tileY, health, isGhost };
}

function distanceByColumn(tileX: number): number {
  if (tileX === 1) return -1;
  return 10 - tileX;
}

describe("selectTargetingTower", () => {
  it("breaks nearest ties by smaller tileY, then smaller tileX", () => {
    const sameDistance = [tower(2, 2, 1), tower(0, 2, 1)];
    expect(selectTargetingTower("nearest", 1, 2, 0, sameDistance, () => 0)).toBe(sameDistance[1]);
    const sameColumn = [tower(1, 3, 1), tower(1, 1, 1)];
    expect(selectTargetingTower("nearest", 1, 2, 0, sameColumn, () => 0)).toBe(sameColumn[1]);
  });

  it("picks the highest health for strongest and the lowest for weakest", () => {
    const towers = [tower(1, 1, 10), tower(8, 8, 40), tower(3, 3, 5)];
    expect(selectTargetingTower("strongest", 0, 0, 0, towers, () => 0)).toBe(towers[1]);
    expect(selectTargetingTower("weakest", 0, 0, 0, towers, () => 0)).toBe(towers[2]);
  });

  it("limits strongestAhead to towers strictly closer on the nav field", () => {
    const terrain = tower(1, 0, 100);
    const behind = tower(4, 0, 80);
    const fartherAhead = tower(8, 0, 20);
    const closerAhead = tower(7, 0, 30);
    const towers = [terrain, behind, fartherAhead, closerAhead];
    const chosen = selectTargetingTower("strongestAhead", 5, 0, distanceByColumn(5), towers, distanceByColumn);
    expect(chosen).toBe(closerAhead);
    expect(selectTargetingTower("strongestAhead", 5, 0, distanceByColumn(5), [terrain, behind], distanceByColumn)).toBe(
      null,
    );
  });

  it("returns null for base, default, unknown modes, and an empty candidate set", () => {
    const towers = [tower(2, 2, 10)];
    expect(selectTargetingTower("base", 0, 0, 0, towers, () => 0)).toBeNull();
    expect(selectTargetingTower("default", 0, 0, 0, towers, () => 0)).toBeNull();
    expect(selectTargetingTower("mystery", 0, 0, 0, towers, () => 0)).toBeNull();
    expect(selectTargetingTower(null, 0, 0, 0, towers, () => 0)).toBeNull();
    expect(selectTargetingTower("nearest", 0, 0, 0, [], () => 0)).toBeNull();
  });
});

describe("Enemy computeIntent engagement policy", () => {
  let grid: Grid;
  let enemy: Enemy;

  beforeEach(() => {
    resetEnemyId();
    grid = new Grid(makeBastionMap());
    enemy = new Enemy("minion", 1, 0, grid, 1);
  });

  function policyManager(towers: FakeTower[]) {
    return {
      liveTowers: () => towers.filter((entry) => !entry.isGhost && entry.health > 0) as unknown as Tower[],
      distanceToBase: (tileX: number) => distanceByColumn(tileX),
      throughDistanceToBase: (tileX: number) => distanceByColumn(tileX),
      throughBlockers: () => [],
      blockedApproach: () => null,
    } as unknown as Parameters<Enemy["computeIntent"]>[1];
  }

  it("sieges the higher-health tower for strongest", () => {
    const weaker = tower(2, 3, 10);
    const stronger = tower(5, 3, 40);
    enemy.targetingMode = "strongest";
    enemy.computeIntent(0.016, policyManager([weaker, stronger]));
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).toBe(stronger);
  });

  it("releases a siege for base and does not auto-siege incidental contact", () => {
    const parked = tower(4, 3, 20);
    const blocker = tower(3, 3, 20);
    enemy.targetingMode = "base";
    enemy.routingMode = "siege";
    enemy.siegeTower = parked as unknown as Tower;
    enemy.blockedByTower = blocker as unknown as Tower;
    enemy.breachCooldownSeconds = 0;
    enemy.computeIntent(0.016, policyManager([parked, blocker]));
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
    enemy.blockedByTower = blocker as unknown as Tower;
    enemy.breachCooldownSeconds = 0;
    enemy.computeIntent(0.016, policyManager([parked, blocker]));
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
  });

  it("snaps a terrain tower onto a closer path tile for strongestAhead", () => {
    const ahead = tower(5, 1, 40);
    enemy.targetingMode = "strongestAhead";
    enemy.computeIntent(0.016, policyManager([ahead]));
    expect(enemy.routingMode).toBe("siege");
    expect(enemy.siegeTower).toBe(ahead);
  });

  it("rejects a terrain tower whose snapped distance is not closer", () => {
    const notAhead = tower(1, 1, 80);
    enemy.targetingMode = "strongestAhead";
    enemy.computeIntent(0.016, policyManager([notAhead]));
    expect(enemy.routingMode).toBe("default");
    expect(enemy.siegeTower).toBeNull();
  });

  it("keeps an explicit hold while a tower-pick policy is stored", () => {
    const stronger = tower(5, 3, 40);
    enemy.routingMode = "hold";
    enemy.holdWorld = { x: enemy.x, y: enemy.y };
    enemy.targetingMode = "strongest";
    enemy.computeIntent(0.016, policyManager([stronger]));
    expect(enemy.routingMode).toBe("hold");
    expect(enemy.siegeTower).toBeNull();
  });
});
