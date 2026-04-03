import { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { streamOpenAICompletions } from "@mariozechner/pi-ai";
import { Model, Context, Api } from "@mariozechner/pi-ai";

export async function registerFeatherlessTestInferenceCommand(pi: ExtensionAPI): Promise<void> {
  pi.registerCommand({
    name: "featherless:test-inference",
    description: "Test inference with a Featherless model",
    handler: async () => {
      const apiKey = process.env.FEATHERLESS_API_KEY;
      if (!apiKey) {
        console.error("FEATHERLESS_API_KEY not set. Set it to test inference.");
        return;
      }

      console.log("Testing inference with Featherless model...");
      try {
        // Fetch models
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
        const apiModels = data.data || data;

        // Pick a model
        const apiModel = apiModels.find((m: any) => m.id.includes("Qwen")) || apiModels[0];
        console.log(`Using model: ${apiModel.id}`);

        // Map to config
        const model: Model<Api> = {
          provider: "featherless",
          id: apiModel.id,
          name: apiModel.id.split('/')[1] || apiModel.id,
          reasoning: false,
          input: ["text"],
          cost: { input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0 },
          contextWindow: apiModel.context_length,
          maxTokens: apiModel.max_completion_tokens || 4096,
          isGated: apiModel.is_gated,
          availableOnPlan: true,
          compat: {
            supportsDeveloperRole: false,
            maxTokensField: "max_tokens",
          },
        };

        // Run inference
        const context: Context = {
          messages: [
            { role: "user", content: "Say 'Hello from Featherless AI!'", timestamp: Date.now() }
          ]
        };

        const stream = streamOpenAICompletions(model, context, {
          apiKey,
          headers: {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://pi.dev",
            "X-Title": "Pi Coding Agent",
          },
          baseUrl: "https://api.featherless.ai/v1"
        });

        console.log("Response:");
        for await (const event of stream) {
          if (event.type === "text_delta") {
            process.stdout.write(event.delta);
          } else if (event.type === "error") {
            console.error("\nError:", event.error);
          }
        }
        console.log("\nDone.");
      } catch (error) {
        console.error("Error:", error.message);
      }
    }
  });
}

export default async function (pi: ExtensionAPI) {
  await registerFeatherlessTestInferenceCommand(pi);
}