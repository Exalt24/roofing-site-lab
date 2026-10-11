// The only place that talks to a model provider. Everything else takes an LlmFn, so tests inject recorded or deliberately bad outputs.
import sharp from "sharp";
import type { LlmFn } from "./types.ts";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
export const VISION_MODEL = "anthropic/claude-haiku-5.5";

function key(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY is not set (only the hosted-model path needs it; the local Ollama path does not)");
  return k;
}

async function chat(body: object): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { choices?: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; error?: { message: string } };
  if (!res.ok || !json.choices) throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 200)}`);
  return { content: json.choices[0].message.content, usage: json.usage ?? { prompt_tokens: 0, completion_tokens: 0 } };
}

export const usage = { prompt: 0, completion: 0, calls: 0 };

export const openrouterJson: LlmFn = async ({ system, user, schema, model }) => {
  const r = await chat({
    model, temperature: 0.2, max_tokens: 3500,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_schema", json_schema: { name: "draft", strict: true, schema } },
  });
  usage.prompt += r.usage.prompt_tokens; usage.completion += r.usage.completion_tokens; usage.calls++;
  return JSON.parse(r.content);
};

// Vision step. The model may describe only what is visible; the result is stored as a LOW TRUST fact.
export async function describePhoto(file: string, model = VISION_MODEL): Promise<string> {
  const jpg = await sharp(file).rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer(); // rotate() applies EXIF orientation; sharp then drops all metadata including GPS
  const r = await chat({
    model, temperature: 0, max_tokens: 200,
    messages: [{ role: "user", content: [
      { type: "text", text: "Describe in one sentence of at most 25 words only what is clearly visible in this roofing photograph (roof shape, colour, visible condition, surroundings). Do not name a material, brand, size or measurement unless it is plainly readable. Do not guess. Return JSON {\"description\": string}." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpg.toString("base64")}` } },
    ] }],
    response_format: { type: "json_schema", json_schema: { name: "photo", strict: true, schema: { type: "object", additionalProperties: false, required: ["description"], properties: { description: { type: "string" } } } } },
  });
  usage.prompt += r.usage.prompt_tokens; usage.completion += r.usage.completion_tokens; usage.calls++;
  return (JSON.parse(r.content) as { description: string }).description;
}
