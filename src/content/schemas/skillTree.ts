import { z } from "zod";

const NameDescSchema = z.object({ name: z.string(), desc: z.string() });

const TierLabelSchema = z.object({ label: z.string(), desc: z.string() });

export const SkillTreeContentSchema = z.object({
  levelCosts: z.array(z.number()).min(7),
  addonCosts: z.tuple([z.number(), z.number(), z.number()]),
  variantInfo: z.record(z.string(), z.object({ A: NameDescSchema, B: NameDescSchema })),
  addonInfo: z.record(z.string(), z.array(NameDescSchema).length(3)),
  baseLevels: z.array(z.object({ label: z.string(), desc: z.string() })).length(7),
  generalAddonCategories: z.record(z.string(), z.object({ label: z.string(), addons: z.array(z.string()) })),
  generalAddonDefs: z.record(
    z.string(),
    z.object({
      key: z.string(),
      label: z.string(),
      desc: z.string(),
      tiers: z.array(TierLabelSchema).min(1),
      costKey: z.string().optional(),
      isSellOption: z.boolean().optional(),
    }),
  ),
});

export type SkillTreeContent = z.infer<typeof SkillTreeContentSchema>;
