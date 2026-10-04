import { z } from "zod";
import { ThemeMapsOverrideSchema } from "./maps.js";

const AnimationFrameSchema = z.object({ image: z.string() });

const AnimationSchema = z.object({ duration: z.number(), frames: z.array(AnimationFrameSchema) });

const TowerVisualSchema = z.object({
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  animation: AnimationSchema.nullable(),
  walking: AnimationSchema.optional(),
});

const EnemyVisualSchema = z.object({
  name: z.string(),
  color: z.string(),
  shape: z.string(),
  walking: AnimationSchema,
  hitReaction: AnimationSchema.nullable().optional(),
  attack: AnimationSchema.nullable().optional(),
});

const RegionMapNodeRefSchema = z.object({
  kind: z.enum(["level", "progressive"]),
  level: z.number().int().min(1).max(12),
});

const RegionMapNodeSchema = RegionMapNodeRefSchema.extend({ x: z.number(), y: z.number() });

const RegionMapConnectionSchema = z.object({ from: RegionMapNodeRefSchema, to: RegionMapNodeRefSchema });

function nodeRefKey(ref: { kind: "level" | "progressive"; level: number }): string {
  return `${ref.kind}:${ref.level}`;
}

const RegionMapLayoutSchema = z
  .object({
    viewBox: z.string().regex(/^\s*-?[\d.]+(?:\s+-?[\d.]+){3}\s*$/, 'viewBox must be four numbers like "0 0 1100 700"'),
    nodes: z.array(RegionMapNodeSchema),
    connections: z.array(RegionMapConnectionSchema),
  })
  .superRefine((layout, ctx) => {
    const nodeKeys = new Set<string>();
    const levelNumbers = new Set<number>();
    let progressiveNodeCount = 0;
    for (const node of layout.nodes) {
      const key = nodeRefKey(node);
      if (nodeKeys.has(key)) {
        ctx.addIssue({ code: "custom", message: `Duplicate region map node ${key}` });
      }
      nodeKeys.add(key);
      if (node.kind === "level") {
        levelNumbers.add(node.level);
      } else {
        progressiveNodeCount += 1;
      }
    }
    for (let level = 1; level <= 12; level++) {
      if (!levelNumbers.has(level)) {
        ctx.addIssue({ code: "custom", message: `Region map layout is missing level node ${level}` });
      }
    }
    if (progressiveNodeCount !== 4) {
      ctx.addIssue({
        code: "custom",
        message: `Region map layout needs exactly 4 progressive nodes, found ${progressiveNodeCount}`,
      });
    }
    for (const connection of layout.connections) {
      for (const endpoint of [connection.from, connection.to]) {
        if (!nodeKeys.has(nodeRefKey(endpoint))) {
          ctx.addIssue({
            code: "custom",
            message: `Region map connection endpoint ${nodeRefKey(endpoint)} does not match a node`,
          });
        }
      }
    }
  });

const SpawnPointVisualSchema = z.object({ closed: z.string(), open: z.string(), transition: z.string() });

// A tile kind ships one image, or a list of variants with the primary art first.
// Extra variants break up the repeat of a single stamp across a height blob;
// the renderer picks one per cell from a hash of the map seed and tile position.
const TileImageSchema = z.union([z.string(), z.array(z.string()).min(1)]);

const RegionVisualSchema = z.object({
  id: z.number(),
  name: z.string(),
  tiles: z.object({
    path: TileImageSchema,
    terrain1: TileImageSchema,
    terrain2: TileImageSchema,
    terrain3: TileImageSchema,
    terrain4: TileImageSchema,
  }),
  base: z.string(),
  mapImage: z.string(),
  mapLayout: RegionMapLayoutSchema,
});

// Authored in the same 0 0 36 36 space as tile art, drawn at 26 world px.
// A theme that omits `sites` keeps the procedural marks in MapSiteLayer.
const SiteArtSchema = z.object({
  buildings: z.object({ armory: z.string(), magazine: z.string(), ward: z.string(), beacon: z.string() }),
  caches: z.object({ sealed: z.string(), unlocked: z.string(), broken: z.string() }),
  supplyDrop: z.string().optional(),
});

export const RawMapThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  menuBackground: z.string().optional(),
  towers: z.record(z.string(), TowerVisualSchema),
  enemies: z.record(z.string(), EnemyVisualSchema),
  regions: z.array(RegionVisualSchema),
  spawns: SpawnPointVisualSchema.optional(),
  sites: SiteArtSchema.optional(),
  maps: ThemeMapsOverrideSchema.optional(),
});

export type RawMapTheme = z.infer<typeof RawMapThemeSchema>;
