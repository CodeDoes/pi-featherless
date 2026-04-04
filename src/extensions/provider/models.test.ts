import { describe, expect, it } from "vitest";
import { FEATHERLESS_MODELS } from "./models.js";

describe("FEATHERLESS_MODELS", () => {
  it("has at least one model", () => {
    expect(FEATHERLESS_MODELS.length).toBeGreaterThan(0);
  });

  it("all models have required fields", () => {
    for (const model of FEATHERLESS_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(typeof model.reasoning).toBe("boolean");
      expect(model.input).toContain("text");
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxTokens).toBeGreaterThan(0);
      expect(model.cost).toBeDefined();
    }
  });

  it("Qwen3 models have qwen thinking compat", () => {
    const qwen3Models = FEATHERLESS_MODELS.filter((m) =>
      m.id.startsWith("Qwen/Qwen3"),
    );
    expect(qwen3Models.length).toBeGreaterThan(0);
    for (const model of qwen3Models) {
      expect(model.reasoning).toBe(true);
      expect(model.compat).toBeDefined();
      expect((model.compat as any)?.thinkingFormat).toBe("qwen");
    }
  });
});
