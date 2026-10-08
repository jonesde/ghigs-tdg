import { getGameContent } from "@/content/gameContent.js";
import type { TowerVisualMeta } from "@/render/themes/index.js";
import { GENERAL_ADDON_GEM_COSTS, SELL_OPTION_GEM_COST } from "@/sim/Constants.js";
import { TowerIds } from "@/sim/ConstantsTower.js";
import type { PersistState } from "@/sim/PersistState.js";

const skillTreeContent = getGameContent().skillTree;
const LEVEL_COSTS = skillTreeContent.levelCosts;
const ADDON_COSTS = skillTreeContent.addonCosts;

interface SkillNode {
  tier: string;
  index: number;
  label: string;
  cost: number;
  desc: string;
}

interface TowerSkillTree {
  name: string;
  color: string;
  icon: string;
  levels: SkillNode[];
  variantA: SkillNode[];
  variantB: SkillNode[];
  addons: SkillNode[];
}

interface GeneralAddonDef {
  key: string;
  label: string;
  desc: string;
  tiers: { label: string; desc: string }[];
  costs: readonly number[];
  isSellOption?: boolean;
}

interface GeneralAddonCategory {
  label: string;
  addons: string[];
}

export const SKILL_TREE: Record<string, TowerSkillTree> = {};

const NEUTRAL_DISPLAY = { name: "", color: "#8fbc8f", icon: "\u2500" };

export function populateSkillTreeTheme(defaultTowerVisuals: Record<string, TowerVisualMeta>): void {
  for (const id of Object.values(TowerIds)) {
    const visual = defaultTowerVisuals[id];
    if (!visual) continue;
    const entry = SKILL_TREE[id];
    if (!entry) continue;
    entry.name = visual.name;
    entry.color = visual.color;
    entry.icon = visual.icon;
  }
}

export const VARIANT_INFO: Record<string, { A: { name: string; desc: string }; B: { name: string; desc: string } }> =
  skillTreeContent.variantInfo;

const ADDON_INFO: Record<string, { name: string; desc: string }[]> = skillTreeContent.addonInfo;

for (const id of Object.values(TowerIds)) {
  const variantA = VARIANT_INFO[id]!.A;
  const variantB = VARIANT_INFO[id]!.B;
  const addonDefs = ADDON_INFO[id]!;
  SKILL_TREE[id] = {
    name: NEUTRAL_DISPLAY.name,
    color: NEUTRAL_DISPLAY.color,
    icon: NEUTRAL_DISPLAY.icon,
    levels: [
      { tier: "level", index: 2, label: "Level 3", cost: LEVEL_COSTS[2]!, desc: "Unlock upgrade to level 3." },
      { tier: "level", index: 3, label: "Level 4", cost: LEVEL_COSTS[3]!, desc: "Unlock upgrade to level 4." },
    ],
    variantA: [
      { tier: "variantA", index: 0, label: `${variantA.name} 1`, cost: LEVEL_COSTS[4]!, desc: variantA.desc },
      {
        tier: "variantA",
        index: 1,
        label: `${variantA.name} 2`,
        cost: LEVEL_COSTS[5]!,
        desc: `${variantA.name} 2 upgrade (level 6).`,
      },
      {
        tier: "variantA",
        index: 2,
        label: `${variantA.name} 3`,
        cost: LEVEL_COSTS[6]!,
        desc: `${variantA.name} 3 final mastery (level 7).`,
      },
    ],
    variantB: [
      { tier: "variantB", index: 0, label: `${variantB.name} 1`, cost: LEVEL_COSTS[4]!, desc: variantB.desc },
      {
        tier: "variantB",
        index: 1,
        label: `${variantB.name} 2`,
        cost: LEVEL_COSTS[5]!,
        desc: `${variantB.name} 2 upgrade (level 6).`,
      },
      {
        tier: "variantB",
        index: 2,
        label: `${variantB.name} 3`,
        cost: LEVEL_COSTS[6]!,
        desc: `${variantB.name} 3 final mastery (level 7).`,
      },
    ],
    addons: [
      { tier: "addons", index: 0, label: addonDefs[0]!.name, cost: ADDON_COSTS[0]!, desc: addonDefs[0]!.desc },
      { tier: "addons", index: 1, label: addonDefs[1]!.name, cost: ADDON_COSTS[1]!, desc: addonDefs[1]!.desc },
      { tier: "addons", index: 2, label: addonDefs[2]!.name, cost: ADDON_COSTS[2]!, desc: addonDefs[2]!.desc },
    ],
  };
}

