/**
 * Featherless CLI Provider Extension
 *
 * Usage:
 *   pi -e git:github.com/CodeDoes/pi-featherless-2
 *   # Then /login featherless-ai api key, or set FEATHERLESS_API_KEY=...
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MODELS, getModelConfig } from "./models";

const BASE_URL = "https://api.featherless.ai/v1";
const PROVIDER = "featherless-ai";

export default function (pi: ExtensionAPI) {
    pi.registerProvider(PROVIDER, {
        baseUrl: BASE_URL,
        apiKey: "FEATHERLESS_API_KEY",
        api: "openai-completions",
        authHeader: true,
        models: MODELS.map(getModelConfig),
        oauth: {
            name: "Featherless AI",
            async login(callbacks) {
                callbacks.onAuth({
                    url: "https://featherless.ai/account/api-keys",
                });
                const apiKey = await callbacks.onPrompt({
                    message: "Please create an API key and paste it below.",
                });
                if (!apiKey) {
                    throw new Error("No API key provided");
                }
                return {
                    refresh: "",
                    access: apiKey,
                    expires: 60 * 60 * 24 * 360,
                };
            },
            async refreshToken(cred) {
                return { ...cred };
            },
            getApiKey: (cred) => cred.access,
        },
    });
}
