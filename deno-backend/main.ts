import { Application, Router, Status } from "@oak/oak";
import { z } from "zod";
import {
  getAttentivenessRequestSchema,
  getAttentivenessResponseSchema,
  getProductivityConfidenceRequestSchema,
  getProductivityConfidenceResponseSchema,
} from "../shared/productivitySchemas.ts";
import { createWalletRouter } from "./walletRouter.ts";
import { getAttentiveness } from "./attentiveness.ts";

const PORT = 8000;
const OPENAI_BASE_URL = Deno.env.get("OPENAI_BASE_URL") ??
  "https://api.openai.com/v1";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You are a wizard-themed focus coach. Return strict JSON only with two fields: confidence (0..1) and voiceLine (1..280 chars). Use the screenshot plus the user's goals/avoid list to judge on-task confidence. If the screenshot is off-task, voiceLine must call out the specific off-task app/site/activity visible (for example 'instagram.com feed') and command a return to task in a wizardly tone. If on-task, voiceLine should briefly encourage continued focus in wizard style. Keep voiceLine concise, punchy, and safe for work.";

const DEFAULT_POSITIVE_PROMPT = "studying for calculus";
const DEFAULT_NEGATIVE_PROMPT = "instagram\ntwitter";
const WIZARD_SAYING_EXAMPLES = [
  "On distractions again, are we? Back to the task now.",
  "You must return to your duties.",
  "Fooooocus, apprentice. One minute of effort now.",
  "No side quests. One task. One breath. Go.",
  "Banish the distraction and resume your work.",
];

function buildUserPrompt(positivePrompt?: string, negativePrompt?: string): string {
  const goal = positivePrompt?.trim() || DEFAULT_POSITIVE_PROMPT;
  const avoid = negativePrompt?.trim() || DEFAULT_NEGATIVE_PROMPT;
  const sayingsBlock = WIZARD_SAYING_EXAMPLES.map((line) => `- ${line}`).join("\n");
  return `Analyze this screenshot and return JSON with:
- confidence: number from 0 to 1 for how on-task the user is
- voiceLine: one short wizard line to speak aloud

Rules for voiceLine:
- If off-task, explicitly name what is visible and off-task (site/app/activity)."
- If not clearly off-task, avoid hallucinating exact websites.
- Match the style of these sayings:
${sayingsBlock}

User's intended goal:
${goal}

Things the user wants to avoid:
${avoid}`;
}

const apiResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
  voiceLine: z.string().min(1).max(280),
});
type ModelFocusResult = z.infer<typeof apiResponseSchema>;
const partialApiResponseSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  voiceLine: z.string().optional(),
});

function normalizeImageDataUrl(input: string): string {
  if (input.startsWith("data:image/")) {
    return input;
  }

  return `data:image/png;base64,${input}`;
}

function sanitizeVoiceLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function buildFallbackVoiceLine(confidence: number): string {
  if (confidence < 0.5) {
    return "Back to your task, apprentice. Banish this distraction now.";
  }
  return "Steady focus, apprentice. Keep casting progress.";
}

function extractMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const asRecord = message as Record<string, unknown>;
  const content = asRecord.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") {
        parts.push(p.text);
        continue;
      }
      if (
        p.text && typeof p.text === "object" &&
        typeof (p.text as Record<string, unknown>).value === "string"
      ) {
        parts.push((p.text as Record<string, unknown>).value as string);
      }
    }
    const combined = parts.join("\n").trim();
    return combined || null;
  }

  return null;
}

function parseModelJsonPayload(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model content was not valid JSON");
    }
    return JSON.parse(match[0]);
  }
}

