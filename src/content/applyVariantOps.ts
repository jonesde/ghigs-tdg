import type { StatField, StatOp } from "./schemas/statOps.js";

export type TowerVariantStats = {
  range: number;
  damage: number;
  fireRate: number;
  splash: number;
  chain: number;
  stun: number;
  pierce: number;
  pierceFalloff: number;
  slowAmt: number;
  slowDur: number;
  marksman: boolean;
  napalm: boolean;
  stormcall: boolean;
  knockbackBase: number;
  knockbackScale: number;
  thornReflectPct: number;
  fenceDamage: number;
  fenceStun: number;
  healthMult: number;
  armorPiercing: boolean;
};

function readNumber(stats: TowerVariantStats, field: StatField): number {
  const value = stats[field];
  return typeof value === "number" ? value : 0;
}

function writeValue(stats: TowerVariantStats, field: StatField, value: number | boolean): void {
  (stats as Record<string, number | boolean>)[field] = value;
}

// Applies declarative variant stat ops. tierIdx is level - 5 (0 at L5, 1 at L6, 2 at L7).
export function applyVariantOps(
  stats: TowerVariantStats,
  statOps: readonly StatOp[] | undefined,
  tierIdx: number,
): TowerVariantStats {
  if (!statOps || statOps.length === 0) return stats;
  const result = { ...stats };
  const clampedTier = Math.max(0, Math.min(2, tierIdx));

  for (const op of statOps) {
    switch (op.op) {
      case "set":
        writeValue(result, op.field, op.value);
        break;
      case "mul":
        writeValue(result, op.field, readNumber(result, op.field) * op.factor);
        break;
      case "mulTier":
        writeValue(result, op.field, readNumber(result, op.field) * op.tiers[clampedTier]!);
        break;
      case "setTier":
        writeValue(result, op.field, op.tiers[clampedTier]!);
        break;
      case "add":
        writeValue(result, op.field, readNumber(result, op.field) + op.amount);
        break;
      case "addPerTier":
        writeValue(result, op.field, readNumber(result, op.field) + op.perTier * (tierIdx + 1));
        break;
      case "mulPowTier":
        writeValue(result, op.field, readNumber(result, op.field) * op.base ** (tierIdx + 1));
        break;
    }
  }
  return result;
}
