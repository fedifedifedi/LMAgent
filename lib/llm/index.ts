import "server-only";
import type { z } from "zod";
import { readLLMConfig } from "@/lib/llm/config";
import { generateObject as generateWith, type GenerateObjectRequest } from "@/lib/llm/generate";
import { createComintyProvider, defaultClient } from "@/lib/llm/providers/cominty";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { LLMProvider } from "@/lib/llm/types";

export * from "@/lib/llm/errors";
export type { GenerateObjectResult } from "@/lib/llm/generate";
export type { LLMProvider, LLMUsage } from "@/lib/llm/types";

/** Provider choisi par LLM_PROVIDER : mock (défaut, sans réseau) ou cominty (agent managé). */
export function getProvider(env: Record<string, string | undefined> = process.env): LLMProvider {
  const config = readLLMConfig(env);
  switch (config.provider) {
    case "mock":
      return createMockProvider();
    case "cominty":
      return createComintyProvider(defaultClient(env));
  }
}

/** generateObject avec le provider configuré, sauf si un provider est passé explicitement. */
export function generateObject<T extends z.ZodObject, L extends z.ZodType = T>(request: Omit<GenerateObjectRequest<T, L>, "provider"> & { provider?: LLMProvider }) {
  return generateWith({ ...request, provider: request.provider ?? getProvider(process.env) });
}