function getCost(tier: string, index: number): number {
  if (tier === "level") return LEVEL_COSTS[index] || 0;
  if (tier === "variantA" || tier === "variantB") return LEVEL_COSTS[index + 4] || 0;
  if (tier === "addons") return ADDON_COSTS[index] || 0;
  return 0;
}

export function isUnlocked(save: PersistState, towerId: string, tier: string, index: number): boolean {
  const unlocked = save.unlocked[towerId];
  if (!unlocked) return false;
  if (tier === "level") return !!unlocked.levels[index];
  if (tier === "variantA") return !!unlocked.variantA[index];
  if (tier === "variantB") return !!unlocked.variantB[index];
  if (tier === "addons") return !!unlocked.addons[index];
  return false;
}

// Shared tower-unlock precondition chain for isAvailable/tryUnlock, so the two
// cannot drift. Returns the first failing reason; caller handles gems and the
// already-unlocked case. Assumes the tower entry may be missing.
function checkTowerUnlockPreconditions(
  save: PersistState,
  towerId: string,
  tier: string,
  index: number,
): { ok: true } | { ok: false; reason: string } {
  const unlocked = save.unlocked[towerId];
  if (!unlocked) return { ok: false, reason: "Tower not found" };
  if (!unlocked.levels || !unlocked.variantA || !unlocked.variantB) return { ok: false, reason: "Invalid save data" };
  if (tier === "level" && index >= 3 && !unlocked.levels[index - 1]) {
    return { ok: false, reason: "Unlock previous level first" };
  }
  if (tier === "variantA" && index > 0 && !unlocked.variantA[index - 1]) {
    return { ok: false, reason: "Unlock previous tier first" };
  }
  if (tier === "variantB" && index > 0 && !unlocked.variantB[index - 1]) {
    return { ok: false, reason: "Unlock previous tier first" };
  }
  if ((tier === "variantA" || tier === "variantB") && index === 0 && !unlocked.levels[3]) {
    return { ok: false, reason: "Unlock level 4 first" };
  }
  return { ok: true };
}

export function isAvailable(save: PersistState, towerId: string, tier: string, index: number, cost: number): boolean {
  if (isUnlocked(save, towerId, tier, index)) return true;
  if (save.gems < cost) return false;
  return checkTowerUnlockPreconditions(save, towerId, tier, index).ok;
}

export function unlockCost(tier: string, index: number): number {
  return getCost(tier, index);
}

export function canRefund(save: PersistState, towerId: string, tier: string, index: number): number {
  if (!isUnlocked(save, towerId, tier, index)) return 0;
  const unlocked = save.unlocked[towerId]!;

  if (tier === "level") {
    for (let j = index + 1; j < unlocked.levels.length; j++) {
      if (unlocked.levels[j]) return 0;
    }
    if (index === 3 && (unlocked.variantA.some(Boolean) || unlocked.variantB.some(Boolean))) return 0;
  } else {
    const key = tier === "addons" ? "addons" : tier === "variantA" ? "variantA" : "variantB";
    const arr = unlocked[key];
    for (let j = index + 1; j < arr.length; j++) {
      if (arr[j]) return 0;
    }
  }

  return getCost(tier, index);
}

export function tryRefund(save: PersistState, towerId: string, tier: string, index: number) {
  const refundAmount = canRefund(save, towerId, tier, index);
  if (refundAmount === 0) return { ok: false, reason: "Cannot refund: dependent unlocks active" };
  const unlocked = save.unlocked[towerId]!;
  const key =
    tier === "addons" ? "addons" : tier === "variantA" ? "variantA" : tier === "variantB" ? "variantB" : "levels";
  unlocked[key][index] = false;
  save.gems += refundAmount;
  return { ok: true, gems: refundAmount };
}

export function tryUnlock(save: PersistState, towerId: string, tier: string, index: number) {
  if (isUnlocked(save, towerId, tier, index)) return { ok: false, reason: "Already unlocked" };
  const cost = getCost(tier, index);
  if (save.gems < cost) return { ok: false, reason: "Not enough gems" };

  const precondition = checkTowerUnlockPreconditions(save, towerId, tier, index);
  if (!precondition.ok) return precondition;

  const unlocked = save.unlocked[towerId]!;
  save.gems -= cost;
  if (tier === "level") unlocked.levels[index] = true;
  else if (tier === "variantA") unlocked.variantA[index] = true;
  else if (tier === "variantB") unlocked.variantB[index] = true;
  else if (tier === "addons") unlocked.addons[index] = true;
  return { ok: true };
}

