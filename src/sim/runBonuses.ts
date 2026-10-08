import { type TowerId, TowerIds, towerTypeLabels } from "@/content/towerIds.js";
import { mulberry32 } from "@/sim/grid/Map.js";
import type { ActiveBuildingBonus } from "@/sim/mapSites.js";

// Run-scoped rewards from a supply drop or a map cache. Persistent factors stack
// by multiplication and reset when the run is initialized. Nothing here is written
// to persist.
const bonusIds = [
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
  "sharpenedType",
  "quickHandsType",
  "fortifyType",
  "farSightType",
] as const;

export type BonusId = (typeof bonusIds)[number];

// The four cards that buff one tower type instead of every tower. The type is drawn
// when the picker opens, weighted by how many towers of each type are built.
const typedBonusIds = ["sharpenedType", "quickHandsType", "fortifyType", "farSightType"] as const;
export type TypedBonusId = (typeof typedBonusIds)[number];

export type BonusOffer = [BonusId, BonusId, BonusId];

export type GlobalMultField =
  | "damageMult"
  | "fireRateMult"
  | "healthMult"
  | "rangeMult"
  | "bountyMult"
  | "slowMult"
  | "armorMult";

export type TypedMultField = "typeDamageMult" | "typeFireRateMult" | "typeHealthMult" | "typeRangeMult";

const typedMultFieldsList = ["typeDamageMult", "typeFireRateMult", "typeHealthMult", "typeRangeMult"] as const;

export interface RunBonuses {
  damageMult: number;
  fireRateMult: number;
  healthMult: number;
  rangeMult: number;
  bountyMult: number;
  slowMult: number;
  armorMult: number;
  typeDamageMult: Partial<Record<TowerId, number>>;
  typeFireRateMult: Partial<Record<TowerId, number>>;
  typeHealthMult: Partial<Record<TowerId, number>>;
  typeRangeMult: Partial<Record<TowerId, number>>;
}

export interface BonusPickerState {
  source: "drop" | "cache";
  id: number;
  offer: BonusOffer;
  wasPlaying: boolean;
  // Drawn when the picker opened and held for its lifetime, so dismissing and
  // reopening the same package cannot reroll the type the cards promise.
  specialistType: TowerId;
}

export interface BonusCard {
  name: string;
  detail: string;
  change?: string;
  persistent: boolean;
}

export interface BonusContext {
  wave: number;
  specialistType: TowerId;
  // Themed display name for the specialist type, supplied by the picker from the
  // active map theme. Plain string so this module stays clear of the theme store.
  themeTowerName?: string;
}

export interface OfferCurationContext {
  // True while at least one live tower can apply a slow. Heavy Frost is a dead
  // card without one.
  canApplySlow: boolean;
}

const persistentFactor = 1.1;
// A card that buffs one tower type is worth more than one that buffs them all,
// so the specialist draws pay 20% instead of 10%.
const typedPersistentFactor = 1.2;
const armorFactor = 0.9;
const smallPurseBaseGold = 50;
const smallPurseGoldPerWave = 5;
const fieldRepairFraction = 0.25;
const bonusOfferTag = 0xb04e05;
const specialistRollTag = 0x5fec;
const curationRollTag = 0xc0de;
// Share of offers that carry a typed card. Without it the typed cards would only
// appear by chance from the uniform pool and the specialist draw would rarely
// surface in a run.
const typedCardWeight = 0.6;

type GlobalBonusId = Exclude<BonusId, TypedBonusId | "smallPurse" | "largePurse" | "fieldRepair">;

