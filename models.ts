/**
 * Model definitions for pi-featherless-2.
 *
 * Just list the models you want by id + model_class.
 * Context/concurrency come from MODEL_CLASSES lookup.
 * Full model catalog: models.json / model_classes.json (cached from Featherless API).
 */

interface ModelClass {
    context_limit: number;
    concurrency_use: number;
}

const MODEL_CLASSES: Record<string, ModelClass> = {
    "glm4-9b": { context_limit: 32768, concurrency_use: 1 },
    "glm4-32b": { context_limit: 32768, concurrency_use: 2 },
    "glm47-flash": { context_limit: 32768, concurrency_use: 2 },
    "glm47-357b": { context_limit: 32768, concurrency_use: 4 },
    "glm5-754b": { context_limit: 32768, concurrency_use: 4 },
    "minimax-m25": { context_limit: 32768, concurrency_use: 4 },
    "kimi-k2": { context_limit: 32768, concurrency_use: 4 },
    "kimi-k25": { context_limit: 32768, concurrency_use: 4 },
    "deepseek-v3.2": { context_limit: 32768, concurrency_use: 4 },
    "deepseek31-685b": { context_limit: 32768, concurrency_use: 4 },
    "mistral-24b-2503": { context_limit: 32768, concurrency_use: 2 },
    "qwen3-32b": { context_limit: 32768, concurrency_use: 2 },
    "qwen3-235b": { context_limit: 32768, concurrency_use: 4 },
    "qwen3-coder-480b": { context_limit: 32768, concurrency_use: 4 },
};

export interface ModelEntry {
    id: string;
    model_class: string;
    reasoning?: boolean;
    tool_use?: boolean;
}

/**
 * The models we actually expose. Add/remove here.
 */
export const MODELS: ModelEntry[] = [
    // GLM
    { id: "zai-org/GLM-4.7-Flash", model_class: "glm47-flash", tool_use: true },
    { id: "zai-org/GLM-4.7", model_class: "glm47-357b", tool_use: true },
    { id: "zai-org/GLM-5", model_class: "glm5-754b", tool_use: true },

    // MiniMax
    { id: "MiniMaxAI/MiniMax-M2.5", model_class: "minimax-m25", tool_use: true },

    // Kimi — officially supported for tool calling
    { id: "moonshotai/Kimi-K2-Instruct", model_class: "kimi-k2", tool_use: true },
    { id: "moonshotai/Kimi-K2.5", model_class: "kimi-k25", tool_use: true },

    // DeepSeek
    { id: "deepseek-ai/DeepSeek-V3.2", model_class: "deepseek-v3.2", tool_use: true },
    { id: "deepseek-ai/DeepSeek-V3.1", model_class: "deepseek31-685b", tool_use: true },

    // Mistral
    { id: "mistralai/Mistral-Small-3.2-24B-Instruct-2506", model_class: "mistral-24b-2503", tool_use: true },

    // Qwen3 — officially supported for tool calling
    { id: "Qwen/Qwen3-32B", model_class: "qwen3-32b", reasoning: true, tool_use: true },
    { id: "Qwen/Qwen3-235B-A22B", model_class: "qwen3-235b", reasoning: true, tool_use: true },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", model_class: "qwen3-coder-480b", reasoning: true, tool_use: true },
];

export function getModelConfig(entry: ModelEntry) {
    const mc = MODEL_CLASSES[entry.model_class];
    if (!mc) throw new Error(`Unknown model_class: ${entry.model_class}`);
    return {
        id: entry.id,
        name: entry.id,
        reasoning: entry.reasoning ?? false,
        contextWindow: mc.context_limit,
        maxTokens: mc.context_limit,
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}
