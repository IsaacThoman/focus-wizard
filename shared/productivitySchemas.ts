import { z } from "zod";

export const getProductivityConfidenceRequestSchema = z.object({
  screenshotBase64: z.string().min(1),
  capturedAt: z.string().datetime().optional(),
  positivePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
});

export const getProductivityConfidenceResponseSchema = z.object({
  productivityConfidence: z.number().min(0).max(1),
});

export type GetProductivityConfidenceRequest = z.infer<
  typeof getProductivityConfidenceRequestSchema
>;

export type GetProductivityConfidenceResponse = z.infer<
  typeof getProductivityConfidenceResponseSchema
>;
