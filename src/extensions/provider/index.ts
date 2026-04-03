import { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FEATHERLESS_MODELS } from "./models";

export async function registerFeatherlessProvider(pi: ExtensionAPI): Promise<void> {
  const providerId = "featherless";

  // Register flags to control model visibility
  pi.registerFlag("featherless:show-gated", {
    description: "Show gated models in the Featherless provider",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("featherless:show-all-plans", {
    description: "Show models not available on the current plan",
default: false,
});

  const registerModels = async () => {
    const storedCredentials = pi.auth?.credentials?.[providerId];
    const credentials = storedCredentials;
    const isAuthenticated = !!credentials;

    // Check both CLI flags and environment variables for settings
    const showGated = pi.getFlag("featherless:show-gated") || process.env.FEATHERLESS_SHOW_GATED === "true";
    const showAllPlans = pi.getFlag("featherless:show-all-plans") || process.env.FEATHERLESS_SHOW_ALL_PLANS === "true";

    let models: any[] = [];
    if (isAuthenticated) {
      try {
        // Fetch available models from Featherless API
        const response = await fetch('https://api.featherless.ai/v1/models', {
          headers: {
            'Authorization': `Bearer ${credentials.access}`,
          },
        });
        if (!response.ok) throw new Error('Failed to fetch models');
        const apiModels: { id: string }[] = await response.json();

        // Filter and map using hardcoded config
        const availableIds = new Set(apiModels.map(m => m.id));
        const filteredModels = FEATHERLESS_MODELS.filter((m) => {
          if (!availableIds.has(m.id)) return false;
          if (m.isGated && !showGated) return false;
          if (m.availableOnPlan === false && !showAllPlans) return false;
          return true;
        });

        models = filteredModels.map((model) => ({
          id: model.id,
          name: model.isGated ? `${model.name} (Gated)` : model.name,
          reasoning: model.reasoning,
          input: model.input,
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          compat: {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
            ...model.compat,
          },
        }));
      } catch (error) {
        console.error('[Featherless] Failed to fetch models:', error);
        // Fallback to hardcoded if fetch fails
        const filteredModels = FEATHERLESS_MODELS.filter((m) => {
          if (m.isGated && !showGated) return false;
          if (m.availableOnPlan === false && !showAllPlans) return false;
          return true;
        });

        models = filteredModels.map((model) => ({
          id: model.id,
          name: model.isGated ? `${model.name} (Gated)` : model.name,
          reasoning: model.reasoning,
          input: model.input,
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          compat: {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
            ...model.compat,
          },
        }));
      }
    }

    pi.registerProvider(providerId, {
      baseUrl: "https://api.featherless.ai/v1",
      apiKey: "FEATHERLESS_API_KEY",
      api: "openai-completions",
      headers: {
        "HTTP-Referer": "https://pi.dev",
        "X-Title": "@codedoes/pi-featherless",
      },
      models,
      oauth: {
        name: "Featherless AI",
        async login(callbacks) {
          callbacks.onAuth({ url: "https://featherless.ai/account/api-keys" });
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

  // Initial registration
  return registerModels();

  // Re-register models on auth change
  
  // Inject concurrency slot into headers if provided via login or env
}

export default async function (pi: ExtensionAPI) {
  await registerFeatherlessProvider(pi);
}
