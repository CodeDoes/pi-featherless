import { describe, expect, it } from "vitest";
import { FEATHERLESS_MODELS } from "./models";

interface ApiModel {
  id: string;
  name: string;
  input_modalities?: string[];
  output_modalities?: string[];
  context_length: number;
  max_output_length?: number;
  pricing?: {
    prompt: string;
    completion: string;
    input_cache_reads?: string;
    input_cache_writes?: string;
  };
  supported_features?: string[];
}

interface ApiResponse {
  data: ApiModel[];
}

interface Discrepancy {
  model: string;
  field: string;
  hardcoded: unknown;
  api: unknown;
}

async function fetchApiModels(): Promise<ApiModel[]> {
  const apiKey = process.env.FEATHERLESS_API_KEY;
  if (!apiKey) {
    console.warn("FEATHERLESS_API_KEY not set, skipping API comparison test");
    return [];
  }

  const response = await fetch("https://api.featherless.ai/v1/models", {
    headers: {
      "HTTP-Referer": "https://github.com/kit/pi-featherless",
      "X-Title": "kit/pi-featherless (test)",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ApiResponse;
  return data.data;
}

function parsePrice(priceStr: string | undefined): number {
  if (!priceStr) return 0;
  // Convert "$0.0000006" to 0.6 (dollars per million tokens)
  const match = priceStr.match(/\$?(\d+\.?\d*)/);
  if (!match) return 0;
  const pricePerToken = Number.parseFloat(match[1]);
  // API prices are per token, hardcoded prices are per million tokens
  return pricePerToken * 1_000_000;
}

function compareModels(
  apiModels: ApiModel[],
  hardcodedModels: typeof FEATHERLESS_MODELS,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  for (const hardcoded of hardcodedModels) {
    const apiModel = apiModels.find((m) => m.id === hardcoded.id);

    if (!apiModel) {
      discrepancies.push({
        model: hardcoded.id,
        field: "exists",
        hardcoded: true,
        api: false,
      });
      continue;
    }

    // Check context window
    if (apiModel.context_length !== hardcoded.contextWindow) {
      discrepancies.push({
        model: hardcoded.id,
        field: "contextWindow",
        hardcoded: hardcoded.contextWindow,
        api: apiModel.context_length,
      });
    }

    if (apiModel.pricing) {
        // Check input cost (convert API price to per-million rate)
        const apiInputCost = parsePrice(apiModel.pricing.prompt);
        const epsilon = 0.001; // Small tolerance for floating point
        if (Math.abs(apiInputCost - hardcoded.cost.input) > epsilon) {
            discrepancies.push({
                model: hardcoded.id,
                field: "cost.input",
                hardcoded: hardcoded.cost.input,
                api: apiInputCost,
            });
        }
    }
  }

  return discrepancies;
}

describe("Featherless models", () => {
  it("should match API model definitions", { timeout: 30000 }, async () => {
    const apiModels = await fetchApiModels();
    if (apiModels.length === 0) return;

    const discrepancies = compareModels(apiModels, FEATHERLESS_MODELS);

    if (discrepancies.length > 0) {
      console.error("\nModel discrepancies found:");
      console.error("==========================");
      for (const d of discrepancies) {
        if (d.field === "exists") {
          if (d.hardcoded) {
            console.error(`  ${d.model}: Missing from API`);
          } else {
            console.error(`  ${d.model}: Missing from hardcoded models (NEW)`);
          }
        } else {
          console.error(`  ${d.model}.${d.field}:`);
          console.error(`    hardcoded: ${JSON.stringify(d.hardcoded)}`);
          console.error(`    api:       ${JSON.stringify(d.api)}`);
        }
      }
      console.error("==========================\n");
    }

    expect(discrepancies).toHaveLength(0);
  });
});
