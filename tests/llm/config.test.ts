import { describe, expect, test } from "bun:test";
import { readLLMConfig } from "@/lib/llm/config";
import { LLMConfigError } from "@/lib/llm/errors";
import { getProvider } from "@/lib/llm";

describe("configuration (LLM_PROVIDER)", () => {
  test("mock par défaut, variable vide ignorée", () => {
    expect(readLLMConfig({})).toEqual({ provider: "mock" });
    expect(readLLMConfig({ LLM_PROVIDER: "" })).toEqual({ provider: "mock" });
    expect(getProvider({}).name).toBe("mock");
  });

  test("seuls mock et cominty existent : les anciens providers sont refusés avec un message clair", () => {
    for (const old of ["gemini", "anthropic", "openai"]) {
      expect(() => readLLMConfig({ LLM_PROVIDER: old })).toThrow(LLMConfigError);
    }
    expect(() => readLLMConfig({ LLM_PROVIDER: "gemini" })).toThrow(/cominty/);
  });

  test("cominty : configuration propre (COMINTY_*), pas de LLM_MODEL", () => {
    expect(readLLMConfig({ LLM_PROVIDER: "cominty" })).toEqual({ provider: "cominty" });
  });
});
