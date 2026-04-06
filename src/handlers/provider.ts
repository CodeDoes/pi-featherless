import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MODELS, getModelConfig } from "../models";
import { BASE_URL, PROVIDER } from "./shared";

export function registerProvider(pi: ExtensionAPI) {
    pi.registerProvider(PROVIDER, {
        baseUrl: BASE_URL,
        apiKey: "FEATHERLESS_API_KEY",
        api: "openai-completions",
        authHeader: true,
        models: MODELS.map(getModelConfig),
        oauth: {
            name: "Featherless AI",
            async login(callbacks) {
                callbacks.onAuth({ url: "https://featherless.ai/account/api-keys" });
                const apiKey = await callbacks.onPrompt({
                    message: "Please create an API key and paste it below.",
                });
                if (!apiKey) throw new Error("No API key provided");
                return { refresh: "", access: apiKey, expires: 60 * 60 * 24 * 360 };
            },
            async refreshToken(cred) { return { ...cred }; },
            getApiKey: (cred) => cred.access,
        },
    });
}
