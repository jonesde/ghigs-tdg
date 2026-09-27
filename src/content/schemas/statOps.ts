import { z } from "zod";

export const STAT_FIELDS = [
  "range",
  "damage",
  "fireRate",
  "splash",
  "chain",
  "stun",
  "pierce",
  "pierceFalloff",
  "slowAmt",
  "slowDur",
  "marksman",
  "napalm",
  "stormcall",
  "knockbackBase",
  "knockbackScale",
  "thornReflectPct",
  "fenceDamage",
  "fenceStun",
  "healthMult",
  "armorPiercing",
] as const;

export const StatFieldSchema = z.enum(STAT_FIELDS);

export const StatOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), field: StatFieldSchema, value: z.union([z.number(), z.boolean()]) }),
  z.object({ op: z.literal("mul"), field: StatFieldSchema, factor: z.number() }),
  z.object({ op: z.literal("mulTier"), field: StatFieldSchema, tiers: z.tuple([z.number(), z.number(), z.number()]) }),
  z.object({ op: z.literal("setTier"), field: StatFieldSchema, tiers: z.tuple([z.number(), z.number(), z.number()]) }),
  z.object({ op: z.literal("add"), field: StatFieldSchema, amount: z.number() }),
  z.object({ op: z.literal("addPerTier"), field: StatFieldSchema, perTier: z.number() }),
  z.object({ op: z.literal("mulPowTier"), field: StatFieldSchema, base: z.number() }),
]);

export type StatOp = z.infer<typeof StatOpSchema>;
export type StatField = z.infer<typeof StatFieldSchema>;
