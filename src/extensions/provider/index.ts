import { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface FeatherlessApiModel {
  id: string;
  is_gated: boolean;
  context_length: number;
  max_completion_tokens?: number;
  supported_features?: string[];
  // other fields
}

async function fetchFeatherlessModels(): Promise<FeatherlessApiModel[]> {
  const response = await fetch("https://api.featherless.ai/v1/models", {
    headers: {
      "HTTP-Referer": "https://pi.dev",
      "X-Title": "Pi Coding Agent",
      "User-Agent": "Pi/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  const data = await response.json();
  return data.data || data;
}

export async function registerFeatherlessProvider(pi: ExtensionAPI): Promise<void> {
  const providerId = "featherless";

  const registerModels = async () => {
    const apiModels = await fetchFeatherlessModels();
    const models = apiModels.map((model) => ({
      id: model.id,
      name: model.id.split('/')[1] || model.id,
      reasoning: model.id.startsWith("Qwen/") ? true : false,
      input: ["text"] as ("text" | "image")[],
      cost: {
        input: 0.1,
        output: 0.1,
        cacheRead: 0.1,
        cacheWrite: 0,
      },
      contextWindow: model.context_length,
      maxTokens: model.max_completion_tokens || 4096,
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
        supportsToolCalls: model.supported_features?.includes("function_calling") || false,
      },
    }));

    pi.registerProvider(providerId, {
      baseUrl: "https://api.featherless.ai/v1",
      api: "openai-completions",
      models,
      oauth: {
        name: "Featherless",
        async login(callbacks) {
          const key = await callbacks.onPrompt({
            message: "Enter your Featherless API key:",
            placeholder: "sk-...",
          });
          return {
            access: key,
            refresh: key,
            expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
          };
        },
        async refreshToken(credentials) {
          return credentials;
        },
        getApiKey(credentials) {
          return credentials.access;
        },
      },
    });
  };

  return registerModels();
}

export default async function (pi: ExtensionAPI) {
  await registerFeatherlessProvider(pi);
}