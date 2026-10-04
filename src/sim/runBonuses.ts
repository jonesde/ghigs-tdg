import { TOWER_TYPE_LABELS, type TowerId, TowerIds } from "@/sim/ConstantsTower.js";
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
  "sharpenedType",
  "quickHandsType",
  "fortifyType",
  "farSightType",
] as const;

export type BonusId = (typeof BONUS_IDS)[number];

// The four cards that buff one tower type instead of every tower. The type is drawn
// when the picker opens, weighted by how many towers of each type are built.
export const TYPED_BONUS_IDS = ["sharpenedType", "quickHandsType", "fortifyType", "farSightType"] as const;
export type TypedBonusId = (typeof TYPED_BONUS_IDS)[number];

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

export const TYPED_MULT_FIELDS = ["typeDamageMult", "typeFireRateMult", "typeHealthMult", "typeRangeMult"] as const;

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
}

export interface OfferCurationContext {
  // True while at least one live tower can apply a slow. Heavy Frost is a dead
  // card without one.
  canApplySlow: boolean;
}

const PERSISTENT_FACTOR = 1.1;
const ARMOR_FACTOR = 0.9;
const SMALL_PURSE_BASE_GOLD = 50;
const SMALL_PURSE_GOLD_PER_WAVE = 5;
const FIELD_REPAIR_FRACTION = 0.25;
const BONUS_OFFER_TAG = 0xb04e05;
const SPECIALIST_ROLL_TAG = 0x5fec;
const CURATION_ROLL_TAG = 0xc0de;
// Share of offers that carry a typed card. Without it the typed cards would only
// appear by chance from the uniform pool and the specialist draw would rarely
// surface in a run.
const TYPED_CARD_WEIGHT = 0.6;

type GlobalBonusId = Exclude<BonusId, TypedBonusId | "smallPurse" | "largePurse" | "fieldRepair">;

const PERSISTENT_CARDS: Record<GlobalBonusId, { name: string; field: GlobalMultField; factor: number; noun: string }> =
  {
    sharpened: { name: "Sharpened", field: "damageMult", factor: PERSISTENT_FACTOR, noun: "tower damage" },
    quickHands: { name: "Quick Hands", field: "fireRateMult", factor: PERSISTENT_FACTOR, noun: "tower fire rate" },
    fortify: { name: "Fortify", field: "healthMult", factor: PERSISTENT_FACTOR, noun: "tower and base health" },
    farSight: { name: "Far Sight", field: "rangeMult", factor: PERSISTENT_FACTOR, noun: "tower range" },
    bounty: { name: "Bounty", field: "bountyMult", factor: PERSISTENT_FACTOR, noun: "kill gold" },
    heavyFrost: {
      name: "Heavy Frost",
      field: "slowMult",
      factor: PERSISTENT_FACTOR,
      noun: "slow strength and duration",
    },
    armor: { name: "Armor", field: "armorMult", factor: ARMOR_FACTOR, noun: "enemy attack damage" },
  };

const TYPED_CARDS: Record<TypedBonusId, { name: string; field: TypedMultField; factor: number; noun: string }> = {
  sharpenedType: { name: "Sharpened", field: "typeDamageMult", factor: PERSISTENT_FACTOR, noun: "damage" },
  quickHandsType: { name: "Quick Hands", field: "typeFireRateMult", factor: PERSISTENT_FACTOR, noun: "fire rate" },
  fortifyType: { name: "Fortify", field: "typeHealthMult", factor: PERSISTENT_FACTOR, noun: "health" },
  farSightType: { name: "Far Sight", field: "typeRangeMult", factor: PERSISTENT_FACTOR, noun: "range" },
};

// Sturdy Wall has no damage, fire rate, or range, so three of the four typed cards
// would be dead on it. It stays out of the specialist draw entirely: the global
// Fortify card still buffs its health.
const SPECIALIST_TOWER_IDS: TowerId[] = Object.values(TowerIds).filter((towerId) => towerId !== TowerIds.STURDY_WALL);

const TYPED_SUMMARY_SHORT: Record<TypedMultField, string> = {
  typeDamageMult: "dmg",
  typeFireRateMult: "rate",
  typeHealthMult: "hp",
  typeRangeMult: "range",
};

