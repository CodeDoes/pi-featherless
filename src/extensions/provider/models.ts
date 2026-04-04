import type { OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

/**
 * Featherless-specific compat settings for OpenAI-completions API.
 *
 * Featherless uses vLLM, which is OpenAI-compatible but:
 * - Does NOT support `store`, `developer` role, or `reasoning_effort`
 * - Uses `max_tokens` (not `max_completion_tokens`)
 * - Does NOT support strict mode in tool definitions
 * - Qwen3 models use `enable_thinking` for reasoning
 * - Tool calls come as <tool_call> tags in content (handled by custom streamSimple)
 */
const featherlessCompat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: true,
  supportsStrictMode: false,
};

const qwenCompat: OpenAICompletionsCompat = {
  ...featherlessCompat,
};

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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
  {
    id: "Qwen/Qwen3-32B",
    name: "Qwen3 32B",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: qwenCompat,
  },
  {
    id: "Qwen/Qwen3-14B",
    name: "Qwen3 14B",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: qwenCompat,
  },
  {
    id: "Qwen/Qwen3-8B",
    name: "Qwen3 8B",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: qwenCompat,
  },

  // -- Qwen 2.5 family --
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B Instruct",
    reasoning: false,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: featherlessCompat,
  },

  // -- Llama 3 family --
  {
    id: "failspy/Meta-Llama-3-8B-Instruct-abliterated-v3",
    name: "Llama 3 8B Instruct (abliterated)",
    reasoning: false,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 8192,
    maxTokens: 4096,
    compat: featherlessCompat,
  },

  // -- DeepSeek R1 distills (on Qwen3) --
  {
    id: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    name: "DeepSeek R1 0528 Qwen3 8B",
    reasoning: true,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: qwenCompat,
  },

  // -- RWKV / QRWKV family --
  {
    id: "featherless-ai/QRWKV-72B",
    name: "QRWKV 72B",
    reasoning: false,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 65536,
    maxTokens: 8192,
    compat: featherlessCompat,
  },
  {
    id: "recursal/RWKV6Qwen2.5-32B-QwQ-Preview",
    name: "RWKV6 Qwen2.5 32B QwQ Preview",
    reasoning: false,
    input: ["text"],
    cost: zeroCost,
    contextWindow: 32768,
    maxTokens: 8192,
    compat: featherlessCompat,
  },
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
export interface FeatherlessModelMeta {
  modelClass: string;
  concurrencyCost: number;
}

export const MODEL_META: Record<string, FeatherlessModelMeta> = {
  "Qwen/Qwen3-32B": { modelClass: "qwen3-32b", concurrencyCost: 2 },
  "Qwen/Qwen3-14B": { modelClass: "qwen3-14b", concurrencyCost: 1 },
  "Qwen/Qwen3-8B": { modelClass: "qwen3-8b", concurrencyCost: 1 },
  "Qwen/Qwen2.5-72B-Instruct": { modelClass: "qwen25-72b", concurrencyCost: 4 },
  "failspy/Meta-Llama-3-8B-Instruct-abliterated-v3": {
    modelClass: "llama3-8b",
    concurrencyCost: 1,
  },
  "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B": {
    modelClass: "qwen3-8b",
    concurrencyCost: 1,
  },
  "featherless-ai/QRWKV-72B": {
    modelClass: "qrwkv-72b-32k",
    concurrencyCost: 4,
  },
  "recursal/RWKV6Qwen2.5-32B-QwQ-Preview": {
    modelClass: "qrwkv-32b-32k",
    concurrencyCost: 2,
  },
};
