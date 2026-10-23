import "server-only";
import type { z } from "zod";
import { readLLMConfig, type ModelTier } from "@/lib/llm/config";
import { generateObject as generateWith, type GenerateObjectRequest } from "@/lib/llm/generate";
import { createAnthropicProvider } from "@/lib/llm/providers/anthropic";
import { createComintyProvider, defaultClient } from "@/lib/llm/providers/cominty";
import { createGeminiProvider } from "@/lib/llm/providers/gemini";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { LLMProvider } from "@/lib/llm/types";

export * from "@/lib/llm/errors";
export type { GenerateObjectResult } from "@/lib/llm/generate";
export type { LLMProvider, LLMUsage } from "@/lib/llm/types";
export type { ModelTier } from "@/lib/llm/config";

/** Provider choisi par LLM_PROVIDER (mock par défaut), avec le modèle du niveau demandé. */
export function getProvider(env: Record<string, string | undefined> = process.env, tier: ModelTier = "default"): LLMProvider {
  const config = readLLMConfig(env, tier);
  switch (config.provider) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      return createAnthropicProvider(config);
    case "gemini":
      return createGeminiProvider(config);
    case "cominty":
      return createComintyProvider(defaultClient(env));
  }
}

/** generateObject avec le provider configuré (niveau `tier`), sauf si un provider est passé explicitement. */
export function generateObject<T extends z.ZodObject, L extends z.ZodType = T>(
  request: Omit<GenerateObjectRequest<T, L>, "provider"> & { provider?: LLMProvider; tier?: ModelTier },
) {
  const { tier, ...rest } = request;
  return generateWith({ ...rest, provider: request.provider ?? getProvider(process.env, tier) });
}