export function maxLevelFor(save: PersistState, towerId: string, variant: "A" | "B" | null): number {
  const unlocked = save.unlocked[towerId]!;
  let max = 2;
  if (unlocked.levels[2]) max = 3;
  if (unlocked.levels[3]) max = 4;
  if (variant === "A" || variant === "B") {
    const arr = variant === "A" ? unlocked.variantA : unlocked.variantB;
    let extra = 0;
    for (let i = 0; i < 3; i++)
      if (arr[i]) extra++;
      else break;
    max = 4 + extra;
  }
  return max;
}

export const GENERAL_ADDON_CATEGORIES: Record<string, GeneralAddonCategory> = skillTreeContent.generalAddonCategories;

export const BASE_LEVEL_COUNT = 7;

export const BASE_LEVEL_NODES: { index: number; label: string; desc: string; cost: number }[] =
  skillTreeContent.baseLevels.map((node, index) => ({
    index,
    label: node.label,
    desc: node.desc,
    cost: LEVEL_COSTS[index] ?? 0,
  }));

function baseLevelCost(index: number): number {
  return LEVEL_COSTS[index] ?? 0;
}

export function isBaseUnlocked(save: PersistState, index: number): boolean {
  if (index < 0 || index >= BASE_LEVEL_COUNT) return false;
  const levels = save.baseUnlocks?.levels;
  if (!levels) return index < 2;
  return !!levels[index];
}

// Shared base-level precondition for isBaseAvailable/tryUnlockBase. Index 0 and 1
// are free. Index 2 and above require the previous index.
function checkBaseUnlockPreconditions(save: PersistState, index: number): { ok: true } | { ok: false; reason: string } {
  if (index < 0 || index >= BASE_LEVEL_COUNT) return { ok: false, reason: "Invalid base level" };
  if (index >= 2 && !isBaseUnlocked(save, index - 1)) {
    return { ok: false, reason: "Unlock previous level first" };
  }
  return { ok: true };
}

export function isBaseAvailable(save: PersistState, index: number): boolean {
  if (isBaseUnlocked(save, index)) return true;
  if (save.gems < baseLevelCost(index)) return false;
  return checkBaseUnlockPreconditions(save, index).ok;
}

export function tryUnlockBase(save: PersistState, index: number) {
  if (isBaseUnlocked(save, index)) return { ok: false, reason: "Already unlocked" };
  const cost = baseLevelCost(index);
  if (save.gems < cost) return { ok: false, reason: "Not enough gems" };
  const precondition = checkBaseUnlockPreconditions(save, index);
  if (!precondition.ok) return precondition;
  if (!save.baseUnlocks) {
    save.baseUnlocks = { levels: [true, true, false, false, false, false, false] };
  }
  save.gems -= cost;
  save.baseUnlocks.levels[index] = true;
  return { ok: true };
}

export function canRefundBase(save: PersistState, index: number): number {
  if (index < 2 || index >= BASE_LEVEL_COUNT) return 0;
  const levels = save.baseUnlocks?.levels;
  if (!levels?.[index]) return 0;
  for (let higher = index + 1; higher < BASE_LEVEL_COUNT; higher++) {
    if (levels[higher]) return 0;
  }
  const cost = baseLevelCost(index);
  return cost > 0 ? cost : 0;
}

export function tryRefundBase(save: PersistState, index: number) {
  const refundAmount = canRefundBase(save, index);
  if (refundAmount === 0) return { ok: false, reason: "Cannot refund: dependent unlocks active" };
  save.baseUnlocks!.levels[index] = false;
  save.gems += refundAmount;
  return { ok: true, gems: refundAmount };
}

// Walks until the first locked index. A run always has a legal cap of at least 1.
export function maxLevelForBase(save: PersistState): number {
  const levels = save.baseUnlocks?.levels;
  if (!levels) return 2;
  let max = 0;
  for (let index = 0; index < BASE_LEVEL_COUNT; index++) {
    if (!levels[index]) break;
    max = index + 1;
  }
  return Math.max(1, max);
}

function resolveGeneralAddonCosts(costKey: string | undefined, isSellOption: boolean | undefined): readonly number[] {
  if (isSellOption) return [SELL_OPTION_GEM_COST, SELL_OPTION_GEM_COST];
  if (!costKey) return [];
  const costs = GENERAL_ADDON_GEM_COSTS[costKey as keyof typeof GENERAL_ADDON_GEM_COSTS];
  return costs ?? [];
}

