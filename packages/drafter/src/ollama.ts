// Local backend: Ollama on the same machine. Customer photos and job notes never leave the building, and it costs nothing per draft.
// The pipeline only needs an LlmFn, so the same drafter runs on a hosted model (llm.ts) when the company prefers one.
import sharp from "sharp";
import type { LlmFn } from "./types.ts";

export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const LOCAL_MODEL = "qwen3:14b";
export const LOCAL_VISION_MODEL = "qwen3.5:9b";

export const localUsage = { calls: 0, seconds: 0 };

async function chat(body: object): Promise<string> {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stream: false, ...body }) });
  const json = (await res.json()) as { message?: { content: string }; error?: string };
  localUsage.calls++; localUsage.seconds += (Date.now() - t0) / 1000;
  if (!res.ok || !json.message) throw new Error(`Ollama ${res.status}: ${json.error ?? "no message"}`);
  return json.message.content;
}

export const ollamaJson: LlmFn = async ({ system, user, schema, model }) => {
  const content = await chat({
    model, think: false, format: schema,
    options: { temperature: 0.2, num_ctx: 8192, num_predict: 3000 },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return JSON.parse(content);
};

export async function describePhotoLocal(file: string, model = LOCAL_VISION_MODEL): Promise<string> {
  const jpg = await sharp(file).rotate().resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  const content = await chat({
    model, think: false,
    format: { type: "object", additionalProperties: false, required: ["description"], properties: { description: { type: "string" } } },
    options: { temperature: 0, num_ctx: 4096, num_predict: 120 },
    messages: [{ role: "user", content: "Describe in one sentence of at most 25 words only what is clearly visible in this roofing photograph (roof shape, colour, visible condition, surroundings). Do not name a material, brand, size or measurement unless it is plainly readable. Do not guess. Return JSON {\"description\": string}.", images: [jpg.toString("base64")] }],
  });
  return (JSON.parse(content) as { description: string }).description;
}

