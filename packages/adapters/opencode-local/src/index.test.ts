import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_OPENCODE_MODELS,
  DEFAULT_OPENCODE_LOCAL_MODEL,
  PREFERRED_OPENCODE_MODEL,
  isDeepSeekOpenCodeModelId,
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

  it("prefers a directly served DeepSeek model when that is what the host exposes", () => {
    // Observed on a real host: OpenCode exposed `deepseek/...` names and never
    // the OpenRouter id. Matching only the exact id preselected the OpenAI
    // default there, which the catalog did not carry either — so the field was
    // filled with a model that could not run.
    expect(
      resolvePreferredOpenCodeModel([
        { id: "deepseek/deepseek-flash" },
        { id: "deepseek/deepseek-v4-pro" },
        { id: "opencode/big-pickle" },
      ]),
    ).toBe("deepseek/deepseek-flash");
  });

  it("prefers a chat variant over a reasoning one", () => {
    // Both are DeepSeek; a general model is the better default for an agent
    // doing mixed work, and the reasoning variant is slower and dearer.
    expect(
      resolvePreferredOpenCodeModel([
        { id: "deepseek/deepseek-reasoner" },
        { id: "deepseek/deepseek-chat" },
      ]),
    ).toBe("deepseek/deepseek-chat");
  });

  it("still applies the exact OpenRouter id ahead of other DeepSeek variants", () => {
    expect(
      resolvePreferredOpenCodeModel([
        { id: "deepseek/deepseek-chat" },
        { id: PREFERRED_OPENCODE_MODEL },
      ]),
    ).toBe(PREFERRED_OPENCODE_MODEL);
  });

  it("falls back to the OpenAI default when DeepSeek is absent", () => {
    expect(
      resolvePreferredOpenCodeModel([{ id: DEFAULT_OPENCODE_LOCAL_MODEL }]),
    ).toBe(DEFAULT_OPENCODE_LOCAL_MODEL);
  });

  it("returns nothing rather than an unavailable default when the catalog is empty", () => {
    // Discovery failing is not evidence the OpenAI default is installed.
    // Naming it anyway fills the required field with a model that cannot run,
    // which is the failure this function exists to prevent. The picker accepts
    // a typed id for this case.
    expect(resolvePreferredOpenCodeModel([])).toBe("");
  });

  it("returns nothing when the catalog carries neither DeepSeek nor the default", () => {
    expect(
      resolvePreferredOpenCodeModel([{ id: "opencode/big-pickle" }]),
    ).toBe("");
  });
});

describe("isDeepSeekOpenCodeModelId", () => {
  it("accepts direct and OpenRouter-nested DeepSeek ids", () => {
    expect(isDeepSeekOpenCodeModelId("deepseek/deepseek-chat")).toBe(true);
    expect(isDeepSeekOpenCodeModelId(PREFERRED_OPENCODE_MODEL)).toBe(true);
    expect(isDeepSeekOpenCodeModelId("deepseek/deepseek-v4-pro")).toBe(true);
  });

  it("rejects a different provider whose model name merely mentions DeepSeek", () => {
    // Matching on the provider segment, not a substring: another vendor naming
    // its model after DeepSeek is not DeepSeek, and adopting it would bill the
    // wrong account.
    expect(isDeepSeekOpenCodeModelId("openai/deepseek-alike")).toBe(false);
    expect(isDeepSeekOpenCodeModelId("openrouter/openai/deepseek-distill")).toBe(false);
    expect(isDeepSeekOpenCodeModelId("deepseek")).toBe(false);
  });
});

describe("DeepSeek catalog entries", () => {
  it("lists the direct-API DeepSeek models as provider/model ids", () => {
    for (const model of DEEPSEEK_OPENCODE_MODELS) {
      expect(model.id.startsWith("deepseek/")).toBe(true);
      expect(model.id.indexOf("/")).toBeLessThan(model.id.length - 1);
    }
  });

  it("carries both the OpenRouter and direct DeepSeek ids in the static catalog", () => {
    const ids = openCodeModels.map((model) => model.id);
    expect(ids).toContain(PREFERRED_OPENCODE_MODEL);
    expect(ids).toContain("deepseek/deepseek-chat");
    expect(ids).toContain("deepseek/deepseek-reasoner");
  });

  it("does not duplicate ids in the static catalog", () => {
    const ids = openCodeModels.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
