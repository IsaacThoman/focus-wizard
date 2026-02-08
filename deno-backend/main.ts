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
  "You are a focus coach model. Return only a confidence score for whether the user is on task. Provide a value close to or equal to 0 if they're doing something explicitly listed as off-task. Provide a value close to 0.5 if it's not something explicitly on-task or off-task. Provide a value close to or equal to 1 if they're explicitly on-task based on their own criteria. This is a gradient. Use your best judgement.";

const DEFAULT_POSITIVE_PROMPT = "studying for calculus";
const DEFAULT_NEGATIVE_PROMPT = "instagram\ntwitter AI bullshit";

function buildUserPrompt(positivePrompt?: string, negativePrompt?: string): string {
  const goal = positivePrompt?.trim() || DEFAULT_POSITIVE_PROMPT;
  const avoid = negativePrompt?.trim() || DEFAULT_NEGATIVE_PROMPT;
  return `Please provide a confidence score from 0-1 for how confident you are that this user is on task.\n\nUser's intended goal:\n${goal}\n\nThings the user would like to avoid:\n${avoid}`;
}

const apiResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
});

function normalizeImageDataUrl(input: string): string {
  if (input.startsWith("data:image/")) {
    return input;
  }

  return `data:image/png;base64,${input}`;
}

async function getConfidenceFromModel(
  screenshotBase64: string,
  positivePrompt?: string,
  negativePrompt?: string,
): Promise<number> {
  const startedAt = performance.now();
  let confidenceForLog: number | null = null;
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
              required: ["confidence"],
              properties: {
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
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
    const content = json?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error("Model response was missing a text content payload");
    }

    const parsedJson = JSON.parse(content);
    const parsed = apiResponseSchema.safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error("Model response schema validation failed");
    }

    confidenceForLog = parsed.data.confidence;
    return parsed.data.confidence;
  } finally {
    const elapsedMs = performance.now() - startedAt;
    const confidenceText = confidenceForLog === null
      ? "n/a"
      : confidenceForLog.toFixed(2);
    console.log(
      `OpenAI request end-to-end took ${
        elapsedMs.toFixed(0)
      }ms, confidence: ${confidenceText}`,
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

    const productivityConfidence = await getConfidenceFromModel(
      parsed.data.screenshotBase64,
      parsed.data.positivePrompt,
      parsed.data.negativePrompt,
    );

    const responsePayload = getProductivityConfidenceResponseSchema.parse({
      productivityConfidence,
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
