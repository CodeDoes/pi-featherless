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
    id: "featherless:gpt-oss-20b",
    name: "Featherless GPT OSS 20B",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 4096,
    maxTokens: 512,
  },
  {
    id: "featherless:qwen-7b",
    name: "Featherless Qwen 7B",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 8192,
    maxTokens: 512,
  },
  {
    id: "google/gemma-3-27b-it",
    name: "Google Gemma 3 27B IT",
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 32768,
    maxTokens: 32768,
  },
  {
    id: "qwen/qwen3-4b-instruct",
    name: "Qwen Qwen3 4B Instruct",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.2,
      output: 0.2,
      cacheRead: 0.2,
      cacheWrite: 0,
    },
    contextWindow: 32768,
    maxTokens: 32768,
  },
  {
    id: "failspy/Meta-Llama-3-8B-Instruct-abliterated-v3",
    name: "Failspy Meta Llama 3 8B Instruct Abliterated v3",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0.1,
      cacheWrite: 0,
    },
    contextWindow: 32768,
    maxTokens: 32768,
  },
];
