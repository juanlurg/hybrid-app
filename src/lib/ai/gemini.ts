import "server-only";

import { GoogleGenAI } from "@google/genai";

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "Falta GEMINI_API_KEY. Añádela a .env.local y reinicia el servidor para poder refinar el plan con IA.",
    );
    this.name = "MissingApiKeyError";
  }
}

/**
 * A failed Gemini call, classified so the caller can decide: `parse`
 * and `empty` are worth ONE repair retry (the model responded, badly);
 * `http` (429, 5xx, network) is not — retrying immediately doubles the
 * load on a service that just said no.
 */
export class GeminiCallError extends Error {
  readonly kind: "http" | "empty" | "parse";
  readonly status: number | null;

  constructor(kind: "http" | "empty" | "parse", message: string, status: number | null = null) {
    super(message);
    this.name = "GeminiCallError";
    this.kind = kind;
    this.status = status;
  }
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  return new GoogleGenAI({ apiKey });
}

export interface JsonCallOptions {
  systemInstruction: string;
  contents: Array<{ role: "user" | "model"; text: string }>;
  jsonSchema: unknown;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * One structured-output call. Returns parsed JSON, or throws with a
 * message that is safe to show the athlete.
 */
export async function generateJson<T = unknown>(
  opts: JsonCallOptions,
): Promise<{ data: T; usage: Record<string, number> }> {
  const ai = client();

  let response;
  try {
    response = await ai.models.generateContent({
      model: geminiModel(),
      contents: opts.contents.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
      config: {
        systemInstruction: opts.systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: opts.jsonSchema,
        temperature: opts.temperature ?? 0.35,
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
        // Structured output needs no chain of thought, and 2.5 models
        // think by default INSIDE maxOutputTokens — a long programme
        // generation was silently truncating mid-JSON.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (cause) {
    const status =
      typeof (cause as { status?: unknown })?.status === "number"
        ? ((cause as { status: number }).status)
        : null;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new GeminiCallError("http", message, status);
  }

  const text = response.text;
  if (!text) {
    throw new GeminiCallError(
      "empty",
      "Gemini no ha devuelto nada. Puede ser un corte de la respuesta: prueba a acotar la pregunta.",
    );
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new GeminiCallError(
      "parse",
      "Gemini ha devuelto un JSON que no se puede leer.",
    );
  }

  const usage = response.usageMetadata ?? {};
  return {
    data,
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      responseTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
    },
  };
}
