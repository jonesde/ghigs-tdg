import { z } from "zod";

export const MapStyleSchema = z.enum(["open", "canyon", "serpentine", "split", "bastion", "battlefield"]);

export const MapLevelConfigSchema = z.object({
  width: z.number(),
  height: z.number(),
  regionId: z.number(),
  level: z.number(),
  style: MapStyleSchema,
  seed: z.number(),
});

export const ProgressiveVariantSchema = z.object({
  regionId: z.number().int().min(0).max(2),
  level: z.number().int().min(1).max(12),
  entryCount: z.number().int().min(1).max(4),
  seed: z.number().int(),
});

// A placement-interval step: the interval in effect for every wave strictly
// after `afterWave`. Steps run in ascending afterWave order, so the first
// entry (afterWave 0) is the base interval from wave 1 onward.
export const PlacementIntervalStepSchema = z.object({
  afterWave: z.number().int().min(0),
  interval: z.number().int().min(1),
});

// The unrefined shape, so ThemeMapsOverrideSchema below can be built with
// .partial(); Zod forbids .partial() on an object that already carries a
// refinement.
const MapsContentShapeSchema = z.object({
  heightNoiseFreq: z.number(),
  heightNoiseDivisor: z.number(),
  mapsPerRegion: z.number(),
  levels: z.array(MapLevelConfigSchema).length(36),
  progressive: z.object({
    blockSize: z.literal(5),
    placementIntervalSteps: z.array(PlacementIntervalStepSchema).min(1),
    rerollGoldPerWave: z.number().int().min(0),
    variants: z.array(ProgressiveVariantSchema).length(12),
  }),
});

export const MapsContentSchema = MapsContentShapeSchema.superRefine((content, context) => {
  // src/sim/mapSites.ts derives the region count from exactly this quotient, so a
  // pack that does not divide evenly would produce a fractional region count.
  if (content.levels.length % content.mapsPerRegion !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `levels.length / mapsPerRegion must be a whole number (found ${content.levels.length} / ${content.mapsPerRegion})`,
      path: ["levels"],
    });
  }
});

// A theme's optional `maps` entry: a one-level-deep override of the default
// maps content. Each top-level field is optional; when present it replaces the
// default field wholesale (so a partial `progressive` object is rejected — the
// nested schema keeps every progressive field required).
export const ThemeMapsOverrideSchema = MapsContentShapeSchema.partial();

export type MapsContent = z.infer<typeof MapsContentSchema>;
export type MapLevelConfig = z.infer<typeof MapLevelConfigSchema>;
export type MapStyle = z.infer<typeof MapStyleSchema>;
export type ProgressiveVariantData = z.infer<typeof ProgressiveVariantSchema>;
export type PlacementIntervalStepData = z.infer<typeof PlacementIntervalStepSchema>;
export type ThemeMapsOverride = z.infer<typeof ThemeMapsOverrideSchema>;