const persistentCards: Record<GlobalBonusId, { name: string; field: GlobalMultField; factor: number; noun: string }> = {
  sharpened: { name: "Sharpened", field: "damageMult", factor: persistentFactor, noun: "tower damage" },
  quickHands: { name: "Quick Hands", field: "fireRateMult", factor: persistentFactor, noun: "tower fire rate" },
  fortify: { name: "Fortify", field: "healthMult", factor: persistentFactor, noun: "tower and base health" },
  farSight: { name: "Far Sight", field: "rangeMult", factor: persistentFactor, noun: "tower range" },
  bounty: { name: "Bounty", field: "bountyMult", factor: persistentFactor, noun: "kill gold" },
  heavyFrost: { name: "Heavy Frost", field: "slowMult", factor: persistentFactor, noun: "slow strength and duration" },
  armor: { name: "Armor", field: "armorMult", factor: armorFactor, noun: "enemy attack damage" },
};

const typedCards: Record<TypedBonusId, { name: string; field: TypedMultField; factor: number; noun: string }> = {
  sharpenedType: { name: "Sharpened", field: "typeDamageMult", factor: typedPersistentFactor, noun: "damage" },
  quickHandsType: { name: "Quick Hands", field: "typeFireRateMult", factor: typedPersistentFactor, noun: "fire rate" },
  fortifyType: { name: "Fortify", field: "typeHealthMult", factor: typedPersistentFactor, noun: "health" },
  farSightType: { name: "Far Sight", field: "typeRangeMult", factor: typedPersistentFactor, noun: "range" },
};

// Sturdy Wall has no damage, fire rate, or range, so three of the four typed cards
// would be dead on it. It stays out of the specialist draw entirely: the global
// Fortify card still buffs its health.
const specialistTowerIds: TowerId[] = Object.values(TowerIds).filter((towerId) => towerId !== TowerIds.STURDY_WALL);

const typedSummaryShort: Record<TypedMultField, string> = {
  typeDamageMult: "dmg",
  typeFireRateMult: "rate",
  typeHealthMult: "hp",
  typeRangeMult: "range",
};

export function isTypedBonusId(bonusId: BonusId): bonusId is TypedBonusId {
  return (typedBonusIds as readonly BonusId[]).includes(bonusId);
}

export function typedMultFields(): readonly TypedMultField[] {
  return typedMultFieldsList;
}

export function freshRunBonuses(): RunBonuses {
  return {
    damageMult: 1,
    fireRateMult: 1,
    healthMult: 1,
    rangeMult: 1,
    bountyMult: 1,
    slowMult: 1,
    armorMult: 1,
    typeDamageMult: {},
    typeFireRateMult: {},
    typeHealthMult: {},
    typeRangeMult: {},
  };
}

export type BonusApplication =
  | { kind: "gold"; amount: number }
  | { kind: "mult"; field: GlobalMultField; factor: number }
  | { kind: "typedMult"; field: TypedMultField; factor: number; towerType: TowerId }
  | { kind: "repair"; fraction: number };

// Wave scaled together so the purse pair keeps its 1:2 ratio and a cache costs
// exactly one small purse at every wave: opening a cache stays break-even against
// its own worst card, so the no-reward outcome keeps its pressure late in a run.
export function smallPurseGold(wave: number): number {
  const safeWave = Math.max(1, Math.floor(wave));
  return smallPurseBaseGold + smallPurseGoldPerWave * (safeWave - 1);
}

export function largePurseGold(wave: number): number {
  // The large purse is defined as twice the small purse; no pack field carries the
  // 2x factor yet, so do not hunt for a missing tunable.
  return smallPurseGold(wave) * 2;
}

export function cacheOpenGold(wave: number): number {
  return smallPurseGold(wave);
}

export function describeBonus(bonusId: BonusId, context: BonusContext): BonusApplication {
  if (bonusId === "smallPurse") return { kind: "gold", amount: smallPurseGold(context.wave) };
  if (bonusId === "largePurse") return { kind: "gold", amount: largePurseGold(context.wave) };
  if (bonusId === "fieldRepair") return { kind: "repair", fraction: fieldRepairFraction };
  if (isTypedBonusId(bonusId)) {
    const card = typedCards[bonusId];
    return { kind: "typedMult", field: card.field, factor: card.factor, towerType: context.specialistType };
  }
  const card = persistentCards[bonusId as GlobalBonusId];
  return { kind: "mult", field: card.field, factor: card.factor };
}

