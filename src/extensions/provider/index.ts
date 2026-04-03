import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FEATHERLESS_MODELS } from "./models";

export function registerFeatherlessProvider(pi: ExtensionAPI): void {
  pi.registerProvider("featherless", {
    baseUrl: "https://api.featherless.ai/v1",
    apiKey: "FEATHERLESS_API_KEY",
    api: "openai-completions",
    headers: {
      Referer: "https://pi.dev",
      "X-Title": "@kit/pi-featherless",
    },
    models: FEATHERLESS_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
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
    })),
    oauth: {
      name: "Featherless AI",
      async login(callbacks) {
        callbacks.onAuth({ url: "https://featherless.ai/settings" });
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

  // Inject concurrency slot into headers if provided via login or env
  pi.on("before_provider_request", (event, _ctx) => {
    if (event.model.provider !== "featherless") return;

    // Try to get slot from env or from the 'refresh' field we used in oauth login
    const slot = process.env.FEATHERLESS_CONCURRENCY_SLOT;

    if (slot) {
      event.payload.headers = {
        ...event.payload.headers,
        "X-Featherless-Concurrency-Slot": slot,
      };
    }
  });
}

export default async function (pi: ExtensionAPI) {
  registerFeatherlessProvider(pi);
}
