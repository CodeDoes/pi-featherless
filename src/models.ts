/**
 * Model definitions for pi-featherless-2.
 *
 * Model concurrency costs are based on Featherless AI plan allotments:
 * - 7B to 15B: Cost 1
 * - 24B to 34B: Cost 2
 * - 70B to 72B: Cost 4
 * - DeepSeek V3/R1 & Kimi-K2: Cost 4
 */

interface ModelClass {
    context_limit: number;
    concurrency_cost: number;
    chars_per_token?: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
}

const MODEL_CLASSES: Record<string, ModelClass> = {
    "glm4-9b": {
        context_limit: 32768,
        concurrency_cost: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "qwen25-7b": {
        context_limit: 32768,
        concurrency_cost: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "qwen25-3b": {
        context_limit: 32768,
        concurrency_cost: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm4-32b": {
        context_limit: 32768,
        concurrency_cost: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm47-flash": {
        context_limit: 32768,
        concurrency_cost: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm47-357b": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "glm5-754b": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "minimax-m25": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "kimi-k2": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "kimi-k25": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "deepseek-v3.2": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "deepseek31-685b": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "mistral-24b-2503": {
        context_limit: 32768,
        concurrency_cost: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "qwen3-32b": {
        context_limit: 32768,
        concurrency_cost: 2,
        chars_per_token: 3.12,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "qwen3-235b": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "qwen3-coder-480b": {
        context_limit: 32768,
        concurrency_cost: 4,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
};

export interface ModelEntry {
    id: string;
    model_class: string;
    reasoning?: boolean;
    tool_use?: boolean;
}

export const MODELS: ModelEntry[] = [
    {
        id: "zai-org/GLM-Z1-9B-0414",
        model_class: "glm4-9b",
        tool_use: true,
    },
    {
        id: "Qwen/Qwen2.5-Coder-7B-Instruct",
        model_class: "qwen25-7b",
        tool_use: true,
    },
    {
        id: "Qwen/Qwen2.5-3B-Instruct",
        model_class: "qwen25-3b",
        tool_use: true,
    },
    { id: "zai-org/GLM-4.7-Flash", model_class: "glm47-flash", tool_use: true },
    { id: "zai-org/GLM-4.7", model_class: "glm47-357b", tool_use: true },
    { id: "zai-org/GLM-5", model_class: "glm5-754b", tool_use: true },
    {
        id: "MiniMaxAI/MiniMax-M2.5",
        model_class: "minimax-m25",
        tool_use: true,
    },
    {
        id: "moonshotai/Kimi-K2-Instruct",
        model_class: "kimi-k2",
        tool_use: true,
    },
    { id: "moonshotai/Kimi-K2.5", model_class: "kimi-k25", tool_use: true },
    {
        id: "deepseek-ai/DeepSeek-V3.2",
        model_class: "deepseek-v3.2",
        tool_use: true,
    },
    {
        id: "deepseek-ai/DeepSeek-V3.1",
        model_class: "deepseek31-685b",
        tool_use: true,
    },
    {
        id: "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
        model_class: "mistral-24b-2503",
        tool_use: true,
    },
    {
        id: "Qwen/Qwen3-32B",
        model_class: "qwen3-32b",
        reasoning: true,
        tool_use: true,
    },
    {
        id: "Qwen/Qwen3-235B-A22B",
        model_class: "qwen3-235b",
        reasoning: true,
        tool_use: true,
    },
    {
        id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        model_class: "qwen3-coder-480b",
        reasoning: true,
        tool_use: true,
    },
];

export function getModelConfig(entry: ModelEntry) {
    const mc = MODEL_CLASSES[entry.model_class];
    if (!mc) throw new Error(`Unknown model_class: ${entry.model_class}`);

    return {
        id: entry.id,
        name: entry.id,
        reasoning: entry.reasoning ?? false,
        contextWindow: mc.context_limit,
        maxTokens: 131072, // Support infinite generation beyond context window
        input: ["text"] as ("text" | "image")[],
        cost: mc.cost,
    };
}

export function getRealContextLimit(modelId: string): number | undefined {
    const entry = MODELS.find((m) => m.id === modelId);
    if (!entry) return undefined;
    const mc = MODEL_CLASSES[entry.model_class];
    return mc?.context_limit;
}

export function getCharsPerToken(modelClass: string): number {
    const mc = MODEL_CLASSES[modelClass];
    return mc?.chars_per_token ?? 3.2;
}

export function getConcurrencyCost(modelClass: string): number {
    const mc = MODEL_CLASSES[modelClass];
    if (!mc) throw new Error(`Unknown model_class: ${modelClass}`);
    return mc.concurrency_cost;
}

export function getModelClass(modelId: string): string | undefined {
    const entry = MODELS.find((m) => m.id === modelId);
    return entry?.model_class;
}