export function isTypedBonusId(bonusId: BonusId): bonusId is TypedBonusId {
  return (TYPED_BONUS_IDS as readonly BonusId[]).includes(bonusId);
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
  return SMALL_PURSE_BASE_GOLD + SMALL_PURSE_GOLD_PER_WAVE * (safeWave - 1);
}

export function largePurseGold(wave: number): number {
  return smallPurseGold(wave) * 2;
}

export function cacheOpenGold(wave: number): number {
  return smallPurseGold(wave);
}

export function describeBonus(bonusId: BonusId, context: BonusContext): BonusApplication {
  if (bonusId === "smallPurse") return { kind: "gold", amount: smallPurseGold(context.wave) };
  if (bonusId === "largePurse") return { kind: "gold", amount: largePurseGold(context.wave) };
  if (bonusId === "fieldRepair") return { kind: "repair", fraction: FIELD_REPAIR_FRACTION };
  if (isTypedBonusId(bonusId)) {
    const card = TYPED_CARDS[bonusId];
    return { kind: "typedMult", field: card.field, factor: card.factor, towerType: context.specialistType };
  }
  const card = PERSISTENT_CARDS[bonusId as GlobalBonusId];
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
  const label = TOWER_TYPE_LABELS[context.specialistType];
  if (isTypedBonusId(bonusId)) {
    const card = TYPED_CARDS[bonusId];
    const current = bonuses[card.field][context.specialistType] ?? 1;
    const next = current * card.factor;
    return {
      name: `${card.name} · ${label}`,
      detail: `${label} tower ${card.noun}`,
      change: `${formatMultiplier(current)} → ${formatMultiplier(next)}`,
      persistent: true,
    };
  }
  const card = PERSISTENT_CARDS[bonusId as GlobalBonusId];
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
  for (const field of TYPED_MULT_FIELDS) {
    const record = bonuses[field];
    for (const towerId of Object.keys(record) as TowerId[]) {
      const value = record[towerId];
      if (value === undefined || value === 1) continue;
      parts.push(`${TOWER_TYPE_LABELS[towerId]} ${TYPED_SUMMARY_SHORT[field]} ${formatMultiplier(value)}`);
    }
  }
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

// Separate stream from the offer draw: a card pool change must not move the
// specialist type a package resolves to.
export function specialistSeed(mapSeed: number, packageId: number): number {
  let mixed = Math.imul(mapSeed ^ SPECIALIST_ROLL_TAG, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

function curationSeed(mapSeed: number, packageId: number): number {
  let mixed = Math.imul(mapSeed ^ CURATION_ROLL_TAG, 0x9e3779b1);
  mixed ^= Math.imul(packageId + 1, 0x85ebca6b);
  return mixed >>> 0;
}

// At most one typed card per offer, drawn into the first slot. The remaining slots
// come from the global cards so an offer always mixes the two families.
export function rollBonusOffer(rng: () => number): BonusOffer {
  const pool: BonusId[] = BONUS_IDS.filter((bonusId) => !isTypedBonusId(bonusId));
  const offer: BonusId[] = [];
  if (rng() < TYPED_CARD_WEIGHT) {
    const typed = TYPED_BONUS_IDS[Math.floor(rng() * TYPED_BONUS_IDS.length)];
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
  for (const towerId of SPECIALIST_TOWER_IDS) {
    const weight = Math.max(0, weights[towerId] ?? 0);
    if (weight <= 0) continue;
    total += weight;
    entries.push({ towerId, weight });
  }
  if (total <= 0) {
    const uniform = SPECIALIST_TOWER_IDS[Math.floor(rng() * SPECIALIST_TOWER_IDS.length)];
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
  const pool: BonusId[] = BONUS_IDS.filter((bonusId) => !offer.includes(bonusId) && !isTypedBonusId(bonusId));
  const replacement = pool[Math.floor(rng() * pool.length)];
  if (!replacement) return offer;
  const curated = offer.map((bonusId) => (bonusId === "heavyFrost" ? replacement : bonusId));
  return [curated[0]!, curated[1]!, curated[2]!];
}
