import type { OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

/**
 * Qwen3 family compat settings.
 * Uses enable_thinking for reasoning via vLLM chat_template_kwargs.
 */
export const qwen3Compat: OpenAICompletionsCompat = {
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

/**
 * Apply Qwen3-specific parameters to the request.
 * Adds enable_thinking to chat_template_kwargs when reasoning is enabled.
 */
export function applyQwen3Params(
    params: any,
    options?: { reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" },
) {
    if (options?.reasoning) {
        (params as any).chat_template_kwargs = {
            enable_thinking: true,
        };
    }
}

/**
 * Qwen3 model configurations.
 */
export const QWEN3_MODELS: ProviderModelConfig[] = [
    {
        id: "Qwen/Qwen3-32B",
        name: "Qwen3 32B",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        compat: qwen3Compat,
    },
    {
        id: "Qwen/Qwen3-14B",
        name: "Qwen3 14B",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        compat: qwen3Compat,
    },
    {
        id: "Qwen/Qwen3-8B",
        name: "Qwen3 8B",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        compat: qwen3Compat,
    },
];

/**
 * Qwen3 model metadata for Featherless.
 */
export const QWEN3_META = {
    "Qwen/Qwen3-32B": {
        family: "Qwen3",
        modelClass: "qwen3-32b",
        concurrencyCost: 2,
    },
    "Qwen/Qwen3-14B": {
        family: "Qwen3",
        modelClass: "qwen3-14b",
        concurrencyCost: 1,
    },
    "Qwen/Qwen3-8B": {
        family: "Qwen3",
        modelClass: "qwen3-8b",
        concurrencyCost: 1,
    },
};
