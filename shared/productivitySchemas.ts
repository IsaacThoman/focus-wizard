import { z } from "zod";

export const getProductivityConfidenceRequestSchema = z.object({
  screenshotBase64: z.string().min(1),
  capturedAt: z.string().datetime().optional(),
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

export const getAttentivenessRequestSchema = z.object({
  gaze_x: z.number(),
  gaze_y: z.number(),
  bridgeStatus: z.string().min(1),
  capturedAt: z.string().datetime().optional(),
});

export const getAttentivenessResponseSchema = z.object({
  attentiveness: z.number().min(0).max(1),
});

export type GetAttentivenessRequest = z.infer<typeof getAttentivenessRequestSchema>;
export type GetAttentivenessResponse = z.infer<
  typeof getAttentivenessResponseSchema
>;
