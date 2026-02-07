import { assertEquals } from "@std/assert";
import {
  getProductivityConfidenceRequestSchema,
  getProductivityConfidenceResponseSchema,
} from "../shared/productivitySchemas.ts";

Deno.test("request schema accepts screenshot payload", () => {
  const payload = {
    screenshotBase64: "Zm9v",
    capturedAt: new Date().toISOString(),
  };

  const parsed = getProductivityConfidenceRequestSchema.safeParse(payload);
  assertEquals(parsed.success, true);
});

Deno.test("response schema rejects confidence outside [0,1]", () => {
  const parsed = getProductivityConfidenceResponseSchema.safeParse({
    productivityConfidence: 2,
  });

  assertEquals(parsed.success, false);
});
