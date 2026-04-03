import { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export async function registerFeatherlessTestModelsCommand(pi: ExtensionAPI): Promise<void> {
  pi.registerCommand({
    name: "featherless:test-models",
    description: "Test fetching and display Featherless models",
    handler: async () => {
      console.log("Fetching Featherless models from API...");
      try {
        const response = await fetch("https://api.featherless.ai/v1/models", {
          headers: {
            "HTTP-Referer": "https://pi.dev",
            "X-Title": "Pi Coding Agent",
            "User-Agent": "Pi/1.0"
          }
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        const data = await response.json();
        const models = data.data || data;
        console.log(`Fetched ${models.length} models:`);
        for (const model of models.slice(0, 10)) {
          console.log(`  - ${model.id}`);
        }
        if (models.length > 10) {
          console.log(`  ... and ${models.length - 10} more`);
        }
      } catch (error) {
        console.error("Error:", error.message);
      }
    }
  });
}

export default async function (pi: ExtensionAPI) {
  await registerFeatherlessTestModelsCommand(pi);
}