async function getConfidenceFromModel(
  screenshotBase64: string,
  positivePrompt?: string,
  negativePrompt?: string,
): Promise<ModelFocusResult> {
  const startedAt = performance.now();
  let confidenceForLog: number | null = null;
  let voiceLineForLog = "";
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildUserPrompt(positivePrompt, negativePrompt),
              },
              {
                type: "image_url",
                image_url: {
                  url: normalizeImageDataUrl(screenshotBase64),
                },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "focus_confidence",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["confidence", "voiceLine"],
              properties: {
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                },
                voiceLine: {
                  type: "string",
                  minLength: 1,
                  maxLength: 280,
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model API error ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    const message = json?.choices?.[0]?.message;
    const refusal = typeof message?.refusal === "string" ? message.refusal : "";
    if (refusal) {
      const confidence = 0.5;
      const voiceLine = "The vision spell was blocked. Return to your quest.";
      confidenceForLog = confidence;
      voiceLineForLog = voiceLine;
      return { confidence, voiceLine };
    }

    const content = extractMessageText(message);
    if (!content) {
      throw new Error(
        `Model response was missing text content (finish_reason: ${
          json?.choices?.[0]?.finish_reason ?? "unknown"
        })`,
      );
    }

    const parsedJson = parseModelJsonPayload(content);
    const strictParsed = apiResponseSchema.safeParse(parsedJson);
    if (strictParsed.success) {
      const voiceLine = sanitizeVoiceLine(strictParsed.data.voiceLine);
      if (!voiceLine) {
        throw new Error("Model returned an empty voiceLine");
      }

      confidenceForLog = strictParsed.data.confidence;
      voiceLineForLog = voiceLine;
      return {
        confidence: strictParsed.data.confidence,
        voiceLine,
      };
    }

    // Fallback parser: tolerate older/partial outputs and fill missing fields.
    const partialParsed = partialApiResponseSchema.safeParse(parsedJson);
    if (!partialParsed.success || partialParsed.data.confidence === undefined) {
      throw new Error(
        `Model response schema validation failed. Raw: ${content.slice(0, 400)}`,
      );
    }

    const confidence = partialParsed.data.confidence;
    const voiceLine = sanitizeVoiceLine(
      partialParsed.data.voiceLine || buildFallbackVoiceLine(confidence),
    );
    confidenceForLog = confidence;
    voiceLineForLog = voiceLine;
    return { confidence, voiceLine };
  } finally {
    const elapsedMs = performance.now() - startedAt;
    const confidenceText = confidenceForLog === null
      ? "n/a"
      : confidenceForLog.toFixed(2);
    console.log(
      `OpenAI request end-to-end took ${
        elapsedMs.toFixed(0)
      }ms, confidence: ${confidenceText}, voiceLine: ${
        voiceLineForLog || "n/a"
      }`,
    );
  }
}

const router = new Router();

router.post("/getProductivityConfidence", async (ctx: any) => {
  try {
    const body = await ctx.request.body.json();
    const parsed = getProductivityConfidenceRequestSchema.safeParse(body);

    if (!parsed.success) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: "Invalid request body",
        issues: parsed.error.issues,
      };
      return;
    }

    const modelResult = await getConfidenceFromModel(
      parsed.data.screenshotBase64,
      parsed.data.positivePrompt,
      parsed.data.negativePrompt,
    );

    const responsePayload = getProductivityConfidenceResponseSchema.parse({
      productivityConfidence: modelResult.confidence,
      productivityVoiceLine: modelResult.voiceLine,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = responsePayload;
  } catch (error) {
    console.error("Productivity confidence request failed:", error);
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = {
      error: error instanceof Error ? error.message : "Internal server error",
    };
  }
});

router.post("/getAttentiveness", async (ctx: any) => {
  try {
    const body = await ctx.request.body.json();
    const parsed = getAttentivenessRequestSchema.safeParse(body);

    if (!parsed.success) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: "Invalid request body",
        issues: parsed.error.issues,
      };
      return;
    }

    const attentiveness = getAttentiveness({
      gaze_x: parsed.data.gaze_x,
      gaze_y: parsed.data.gaze_y,
      bridgeStatus: parsed.data.bridgeStatus,
    });

    const responsePayload = getAttentivenessResponseSchema.parse({
      attentiveness,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = responsePayload;
  } catch (error) {
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = {
      error: error instanceof Error ? error.message : "Internal server error",
    };
  }
});

const app = new Application();

app.use(async (ctx, next) => {
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type");

  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = Status.NoContent;
    return;
  }

  await next();
});

app.use(router.routes());
app.use(router.allowedMethods());

const walletRouter = createWalletRouter();
app.use(walletRouter.routes());
app.use(walletRouter.allowedMethods());

if (import.meta.main) {
  console.log(`Oak backend running on http://localhost:${PORT}`);
  await app.listen({ port: PORT });
}
