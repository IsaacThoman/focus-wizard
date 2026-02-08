import { assertEquals } from "@std/assert";
import {
  getAttentivenessRequestSchema,
  getAttentivenessResponseSchema,
  getProductivityConfidenceRequestSchema,
  getProductivityConfidenceResponseSchema,
} from "../shared/productivitySchemas.ts";
import { getAttentiveness } from "./attentiveness.ts";

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

Deno.test("attentiveness request schema accepts gaze + status", () => {
  const payload = {
    gaze_x: 0.1,
    gaze_y: -0.2,
    bridgeStatus: "No issues detected.",
    capturedAt: new Date().toISOString(),
  };

  const parsed = getAttentivenessRequestSchema.safeParse(payload);
  assertEquals(parsed.success, true);
});

Deno.test("attentiveness response schema rejects values outside [0,1]", () => {
  const parsed = getAttentivenessResponseSchema.safeParse({
    attentiveness: -1,
  });

  assertEquals(parsed.success, false);
});

Deno.test("getAttentiveness returns 0 when gaze out of bounds", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 2.1,
      gaze_y: 0,
      bridgeStatus: "No issues detected.",
    }),
    0,
  );
});

Deno.test("getAttentiveness returns 0.5 when gaze slightly out of center", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0.81,
      gaze_y: 0,
      bridgeStatus: "No issues detected.",
    }),
    0.5,
  );
});

Deno.test("getAttentiveness returns 0 for No faces found even if gaze is off", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0.81,
      gaze_y: 0,
      bridgeStatus: "No faces found",
    }),
    0,
  );
});

Deno.test("getAttentiveness returns 1 for No issues detected.", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0,
      gaze_y: 0,
      bridgeStatus: "No issues detected.",
    }),
    1,
  );
});

Deno.test("getAttentiveness returns 1 for Face is not centered.", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0,
      gaze_y: 0,
      bridgeStatus: "Face is not centered.",
    }),
    1,
  );
});

Deno.test("getAttentiveness returns 0 for No faces found", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0,
      gaze_y: 0,
      bridgeStatus: "No faces found",
    }),
    0,
  );
});

Deno.test("getAttentiveness is robust to missing trailing period", () => {
  assertEquals(
    getAttentiveness({
      gaze_x: 0,
      gaze_y: 0,
      bridgeStatus: "No issues detected",
    }),
    1,
  );
});