export const GENERAL_ADDON_DEFS: Record<string, GeneralAddonDef> = Object.fromEntries(
  Object.entries(skillTreeContent.generalAddonDefs).map(([key, def]) => [
    key,
    {
      key: def.key,
      label: def.label,
      desc: def.desc,
      tiers: def.tiers,
      costs: resolveGeneralAddonCosts(def.costKey, def.isSellOption),
      ...(def.isSellOption ? { isSellOption: true } : {}),
    },
  ]),
);

// Sell Flexibility is ONE purchase with two mutually exclusive positions, and
// generalAddons.sellActive is the whole of its state: a mode means bought and in
// effect, null means not bought. There is no second ownership flag, so "bought
// both" is unrepresentable rather than merely discouraged.

export const SELL_OPTION_MODES = ["refund", "discount"] as const;

export type SellOptionMode = (typeof SELL_OPTION_MODES)[number];

// sellOption tier index → generalAddons.sellActive value.
export function sellOptionMode(index: number): SellOptionMode | null {
  return SELL_OPTION_MODES[index] ?? null;
}

export function activeSellMode(save: PersistState): SellOptionMode | null {
  const active = save.generalAddons.sellActive;
  return SELL_OPTION_MODES.find((mode) => mode === active) ?? null;
}

export function isSellOptionPurchased(save: PersistState): boolean {
  return activeSellMode(save) !== null;
}

export function isGeneralUnlocked(save: PersistState, key: string, index: number): boolean {
  if (key === "sellOption") return sellOptionMode(index) !== null && isSellOptionPurchased(save);
  const current = save.generalAddons[key] as number | null;
  return current !== null && current >= index;
}

export function isGeneralAvailable(save: PersistState, key: string, index: number): boolean {
  if (key === "sellOption" && sellOptionMode(index) === null) return false;
  if (isGeneralUnlocked(save, key, index)) return true;
  const def = GENERAL_ADDON_DEFS[key];
  if (!def) return false;
  const cost = def.costs[index]!;
  if (save.gems < cost) return false;
  // sellOption is one purchase, not a tier ladder: once owned, switching costs nothing.
  if (index >= 1 && key !== "sellOption") {
    const prevUnlocked = isGeneralUnlocked(save, key, index - 1);
    if (!prevUnlocked) return false;
  }
  return true;
}

export function tryUnlockGeneral(save: PersistState, key: string, index: number) {
  const def = GENERAL_ADDON_DEFS[key];
  if (!def) return { ok: false, reason: "Unknown add-on" };
  const cost = def.costs[index]!;

  // The single sell purchase. The first click buys it; every later click is a free
  // switch — refunding the outgoing mode and buying the incoming one is the same
  // purchase moving, so the gem total does not move and only one is ever live.
  if (key === "sellOption") {
    const target = sellOptionMode(index);
    if (!target) return { ok: false, reason: "Invalid sell mode" };
    const active = activeSellMode(save);
    if (active === target) return { ok: false, reason: "Already active" };
    if (active === null) {
      if (save.gems < cost) return { ok: false, reason: "Not enough gems" };
      save.gems -= cost;
    }
    save.generalAddons.sellActive = target;
    return { ok: true, gems: active === null ? cost : 0 };
  }

  if (isGeneralUnlocked(save, key, index)) return { ok: false, reason: "Already unlocked" };
  if (save.gems < cost) return { ok: false, reason: "Not enough gems" };

  if (index >= 1) {
    const prevUnlocked = isGeneralUnlocked(save, key, index - 1);
    if (!prevUnlocked) return { ok: false, reason: "Unlock previous tier first" };
  }

  const current = save.generalAddons?.[key] as number | null | undefined;
  if (current === index) return { ok: false, reason: "Already unlocked" };
  if (current !== undefined && current !== null && current > index)
    return { ok: false, reason: "Already unlocked at higher tier" };

  save.gems -= cost;
  save.generalAddons[key] = index;
  return { ok: true };
}

export function getGeneralAddonValue(save: PersistState, key: string): number | string | null {
  if (key === "sellOption") return activeSellMode(save);
  return save.generalAddons[key] as number | null;
}

export function getGeneralAddonTierData(save: PersistState, key: string) {
  const tier = getGeneralAddonValue(save, key);
  const def = GENERAL_ADDON_DEFS[key];
  if (!def || tier === null || tier === undefined) return null;
  return { tier, ...def.tiers[tier as number] };
}

