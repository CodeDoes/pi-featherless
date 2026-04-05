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
    chars_per_token?: number;  // Default 3.2 (chars/4 overestimates; real average is ~3.2)
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
    "qwen3-32b": { context_limit: 32768, concurrency_use: 2, chars_per_token: 3.12 },  // Measured from tokenize API
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

/**
 * Safety factor for context window.
 * 
 * Pi's chars/4 heuristic underestimates tokens by ~27% on average.
 * To prevent silent overflow, we reduce the reported context window.
 * 
 * With SAFETY_FACTOR = 0.75:
 * - Real 32k context -> reported 24k
 * - When pi thinks it's at 24k, it's actually at ~32k
 * - Compaction triggers before real overflow
 */
const SAFETY_FACTOR = 0.75;

export function getModelConfig(entry: ModelEntry) {
    const mc = MODEL_CLASSES[entry.model_class];
    if (!mc) throw new Error(`Unknown model_class: ${entry.model_class}`);
    
    // Apply safety factor to prevent overflow from chars/4 underestimation
    const safeContextWindow = Math.floor(mc.context_limit * SAFETY_FACTOR);
    
    return {
        id: entry.id,
        name: entry.id,
        reasoning: entry.reasoning ?? false,
        contextWindow: safeContextWindow,
        maxTokens: mc.context_limit,  // Keep real limit for output
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
}

/**
 * Get the real context limit for a model (before safety factor).
 */
export function getRealContextLimit(modelId: string): number | undefined {
    const entry = MODELS.find(m => m.id === modelId);
    if (!entry) return undefined;
    const mc = MODEL_CLASSES[entry.model_class];
    return mc?.context_limit;
}

/**
 * Get the chars_per_token ratio for a model class.
 * Falls back to 3.2 (measured average) if not specified.
 */
export function getCharsPerToken(modelClass: string): number {
    const mc = MODEL_CLASSES[modelClass];
    return mc?.chars_per_token ?? 3.2;
}

/**
 * Get the concurrency cost for a model class.
 * Falls back to 1 if not specified.
 */
export function getConcurrencyUse(modelClass: string): number {
    const mc = MODEL_CLASSES[modelClass];
    return mc?.concurrency_use ?? 1;
}

/**
 * Get the model class for a model ID.
 */
export function getModelClass(modelId: string): string | undefined {
    const entry = MODELS.find(m => m.id === modelId);
    return entry?.model_class;
}
