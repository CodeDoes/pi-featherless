import { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export async function registerFeatherlessTestInferenceCommand(pi: ExtensionAPI): Promise<void> {
  pi.registerCommand("featherless:test-inference", {
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

        // For simplicity, just log that we would run inference
        console.log("Inference test: Would send request to Featherless API with API key.");
        console.log("Note: Actual streaming requires Pi's internal setup.");
      } catch (error) {
        console.error("Error:", (error as Error).message);
      }
    }
  });
}

export default async function (pi: ExtensionAPI) {
  await registerFeatherlessTestInferenceCommand(pi);
}