export function canRefundGeneral(save: PersistState, key: string, index: number): number {
  // One sell purchase in one position: only the mode currently in effect is
  // refundable, so a refund always clears sellActive (same end state as the bulk path).
  if (key === "sellOption") {
    const mode = sellOptionMode(index);
    return mode !== null && mode === activeSellMode(save) ? SELL_OPTION_GEM_COST : 0;
  }
  const current = getGeneralAddonValue(save, key);
  if (current !== index) return 0;
  const def = GENERAL_ADDON_DEFS[key];
  if (!def) return 0;
  return def.costs[index]!;
}

export function tryRefundGeneral(save: PersistState, key: string, index: number) {
  const refundAmount = canRefundGeneral(save, key, index);
  if (refundAmount === 0) return { ok: false, reason: "Cannot refund this tier" };
  if (key === "sellOption") {
    save.generalAddons.sellActive = null;
    save.gems += refundAmount;
    return { ok: true, gems: refundAmount };
  }
  if (index > 0) {
    save.generalAddons[key] = index - 1;
  } else {
    save.generalAddons[key] = null;
  }
  save.gems += refundAmount;
  return { ok: true, gems: refundAmount };
}

export function countRefundableGems(save: PersistState): number {
  let total = 0;
  for (const towerId of Object.keys(save.unlocked)) {
    const unlocked = save.unlocked[towerId]!;
    // Mirror refundAllGems: variants refund first, then levels become refundable — count both.
    for (let i = unlocked.levels.length - 1; i >= 0; i--) {
      if (unlocked.levels[i]) total += getCost("level", i);
    }
    for (let i = unlocked.variantA.length - 1; i >= 0; i--) {
      if (unlocked.variantA[i]) total += getCost("variantA", i);
    }
    for (let i = unlocked.variantB.length - 1; i >= 0; i--) {
      if (unlocked.variantB[i]) total += getCost("variantB", i);
    }
    for (let i = unlocked.addons.length - 1; i >= 0; i--) {
      if (unlocked.addons[i]) total += getCost("addons", i);
    }
  }
  for (const key of Object.keys(GENERAL_ADDON_DEFS)) {
    if (key === "sellOption") {
      if (isSellOptionPurchased(save)) total += SELL_OPTION_GEM_COST;
      continue;
    }
    const current = getGeneralAddonValue(save, key);
    if (typeof current !== "number") continue;
    const def = GENERAL_ADDON_DEFS[key];
    if (!def) continue;
    for (let i = 0; i <= current; i++) {
      total += def.costs[i]!;
    }
  }
  const baseLevels = save.baseUnlocks?.levels;
  if (baseLevels) {
    for (let index = BASE_LEVEL_COUNT - 1; index >= 0; index--) {
      if (baseLevels[index]) total += baseLevelCost(index);
    }
  }
  return total;
}

export function refundAllGems(save: PersistState) {
  for (const towerId of Object.keys(save.unlocked)) {
    const unlocked = save.unlocked[towerId]!;
    for (let i = unlocked.variantA.length - 1; i >= 0; i--) {
      if (unlocked.variantA[i]) tryRefund(save, towerId, "variantA", i);
    }
    for (let i = unlocked.variantB.length - 1; i >= 0; i--) {
      if (unlocked.variantB[i]) tryRefund(save, towerId, "variantB", i);
    }
    for (let i = unlocked.addons.length - 1; i >= 0; i--) {
      if (unlocked.addons[i]) tryRefund(save, towerId, "addons", i);
    }
    for (let i = unlocked.levels.length - 1; i >= 0; i--) {
      if (unlocked.levels[i]) tryRefund(save, towerId, "level", i);
    }
  }
  for (const key of Object.keys(GENERAL_ADDON_DEFS)) {
    if (key === "sellOption") {
      if (isSellOptionPurchased(save)) save.gems += SELL_OPTION_GEM_COST;
      save.generalAddons.sellActive = null;
      continue;
    }
    const current = getGeneralAddonValue(save, key);
    if (typeof current !== "number") continue;
    for (let i = current; i >= 0; i--) {
      tryRefundGeneral(save, key, i);
    }
  }
  if (save.baseUnlocks?.levels) {
    for (let index = BASE_LEVEL_COUNT - 1; index >= 0; index--) {
      if (save.baseUnlocks.levels[index]) tryRefundBase(save, index);
    }
  }
}
