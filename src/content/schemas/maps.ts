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

export const MapsContentSchema = z.object({
  mapBaseSize: z.number(),
  mapSizeScale: z.number(),
  maxMapDim: z.number(),
  heightNoiseFreq: z.number(),
  heightNoiseDivisor: z.number(),
  serpentineStep: z.number(),
  serpentineDownCap: z.number(),
  mapsPerRegion: z.number(),
  levels: z.array(MapLevelConfigSchema).length(36),
  progressive: z.object({
    blockSize: z.literal(5),
    placementInterval: z.number().int().min(1),
    variants: z.array(ProgressiveVariantSchema).length(12),
  }),
});

export type MapsContent = z.infer<typeof MapsContentSchema>;
export type MapLevelConfigData = z.infer<typeof MapLevelConfigSchema>;
export type MapStyleData = z.infer<typeof MapStyleSchema>;
export type ProgressiveVariantData = z.infer<typeof ProgressiveVariantSchema>;
