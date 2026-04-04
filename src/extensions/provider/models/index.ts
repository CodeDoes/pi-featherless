import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { QWEN3_MODELS } from "./qwen3";

const _zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Curated list of popular models available on Featherless.
 *
 * All models use `api: "openai-completions"` and the featherless provider.
 * Tool support is determined by `features.tool_use` from the Featherless API,
 * but since we use a custom streamSimple that parses <tool_call> tags,
 * tool calling works for any model that follows the <tool_call> convention.
 */
export const FEATHERLESS_MODELS: ProviderModelConfig[] = [
    // -- Qwen3 family (primary target) --
    ...QWEN3_MODELS,
];

/**
 * Metadata per model: Featherless model_class and concurrency cost.
 *
 * Concurrency cost from https://featherless.ai/docs:
 *   7B-15B  = 1
 *   24B-34B = 2
 *   70B-72B = 4
 *   DeepSeek v3/R1/Kimi-K2 = 4 (individual plans only)
 */
import { QWEN3_META } from "./qwen3";

export interface FeatherlessModelMeta {
    family: string;
    modelClass: string;
    concurrencyCost: number;
}

export const MODEL_META: Record<string, FeatherlessModelMeta> = {
    ...QWEN3_META,
};
