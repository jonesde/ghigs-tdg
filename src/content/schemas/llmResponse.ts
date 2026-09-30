import { z } from "zod";

const TileCoordinateSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

// Soft-filter non-finite entries so one bad id does not drop the whole command.
const EnemyIdsSchema = z.array(z.unknown()).transform((entries) => {
  const result: number[] = [];
  for (const entry of entries) {
    if (typeof entry === "number" && Number.isFinite(entry)) result.push(entry);
  }
  return result;
});

const WaypointsSchema = z
  .array(z.unknown())
  .optional()
  .transform((entries) => {
    if (!entries) return [] as { x: number; y: number }[];
    const result: { x: number; y: number }[] = [];
    for (const entry of entries) {
      const parsed = TileCoordinateSchema.safeParse(entry);
      if (parsed.success) result.push(parsed.data);
    }
    return result;
  });

const RouteGroupSchema = z.object({
  type: z.literal("llm:routeGroup"),
  enemyIds: EnemyIdsSchema,
  hold: z.boolean().optional(),
  holdTile: TileCoordinateSchema.optional(),
  waypoints: WaypointsSchema,
});

const SetTargetingSchema = z.object({
  type: z.literal("llm:setTargeting"),
  enemyIds: EnemyIdsSchema,
  mode: z.string().min(1),
});

const SiegeTowerSchema = z.object({
  type: z.literal("llm:siegeTower"),
  enemyIds: EnemyIdsSchema,
  towerTile: TileCoordinateSchema,
});

const PresentWaypointsSchema = z.array(z.unknown()).transform((entries) => {
  const result: { x: number; y: number }[] = [];
  for (const entry of entries) {
    const parsed = TileCoordinateSchema.safeParse(entry);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
});

const SetSpawnOrderSchema = z.object({
  type: z.literal("llm:setSpawnOrder"),
  spawnIndex: z.number().int().optional(),
  clear: z.boolean().optional(),
  hold: z.boolean().optional(),
  holdTile: TileCoordinateSchema.optional(),
  waypoints: PresentWaypointsSchema.optional(),
  targetingMode: z.string().min(1).optional(),
  towerTile: TileCoordinateSchema.optional(),
});

const ReleaseHeldSchema = z.object({
  type: z.literal("llm:releaseHeld"),
  wave: z.number().int().optional(),
  spawnIndex: z.number().int().optional(),
});

export const LlmCommandSchema = z.discriminatedUnion("type", [
  RouteGroupSchema,
  SetTargetingSchema,
  SiegeTowerSchema,
  SetSpawnOrderSchema,
  ReleaseHeldSchema,
]);

export const LlmResponseBodySchema = z.union([
  z.array(z.unknown()),
  z.object({ commands: z.array(z.unknown()).optional(), chat: z.string().optional() }),
]);

export type LlmCommandParsed = z.infer<typeof LlmCommandSchema>;
