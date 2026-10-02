import { z } from "zod";

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

const RegionVisualSchema = z.object({
  id: z.number(),
  name: z.string(),
  tiles: z.object({
    path: z.string(),
    terrain1: z.string(),
    terrain2: z.string(),
    terrain3: z.string(),
    terrain4: z.string(),
  }),
  base: z.string(),
  mapImage: z.string(),
  mapLayout: RegionMapLayoutSchema,
});

const SpawnPointVisualSchema = z.object({ closed: z.string(), open: z.string(), transition: z.string() });

export const RawMapThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  towers: z.record(z.string(), TowerVisualSchema),
  enemies: z.record(z.string(), EnemyVisualSchema),
  regions: z.array(RegionVisualSchema),
  spawns: SpawnPointVisualSchema.optional(),
});

export type RawMapTheme = z.infer<typeof RawMapThemeSchema>;
