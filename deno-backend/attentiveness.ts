export interface AttentivenessInput {
  gaze_x: number;
  gaze_y: number;
  bridgeStatus: string;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[.\s]+$/g, "");
}

/**
 * Attentiveness rules:
 * - If gaze_x or gaze_y is outside [-2, 2], attentiveness = 0
 * - If bridgeStatus is:
 *   - "No issues detected." => 1
 *   - "Face is not centered." => 1
 *   - "No faces found" => 0
 * - Otherwise => 0
 */
export function getAttentiveness(input: AttentivenessInput): number {
    
  const { gaze_x, gaze_y } = input;

  const status = normalizeStatus(input.bridgeStatus);
  console.log("Normalized status:", JSON.stringify(status));

  // Ignore these bridge status issues - treat as normal attentiveness
  if (status === "face is too close or too far away") return 1;
  if (status === "more than one face found") return 1;

  if (status === "no faces found") return 0;

  if (!Number.isFinite(gaze_x) || !Number.isFinite(gaze_y)) {
    return 0;
  }

  const absX = Math.abs(gaze_x);
  const absY = Math.abs(gaze_y);

//   // Hard fail: gaze way off-screen
//   if (absX > .8 || absY > .8) {
//     return 0.5;
//   }

  // Soft penalty: gaze drifting away from center
  if (absX > 0.8 || absY > 0.8) {
    return 0.5;
  }

  if (status === "no issues detected") return 1;
  if (status === "face is not centered") return 1;
  return 0;
}
