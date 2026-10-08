// @ts-nocheck
/** @vitest-environment node */

// The tower pack carries four parallel id-keyed tables. src/sim/towers/Tower.ts
// indexes all four by tower id, so a missing key in any one of them fails at
// runtime on that tower only. The pack used to carry an `ids` array that read like
// a guard for this; nothing read it, and TowerIds in src/content/towerIds.ts is
// the vocabulary the code actually enumerates.

import { describe, expect, it } from "vitest";
import { getGameContent } from "@/content/gameContent.js";
import { TowerIds } from "@/content/towerIds.js";

describe("tower content pack id sets", () => {
  const towerTables = getGameContent().towers;

  it("gives meta, base, variants, and addonEffects the same id set", () => {
    const metaIds = Object.keys(towerTables.meta).sort();
    expect(Object.keys(towerTables.base).sort()).toEqual(metaIds);
    expect(Object.keys(towerTables.variants).sort()).toEqual(metaIds);
    expect(Object.keys(towerTables.addonEffects).sort()).toEqual(metaIds);
  });

  it("uses exactly the ids in TowerIds, with nothing missing or extra", () => {
    const expectedIds = Object.values(TowerIds).sort();
    expect(expectedIds).toHaveLength(8);
    expect(Object.keys(towerTables.meta).sort()).toEqual(expectedIds);
  });
});
