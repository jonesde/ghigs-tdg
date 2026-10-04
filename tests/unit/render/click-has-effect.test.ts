import { describe, expect, it } from "vitest";
import {
  type ClickEffectInput,
  clickHasEffect,
  decideRightClickAction,
  RIGHT_CLICK_MAX_DRAG_PX,
  rightPressIsClick,
} from "@/render/svg/clickHasEffect.js";

function input(overrides: Partial<ClickEffectInput> = {}): ClickEffectInput {
  return {
    progressivePlacementHold: false,
    placementSiteHit: false,
    upgradeButtonHit: false,
    inBounds: true,
    towerOnTile: false,
    baseTile: false,
    selectedTowerType: null,
    buildable: true,
    gold: 100,
    buildCost: 50,
    ...overrides,
  };
}

describe("clickHasEffect", () => {
  it("always acts while a block placement hold is open", () => {
    expect(clickHasEffect(input({ progressivePlacementHold: true }))).toBe(true);
    expect(clickHasEffect(input({ progressivePlacementHold: true, inBounds: false }))).toBe(true);
  });

  it("acts on a legal placement site and the upgrade button", () => {
    expect(clickHasEffect(input({ placementSiteHit: true }))).toBe(true);
    expect(clickHasEffect(input({ upgradeButtonHit: true }))).toBe(true);
  });

  it("acts on a tower in both modes", () => {
    expect(clickHasEffect(input({ towerOnTile: true }))).toBe(true);
    expect(clickHasEffect(input({ towerOnTile: true, selectedTowerType: "basic" }))).toBe(true);
  });

  it("acts on a base tile in both modes", () => {
    expect(clickHasEffect(input({ baseTile: true, buildable: false }))).toBe(true);
    expect(clickHasEffect(input({ baseTile: true, selectedTowerType: "basic", buildable: false }))).toBe(true);
  });

  it("builds on an in-bounds buildable tile the gold covers", () => {
    expect(clickHasEffect(input({ selectedTowerType: "basic", gold: 50 }))).toBe(true);
    expect(clickHasEffect(input({ selectedTowerType: "basic", gold: 49 }))).toBe(false);
    expect(clickHasEffect(input({ selectedTowerType: "basic", buildable: false }))).toBe(false);
  });

  it("ignores an empty in-bounds tile without build mode", () => {
    expect(clickHasEffect(input())).toBe(false);
  });

  it("acts on a supply drop or cache even when the tile would otherwise pan", () => {
    expect(clickHasEffect(input({ packageHit: true, buildable: false }))).toBe(true);
    expect(clickHasEffect(input({ packageHit: true, inBounds: false }))).toBe(true);
  });

  it("cancels build mode on an out-of-bounds press and ignores one without it", () => {
    expect(clickHasEffect(input({ inBounds: false, selectedTowerType: "basic" }))).toBe(true);
    expect(clickHasEffect(input({ inBounds: false }))).toBe(false);
  });
});

describe("decideRightClickAction", () => {
  it("exits build mode first, keeping any tower selection", () => {
    expect(decideRightClickAction(true, false)).toBe("cancelBuild");
    expect(decideRightClickAction(true, true)).toBe("cancelBuild");
  });

  it("deselects a tower or the base when build mode is not active", () => {
    expect(decideRightClickAction(false, true)).toBe("deselect");
  });

  it("does nothing with nothing to exit", () => {
    expect(decideRightClickAction(false, false)).toBeNull();
  });
});

describe("rightPressIsClick", () => {
  it("treats an unmoved press as a click", () => {
    expect(rightPressIsClick(100, 200, 100, 200)).toBe(true);
  });

  it("treats sub-threshold motion as a click and past-threshold motion as a drag", () => {
    expect(rightPressIsClick(0, 0, RIGHT_CLICK_MAX_DRAG_PX, 0)).toBe(true);
    expect(rightPressIsClick(0, 0, RIGHT_CLICK_MAX_DRAG_PX + 1, 0)).toBe(false);
    expect(rightPressIsClick(0, 0, 3, 4)).toBe(true);
    expect(rightPressIsClick(0, 0, 4, 4)).toBe(false);
  });
});
