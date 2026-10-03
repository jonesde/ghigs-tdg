import { describe, expect, it } from "vitest";
import { type ClickEffectInput, clickHasEffect } from "@/render/svg/clickHasEffect.js";

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

  it("cancels build mode on an out-of-bounds press and ignores one without it", () => {
    expect(clickHasEffect(input({ inBounds: false, selectedTowerType: "basic" }))).toBe(true);
    expect(clickHasEffect(input({ inBounds: false }))).toBe(false);
  });
});
