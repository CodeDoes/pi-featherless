import { describe, expect, it, vi } from "vitest";
import { registerFeatherlessProvider } from "./index";
import { FEATHERLESS_MODELS } from "./models";

describe("Featherless provider registration", () => {
  const createMockPi = (flags: Record<string, boolean> = {}) => ({
    registerProvider: vi.fn(),
    on: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn((name) => flags[name] || false),
  } as any);

  it("should register models with IDs that match the FEATHERLESS_MODELS (non-gated, available)", () => {
    const mockPi = createMockPi();
    registerFeatherlessProvider(mockPi);

    expect(mockPi.registerProvider).toHaveBeenCalled();
    const [providerId, config] = mockPi.registerProvider.mock.calls[0];

    expect(providerId).toBe("featherless");
    
    // Default: filters out gated and unavailable models
    const expectedModels = FEATHERLESS_MODELS.filter(m => !m.isGated && m.availableOnPlan !== false);
    expect(config.models).toHaveLength(expectedModels.length);
    
    for (const model of expectedModels) {
      expect(config.models.find((m: any) => m.id === model.id)).toBeDefined();
    }
  });

  it("should find a model by ID when simulating pi's lookup", () => {
    const mockPi = createMockPi();
    registerFeatherlessProvider(mockPi);
    const config = mockPi.registerProvider.mock.calls[0][1];
    
    const targetModelId = FEATHERLESS_MODELS.find(m => !m.isGated && m.availableOnPlan !== false)!.id;
    const foundModel = config.models.find((m: any) => m.id === targetModelId);

    expect(foundModel).toBeDefined();
    expect(foundModel.id).toBe(targetModelId);
  });

  it("should filter gated models by default", () => {
    const mockPi = createMockPi();
    registerFeatherlessProvider(mockPi);
    const config = mockPi.registerProvider.mock.calls[0][1];

    const gatedModel = FEATHERLESS_MODELS.find(m => m.isGated);
    if (gatedModel) {
      const found = config.models.find((m: any) => m.id === gatedModel.id);
      expect(found).toBeUndefined();
    }
  });

  it("should show gated models when flag is enabled", () => {
    const mockPi = createMockPi({ "featherless:show-gated": true });
    registerFeatherlessProvider(mockPi);
    const config = mockPi.registerProvider.mock.calls[0][1];

    const gatedModel = FEATHERLESS_MODELS.find(m => m.isGated);
    if (gatedModel) {
      const found = config.models.find((m: any) => m.id === gatedModel.id);
      expect(found).toBeDefined();
    }
  });

  it("should filter models not available on plan by default", () => {
    const mockPi = createMockPi();
    registerFeatherlessProvider(mockPi);
    const config = mockPi.registerProvider.mock.calls[0][1];

    const unavailableModel = FEATHERLESS_MODELS.find(m => m.availableOnPlan === false);
    if (unavailableModel) {
      const found = config.models.find((m: any) => m.id === unavailableModel.id);
      expect(found).toBeUndefined();
    }
  });
});
