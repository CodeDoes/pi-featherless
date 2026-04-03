// Hardcoded models from Featherless API
// Source: https://api.featherless.ai/v1/models
// Assuming some costs and features

export interface FeatherlessModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  isGated?: boolean;
  availableOnPlan?: boolean;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    reasoningEffortMap?: Partial<
      Record<"minimal" | "low" | "medium" | "high" | "xhigh", string>
    >;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresMistralToolIds?: boolean;
  };
}

export const FEATHERLESS_MODELS: FeatherlessModelConfig[] = [
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    name: "Qwen 2.5 Coder 32B Instruct",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 32768,
    maxTokens: 8192,
    isGated: false,
  },
  {
    id: "google/gemma-7b",
    name: "Gemma 7B",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 8192,
    maxTokens: 4096,
    isGated: true,
  },
  {
    id: "deepseek-ai/DeepSeek-V3-0324",
    name: "DeepSeek V3",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 4096,
    isGated: false,
  },
];