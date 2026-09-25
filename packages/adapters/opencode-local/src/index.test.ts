import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_OPENROUTER_MODELS,
  DEFAULT_OPENCODE_LOCAL_MODEL,
  PREFERRED_OPENCODE_MODEL,
  isDeepSeekOpenRouterModelId,
  models as openCodeModels,
  resolvePreferredOpenCodeModel,
} from "./index.js";

describe("resolvePreferredOpenCodeModel", () => {
  it("prefers the exact OpenRouter DeepSeek id when the catalog offers it", () => {
    // The catalog is the only evidence the provider is reachable on this host,
    // so a discovered DeepSeek is what makes the preference safe to apply.
    expect(
      resolvePreferredOpenCodeModel([
        { id: DEFAULT_OPENCODE_LOCAL_MODEL },
        { id: PREFERRED_OPENCODE_MODEL },
      ]),
    ).toBe(PREFERRED_OPENCODE_MODEL);
  });

  it("picks a real DeepSeek variant out of the live-shaped OpenRouter catalog", () => {
    // Ids observed from https://openrouter.ai/api/v1/models, with the preferred
    // id removed — the case the family match exists for, and the one a real
    // host hit when OpenRouter carried v4.1 but not the pinned v4 id.
    const catalog = [
      { id: "openrouter/deepseek/deepseek-v4.1-flash:batch" },
      { id: "openrouter/deepseek/deepseek-v4-pro-0813" },
      { id: "openrouter/anthropic/claude-sonnet-4.5" },
      { id: "openrouter/openai/gpt-5.2-codex" },
    ];
    expect(PREFERRED_OPENCODE_MODEL).not.toBe("openrouter/deepseek/deepseek-v4.1-flash:batch");
    expect(resolvePreferredOpenCodeModel(catalog)).toBe(
      "openrouter/deepseek/deepseek-v4.1-flash:batch",
    );
  });

  it("prefers the DeepSeek family when OpenRouter ships a different variant", () => {
    // OpenRouter gains and retires variants, so matching one exact id would let
    // the default lapse the moment that id moves.
    expect(
      resolvePreferredOpenCodeModel([
        { id: "openrouter/deepseek/deepseek-v4-pro" },
        { id: DEFAULT_OPENCODE_LOCAL_MODEL },
      ]),
    ).toBe("openrouter/deepseek/deepseek-v4-pro");
  });

  it("prefers a chat or flash variant over a reasoning one", () => {
    // Both are DeepSeek; a general model is the better default for an agent
    // doing mixed work, and the reasoning variant is slower and dearer.
    expect(
      resolvePreferredOpenCodeModel([
        { id: "openrouter/deepseek/deepseek-v4-reasoner" },
        { id: "openrouter/deepseek/deepseek-v4-chat" },
        { id: "openrouter/deepseek/deepseek-v4-flash" },
      ]),
    ).toBe("openrouter/deepseek/deepseek-v4-chat");
  });

  it("never adopts a directly billed deepseek model", () => {
    // `deepseek/...` bills DeepSeek directly. This build configures no DeepSeek
    // account, so adopting one would put the agent on a provider with no key.
    expect(
      resolvePreferredOpenCodeModel([
        { id: "deepseek/deepseek-chat" },
        { id: "deepseek/deepseek-reasoner" },
      ]),
    ).toBe("");
  });

  it("prefers OpenRouter DeepSeek over a directly billed DeepSeek model", () => {
    expect(
      resolvePreferredOpenCodeModel([
        { id: "deepseek/deepseek-chat" },
        { id: PREFERRED_OPENCODE_MODEL },
      ]),
    ).toBe(PREFERRED_OPENCODE_MODEL);
  });

  it("falls back to the OpenAI default when no OpenRouter DeepSeek is offered", () => {
    expect(
      resolvePreferredOpenCodeModel([{ id: DEFAULT_OPENCODE_LOCAL_MODEL }]),
    ).toBe(DEFAULT_OPENCODE_LOCAL_MODEL);
  });

  it("returns nothing rather than an unavailable default when the catalog is empty", () => {
    // Discovery failing is not evidence the OpenAI default is installed.
    // Naming it anyway fills the required field with a model that cannot run.
    expect(resolvePreferredOpenCodeModel([])).toBe("");
  });

  it("returns nothing when the catalog carries neither DeepSeek nor the default", () => {
    expect(
      resolvePreferredOpenCodeModel([{ id: "opencode/big-pickle" }]),
    ).toBe("");
  });
});

describe("isDeepSeekOpenRouterModelId", () => {
  it("accepts nested OpenRouter DeepSeek ids", () => {
    expect(isDeepSeekOpenRouterModelId(PREFERRED_OPENCODE_MODEL)).toBe(true);
    expect(isDeepSeekOpenRouterModelId("openrouter/deepseek/deepseek-v4-pro")).toBe(true);
    expect(isDeepSeekOpenRouterModelId("OpenRouter/DeepSeek/DeepSeek-V4-Pro")).toBe(true);
  });

  it("rejects a directly billed deepseek id", () => {
    // The whole point of scoping to OpenRouter: this route bills another
    // account, and no key for it is configured on this build.
    expect(isDeepSeekOpenRouterModelId("deepseek/deepseek-chat")).toBe(false);
  });

  it("rejects another vendor's model that merely names DeepSeek", () => {
    // Matching on the provider segment, not a substring: another vendor naming
    // its model after DeepSeek is not DeepSeek, and adopting it would bill the
    // wrong account.
    expect(isDeepSeekOpenRouterModelId("openai/deepseek-alike")).toBe(false);
    expect(isDeepSeekOpenRouterModelId("openrouter/openai/deepseek-distill")).toBe(false);
  });

  it("rejects an id with no model segment", () => {
    expect(isDeepSeekOpenRouterModelId("openrouter/deepseek")).toBe(false);
    expect(isDeepSeekOpenRouterModelId("openrouter/deepseek/")).toBe(false);
  });
});

describe("OpenRouter DeepSeek catalog entries", () => {
  it("lists every entry as an openrouter/deepseek model id", () => {
    for (const model of DEEPSEEK_OPENROUTER_MODELS) {
      expect(model.id.startsWith("openrouter/deepseek/")).toBe(true);
      expect(isDeepSeekOpenRouterModelId(model.id)).toBe(true);
    }
  });

  it("carries the DeepSeek ids in the static catalog", () => {
    const ids = openCodeModels.map((model) => model.id);
    expect(ids).toContain(PREFERRED_OPENCODE_MODEL);
    expect(ids).toContain("openrouter/deepseek/deepseek-v4-pro");
  });

  it("carries no directly billed deepseek id", () => {
    // The static catalog is what a remote environment sees, so a stray
    // `deepseek/...` entry here would offer an agent a route with no key.
    for (const model of openCodeModels)
      expect(model.id.startsWith("deepseek/")).toBe(false);
  });

  it("does not duplicate ids in the static catalog", () => {
    const ids = openCodeModels.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
