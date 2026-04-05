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
    "glm46-357b": { context_limit: 32768, concurrency_use: 4 },
    "glm47-flash": { context_limit: 32768, concurrency_use: 2 },
    "glm47-357b": { context_limit: 32768, concurrency_use: 4 },
    "glm5-754b": { context_limit: 32768, concurrency_use: 4 },
    "minimax-m2": { context_limit: 32768, concurrency_use: 4 },
    "minimax-m21": { context_limit: 32768, concurrency_use: 4 },
    "minimax-m25": { context_limit: 32768, concurrency_use: 4 },
    "qrwkv-72b-32k": { context_limit: 32768, concurrency_use: 1 },
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
    // GLM — 5/5 bench, native tool_calls
    { id: "zai-org/GLM-4.7-Flash", model_class: "glm47-flash", tool_use: true },
    { id: "zai-org/GLM-4.7", model_class: "glm47-357b", tool_use: true },
    { id: "zai-org/GLM-5", model_class: "glm5-754b", tool_use: true },

    // MiniMax — 5/5 bench, native tool_calls
    { id: "MiniMaxAI/MiniMax-M2.5", model_class: "minimax-m25", tool_use: true },

    // QRWKV — cc:1, needs fine-tune for reliable tool calling
    { id: "featherless-ai/QRWKV-72B", model_class: "qrwkv-72b-32k" },

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
