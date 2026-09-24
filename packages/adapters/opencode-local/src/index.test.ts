import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_OPENCODE_MODELS,
  DEFAULT_OPENCODE_LOCAL_MODEL,
  PREFERRED_OPENCODE_MODEL,
  models as openCodeModels,
  resolvePreferredOpenCodeModel,
} from "./index.js";

describe("resolvePreferredOpenCodeModel", () => {
  it("prefers DeepSeek when the catalog offers it", () => {
    // The catalog is the only evidence the provider is reachable on this host,
    // so a discovered DeepSeek is what makes the preference safe to apply.
    expect(
      resolvePreferredOpenCodeModel([
        { id: DEFAULT_OPENCODE_LOCAL_MODEL },
        { id: PREFERRED_OPENCODE_MODEL },
      ]),
    ).toBe(PREFERRED_OPENCODE_MODEL);
  });

  it("falls back to the OpenAI default when DeepSeek is absent", () => {
    expect(
      resolvePreferredOpenCodeModel([{ id: DEFAULT_OPENCODE_LOCAL_MODEL }]),
    ).toBe(DEFAULT_OPENCODE_LOCAL_MODEL);
  });

  it("falls back when the catalog is empty", () => {
    // Discovery failing must not preselect a model nothing has proven runs.
    expect(resolvePreferredOpenCodeModel([])).toBe(DEFAULT_OPENCODE_LOCAL_MODEL);
  });

  it("does not accept a lookalike DeepSeek model as the preference", () => {
    expect(
      resolvePreferredOpenCodeModel([
        { id: "openrouter/deepseek/deepseek-v3.1" },
      ]),
    ).toBe(DEFAULT_OPENCODE_LOCAL_MODEL);
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