export function bonusCard(bonusId: BonusId, bonuses: RunBonuses, context: BonusContext): BonusCard {
  if (bonusId === "smallPurse") {
    return { name: "Small Purse", detail: `Immediate +${smallPurseGold(context.wave)} gold`, persistent: false };
  }
  if (bonusId === "largePurse") {
    return { name: "Large Purse", detail: `Immediate +${largePurseGold(context.wave)} gold`, persistent: false };
  }
  if (bonusId === "fieldRepair") {
    return { name: "Field Repair", detail: "Immediate restore 25% health", persistent: false };
  }
  const label = towerTypeLabels[context.specialistType];
  if (isTypedBonusId(bonusId)) {
    const card = typedCards[bonusId];
    const current = bonuses[card.field][context.specialistType] ?? 1;
    const next = current * card.factor;
    // The theme's name leads, the base tower name follows in parentheses for
    // reference, so a themed run still reads against the shop and help copy.
    const themed = context.themeTowerName ?? label;
    const towerLabel = `${themed} (${label})`;
    return {
      name: `${card.name} · ${towerLabel}`,
      detail: `${towerLabel} tower ${card.noun}`,
      change: `${formatMultiplier(current)} → ${formatMultiplier(next)}`,
      persistent: true,
    };
  }
  const card = persistentCards[bonusId as GlobalBonusId];
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

// One entry per active effect, so the header can list them in a popup instead of
// truncating a single joined line.
export function runBonusSummaryParts(bonuses: RunBonuses): string[] {
  const parts: string[] = [];
  if (bonuses.damageMult !== 1) parts.push(`Dmg ${formatMultiplier(bonuses.damageMult)}`);
  if (bonuses.fireRateMult !== 1) parts.push(`Rate ${formatMultiplier(bonuses.fireRateMult)}`);
  if (bonuses.healthMult !== 1) parts.push(`HP ${formatMultiplier(bonuses.healthMult)}`);
  if (bonuses.rangeMult !== 1) parts.push(`Range ${formatMultiplier(bonuses.rangeMult)}`);
  if (bonuses.bountyMult !== 1) parts.push(`Gold ${formatMultiplier(bonuses.bountyMult)}`);
  if (bonuses.slowMult !== 1) parts.push(`Slow ${formatMultiplier(bonuses.slowMult)}`);
  if (bonuses.armorMult !== 1) parts.push(`Armor ${formatMultiplier(bonuses.armorMult)}`);
  for (const field of typedMultFieldsList) {
    const record = bonuses[field];
    for (const towerId of Object.keys(record) as TowerId[]) {
      const value = record[towerId];
      if (value === undefined || value === 1) continue;
      parts.push(`${towerTypeLabels[towerId]} ${typedSummaryShort[field]} ${formatMultiplier(value)}`);
    }
  }
  return parts;
}

export function formatRunBonusSummary(bonuses: RunBonuses): string {
  return runBonusSummaryParts(bonuses).join("  ");
}

// The whole-board half of every powered building, as its own entries. Separate
// from runBonusSummaryParts because these factors come from the board, not from a
// card, and the HUD lists them together.
export function buildingEffectSummaryParts(bonus: ActiveBuildingBonus): string[] {
  if (bonus.activeCount === 0) return [];
  const parts: string[] = [`Buildings ${bonus.activeCount} active`];
  pushProduct(parts, "Bldg dmg", bonus.damageMult);
  pushProduct(parts, "Bldg rate", bonus.fireRateMult);
  pushProduct(parts, "Bldg range", bonus.rangeMult);
  pushProduct(parts, "Bldg air", bonus.flyingDamageMult);
  return parts;
}

export interface TowerBonusFactors {
  runDamageMult: number;
  runFireRateMult: number;
  runHealthMult: number;
  runRangeMult: number;
  runSlowMult: number;
  siteDamageMult: number;
  siteFireRateMult: number;
  siteRangeMult: number;
  siteFlyingDamageMult: number;
  incomingDamageMult: number;
}

export function formatTowerBonusLine(factors: TowerBonusFactors): string {
  const parts: string[] = [];
  pushProduct(parts, "dmg", factors.runDamageMult * factors.siteDamageMult);
  pushProduct(parts, "rate", factors.runFireRateMult * factors.siteFireRateMult);
  // Health is run cards only now: no building grants it, so the typed health record
  // folded into runHealthMult is the whole number and there is nothing to multiply.
  pushProduct(parts, "hp", factors.runHealthMult);
  pushProduct(parts, "range", factors.runRangeMult * factors.siteRangeMult);
  pushProduct(parts, "air", factors.siteFlyingDamageMult);
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
  let mixed = Math.imul(mapSeed ^ bonusOfferTag, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

// Separate stream from the offer draw: a card pool change must not move the
// specialist type a package resolves to.
export function specialistSeed(mapSeed: number, packageId: number): number {
  let mixed = Math.imul(mapSeed ^ specialistRollTag, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

function curationSeed(mapSeed: number, packageId: number): number {
  let mixed = Math.imul(mapSeed ^ curationRollTag, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

// At most one typed card per offer, drawn into the first slot. The remaining slots
// come from the global cards so an offer always mixes the two families.
export function rollBonusOffer(rng: () => number): BonusOffer {
  const pool: BonusId[] = bonusIds.filter((bonusId) => !isTypedBonusId(bonusId));
  const offer: BonusId[] = [];
  if (rng() < typedCardWeight) {
    const typed = typedBonusIds[Math.floor(rng() * typedBonusIds.length)];
    if (typed) offer.push(typed);
  }
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

// Weights are the live tower count per type. An empty board falls back to a uniform
// draw over the eligible types so the typed cards still work before the first build.
export function rollSpecialistType(
  mapSeed: number,
  packageId: number,
  weights: Partial<Record<TowerId, number>>,
): TowerId {
  const rng = mulberry32(specialistSeed(mapSeed, packageId));
  const entries: { towerId: TowerId; weight: number }[] = [];
  let total = 0;
  for (const towerId of specialistTowerIds) {
    const weight = Math.max(0, weights[towerId] ?? 0);
    if (weight <= 0) continue;
    total += weight;
    entries.push({ towerId, weight });
  }
  if (total <= 0) {
    const uniform = specialistTowerIds[Math.floor(rng() * specialistTowerIds.length)];
    return uniform ?? TowerIds.BASIC;
  }
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.towerId;
  }
  return entries[entries.length - 1]!.towerId;
}

// An offer is rolled before the board can say whether a slow ever exists: a cache at
// map generation, a drop at drop time. Swapping a dead card here (once, on first
// open) keeps the base draw deterministic and stops a no-slow run from being offered
// Heavy Frost.
export function curateBonusOffer(
  offer: BonusOffer,
  context: OfferCurationContext,
  mapSeed: number,
  packageId: number,
): BonusOffer {
  if (context.canApplySlow) return offer;
  if (!offer.includes("heavyFrost")) return offer;
  const rng = mulberry32(curationSeed(mapSeed, packageId));
  const pool: BonusId[] = bonusIds.filter((bonusId) => !offer.includes(bonusId) && !isTypedBonusId(bonusId));
  const replacement = pool[Math.floor(rng() * pool.length)];
  if (!replacement) return offer;
  const curated = offer.map((bonusId) => (bonusId === "heavyFrost" ? replacement : bonusId));
  return [curated[0]!, curated[1]!, curated[2]!];
}
