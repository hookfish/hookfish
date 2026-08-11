import { z } from 'zod'

export const inspectorFeaturesSchema = z.object({
  tools: z.boolean(),
  resources: z.boolean(),
  prompts: z.boolean(),
  elicitation: z.boolean(),
})

export type InspectorFeatures = z.infer<typeof inspectorFeaturesSchema>

export const defaultInspectorFeatures: InspectorFeatures = {
  tools: true,
  resources: true,
  prompts: true,
  elicitation: true,
}
