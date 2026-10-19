import "server-only";
import type { z } from "zod";
import { readLLMConfig } from "@/lib/llm/config";
import { generateObject as generateWith, type GenerateObjectRequest } from "@/lib/llm/generate";
import { createAnthropicProvider } from "@/lib/llm/providers/anthropic";
import { createGeminiProvider } from "@/lib/llm/providers/gemini";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { LLMProvider } from "@/lib/llm/types";

export * from "@/lib/llm/errors";
export type { GenerateObjectResult } from "@/lib/llm/generate";
export type { LLMProvider, LLMUsage } from "@/lib/llm/types";

/** Provider choisi par LLM_PROVIDER (mock par défaut). */
export function getProvider(env: Record<string, string | undefined> = process.env): LLMProvider {
  const config = readLLMConfig(env);
  switch (config.provider) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      return createAnthropicProvider(config);
    case "gemini":
      return createGeminiProvider(config);
  }
}

/** generateObject avec le provider configuré, sauf si un provider est passé explicitement. */
export function generateObject<T extends z.ZodObject, L extends z.ZodType = T>(
  request: Omit<GenerateObjectRequest<T, L>, "provider"> & { provider?: LLMProvider },
) {
  return generateWith({ ...request, provider: request.provider ?? getProvider() });
}
