import { describe, expect, it } from "vitest";
import {
  aiProviderForAdapter,
  aiProviderForModel,
  aiProvidersForAdapter,
} from "./AiConnectionField";

describe("aiProvidersForAdapter", () => {
  it("offers both DeepSeek accounts for OpenCode", () => {
    // OpenCode reaches DeepSeek directly or through OpenRouter. The two bill
    // different accounts and validate against different endpoints, so the card
    // has to offer both rather than pick one on the customer's behalf.
    expect(aiProvidersForAdapter("opencode_local")).toEqual(["deepseek", "openrouter"]);
  });

  it("offers exactly one provider for single-vendor adapters", () => {
    expect(aiProvidersForAdapter("claude_local")).toEqual(["anthropic"]);
    expect(aiProvidersForAdapter("codex_local")).toEqual(["openai"]);
    expect(aiProvidersForAdapter("grok_local")).toEqual(["xai"]);
  });

  it("offers none for an adapter with no provider", () => {
    expect(aiProvidersForAdapter("gemini_local")).toEqual([]);
  });
});

describe("aiProviderForModel", () => {
  it("reads a direct DeepSeek model as the DeepSeek account", () => {
    // The regression this guards: OpenCode hardcoded OpenRouter, so a DeepSeek
    // key was validated against OpenRouter and rejected as invalid.
    expect(aiProviderForModel("opencode_local", "deepseek/deepseek-flash")).toBe("deepseek");
    expect(aiProviderForModel("opencode_local", "deepseek/deepseek-chat")).toBe("deepseek");
  });

  it("reads an OpenRouter-nested model as the OpenRouter account", () => {
    expect(
      aiProviderForModel("opencode_local", "openrouter/deepseek/deepseek-v4-flash-0731"),
    ).toBe("openrouter");
  });

  it("leaves the provider unsettled when the model names neither", () => {
    // An OpenCode-only model proves nothing about which account pays, so the
    // explicit picker has to ask rather than guess.
    expect(aiProviderForModel("opencode_local", "opencode/big-pickle")).toBeUndefined();
    expect(aiProviderForModel("opencode_local", "")).toBeUndefined();
    expect(aiProviderForModel("opencode_local", undefined)).toBeUndefined();
  });

  it("returns the sole provider for a single-vendor adapter regardless of model", () => {
    expect(aiProviderForModel("claude_local", "claude-sonnet-4")).toBe("anthropic");
    expect(aiProviderForModel("claude_local", undefined)).toBe("anthropic");
  });

  it("falls back to the adapter default for unmapped adapters", () => {
    expect(aiProviderForModel("gemini_local", "gemini-2.5-pro")).toBeUndefined();
  });

  it("keeps the adapter-level default unchanged for existing callers", () => {
    // `aiProviderForAdapter` still answers OpenRouter for OpenCode, which the
    // agent config form and NewAgentSetup rely on.
    expect(aiProviderForAdapter("opencode_local")).toBe("openrouter");
  });
});
