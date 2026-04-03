import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerTokenizeCommand(pi: ExtensionAPI, apiKey: string): void {
  pi.registerCommand("featherless:tokenize", {
    description: "Count tokens in text using Featherless API",
    handler: async (args, ctx) => {
      if (args.length === 0) {
        ctx.ui.notify("Usage: /featherless:tokenize <text>", "error");
        return;
      }

      const text = args.join(" ");

      try {
        const response = await fetch("https://api.featherless.ai/v1/tokenize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const tokens = data.usage?.total_tokens ?? data.tokens ?? "unknown";
        ctx.ui.notify(`Token count: ${tokens} for "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`, "info");
      } catch (error) {
        ctx.ui.notify(`Failed to tokenize: ${error.message}`, "error");
      }
    },
  });
}