import { mulberry32 } from "@/sim/grid/Map.js";

// Run-scoped rewards from a supply drop or a map cache. Persistent factors stack
// by multiplication and reset when the run is initialized. Nothing here is written
// to persist.
export const BONUS_IDS = [
  "smallPurse",
  "largePurse",
  "sharpened",
  "quickHands",
  "fortify",
  "farSight",
  "bounty",
  "fieldRepair",
  "heavyFrost",
  "armor",
] as const;

export type BonusId = (typeof BONUS_IDS)[number];
export type BonusOffer = [BonusId, BonusId, BonusId];

export interface RunBonuses {
  damageMult: number;
  fireRateMult: number;
  healthMult: number;
  rangeMult: number;
  bountyMult: number;
  slowMult: number;
  armorMult: number;
}

export interface BonusPickerState {
  source: "drop" | "cache";
  id: number;
  offer: BonusOffer;
  wasPlaying: boolean;
}

export interface BonusCard {
  name: string;
  detail: string;
  change?: string;
  persistent: boolean;
}

const PERSISTENT_FACTOR = 1.1;
const ARMOR_FACTOR = 0.9;
const SMALL_PURSE_GOLD = 50;
const LARGE_PURSE_GOLD = 100;
const FIELD_REPAIR_FRACTION = 0.25;
const BONUS_OFFER_TAG = 0xb04e05;

const PERSISTENT_CARDS: Record<
  Exclude<BonusId, "smallPurse" | "largePurse" | "fieldRepair">,
  { name: string; field: keyof RunBonuses; factor: number; noun: string }
> = {
  sharpened: { name: "Sharpened", field: "damageMult", factor: PERSISTENT_FACTOR, noun: "tower damage" },
  quickHands: { name: "Quick Hands", field: "fireRateMult", factor: PERSISTENT_FACTOR, noun: "tower fire rate" },
  fortify: { name: "Fortify", field: "healthMult", factor: PERSISTENT_FACTOR, noun: "tower and base health" },
  farSight: { name: "Far Sight", field: "rangeMult", factor: PERSISTENT_FACTOR, noun: "tower range" },
  bounty: { name: "Bounty", field: "bountyMult", factor: PERSISTENT_FACTOR, noun: "kill gold" },
  heavyFrost: { name: "Heavy Frost", field: "slowMult", factor: PERSISTENT_FACTOR, noun: "slow strength and duration" },
  armor: { name: "Armor", field: "armorMult", factor: ARMOR_FACTOR, noun: "enemy attack damage" },
};

export function freshRunBonuses(): RunBonuses {
  return { damageMult: 1, fireRateMult: 1, healthMult: 1, rangeMult: 1, bountyMult: 1, slowMult: 1, armorMult: 1 };
}

export type BonusApplication =
  | { kind: "gold"; amount: number }
  | { kind: "mult"; field: keyof RunBonuses; factor: number }
  | { kind: "repair"; fraction: number };

export function describeBonus(bonusId: BonusId): BonusApplication {
  if (bonusId === "smallPurse") return { kind: "gold", amount: SMALL_PURSE_GOLD };
  if (bonusId === "largePurse") return { kind: "gold", amount: LARGE_PURSE_GOLD };
  if (bonusId === "fieldRepair") return { kind: "repair", fraction: FIELD_REPAIR_FRACTION };
  const card = PERSISTENT_CARDS[bonusId];
  return { kind: "mult", field: card.field, factor: card.factor };
}

export function bonusCard(bonusId: BonusId, bonuses: RunBonuses): BonusCard {
  if (bonusId === "smallPurse") return { name: "Small Purse", detail: "Immediate +50 gold", persistent: false };
  if (bonusId === "largePurse") return { name: "Large Purse", detail: "Immediate +100 gold", persistent: false };
  if (bonusId === "fieldRepair") {
    return { name: "Field Repair", detail: "Immediate restore 25% health", persistent: false };
  }
  const card = PERSISTENT_CARDS[bonusId];
  const current = bonuses[card.field];
  const next = current * card.factor;
  return {
    name: card.name,
    detail: card.noun,
    change: `${formatMultiplier(current)} → ${formatMultiplier(next)}`,
    persistent: true,
  };
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function formatRunBonusSummary(bonuses: RunBonuses): string {
  const parts: string[] = [];
  if (bonuses.damageMult !== 1) parts.push(`Dmg ${formatMultiplier(bonuses.damageMult)}`);
  if (bonuses.fireRateMult !== 1) parts.push(`Rate ${formatMultiplier(bonuses.fireRateMult)}`);
  if (bonuses.healthMult !== 1) parts.push(`HP ${formatMultiplier(bonuses.healthMult)}`);
  if (bonuses.rangeMult !== 1) parts.push(`Range ${formatMultiplier(bonuses.rangeMult)}`);
  if (bonuses.bountyMult !== 1) parts.push(`Gold ${formatMultiplier(bonuses.bountyMult)}`);
  if (bonuses.slowMult !== 1) parts.push(`Slow ${formatMultiplier(bonuses.slowMult)}`);
  if (bonuses.armorMult !== 1) parts.push(`Armor ${formatMultiplier(bonuses.armorMult)}`);
  return parts.join("  ");
}

export interface TowerBonusFactors {
  runDamageMult: number;
  runFireRateMult: number;
  runHealthMult: number;
  runRangeMult: number;
  runSlowMult: number;
  siteDamageMult: number;
  siteFireRateMult: number;
  siteHealthMult: number;
  siteRangeMult: number;
  incomingDamageMult: number;
}

export function formatTowerBonusLine(factors: TowerBonusFactors): string {
  const parts: string[] = [];
  pushProduct(parts, "dmg", factors.runDamageMult * factors.siteDamageMult);
  pushProduct(parts, "rate", factors.runFireRateMult * factors.siteFireRateMult);
  pushProduct(parts, "hp", factors.runHealthMult * factors.siteHealthMult);
  pushProduct(parts, "range", factors.runRangeMult * factors.siteRangeMult);
  pushProduct(parts, "slow", factors.runSlowMult);
  pushProduct(parts, "taken", factors.incomingDamageMult);
  return parts.join(" ");
}

function pushProduct(parts: string[], label: string, value: number): void {
  if (Math.abs(value - 1) <= 1e-6) return;
  parts.push(`${label} ${formatMultiplier(value)}`);
}

// Three distinct cards. The draw is a pure function of the map seed and the
// package id, so waiting on the package does not reroll the offer.
export function bonusOfferSeed(mapSeed: number, packageId: number): number {
  let mixed = Math.imul(mapSeed ^ BONUS_OFFER_TAG, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

export function rollBonusOffer(rng: () => number): BonusOffer {
  const pool: BonusId[] = [...BONUS_IDS];
  const offer: BonusId[] = [];
  while (offer.length < 3) {
    const index = Math.floor(rng() * pool.length);
    const picked = pool.splice(index, 1)[0];
    if (picked) offer.push(picked);
  }
  return [offer[0]!, offer[1]!, offer[2]!];
}

export function rollBonusOfferFor(mapSeed: number, packageId: number): BonusOffer {
  return rollBonusOffer(mulberry32(bonusOfferSeed(mapSeed, packageId)));
}
