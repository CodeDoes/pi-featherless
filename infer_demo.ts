import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import { registerFeatherlessProvider } from "./src/extensions/provider/index";
import { streamOpenAICompletions } from "@mariozechner/pi-ai/openai-completions";
import { Model, Context, Api } from "@mariozechner/pi-ai";
import * as fs from "fs";
import * as path from "path";

async function runInferenceDemo() {
    console.log("--- Pi Inference Pipeline Demo ---");

    // 1. Setup Auth
    const authStorage = AuthStorage.inMemory();
    const envPath = path.join(process.cwd(), "../.env");
    let apiKey = "";
    
    if (fs.existsSync(envPath)) {
        const match = fs.readFileSync(envPath, "utf-8").match(/FEATHERLESS_API_KEY=(.*)/);
        if (match) apiKey = match[1].trim();
    }

    if (!apiKey) {
        console.error("Error: FEATHERLESS_API_KEY not found in .env. Inference will likely fail.");
        process.exit(1);
    }

    authStorage.set("featherless", {
        type: "oauth",
        access: apiKey,
        refresh: apiKey,
        expires: Date.now() + 1000000
    });

    // 2. Setup Registry and Addon
    const registry = ModelRegistry.inMemory(authStorage);
    const mockPi: any = {
        registerProvider: (name: string, config: any) => registry.registerProvider(name, config),
        registerFlag: () => {},
        getFlag: () => false,
        auth: { credentials: { featherless: authStorage.get("featherless") } }
    };

    console.log("Attaching Featherless addon to Pi instance...");
    await registerFeatherlessProvider(mockPi);

    // 3. Select a model from the Pi Registry
    const models = registry.getAll().filter(m => m.provider === "featherless");
    if (models.length === 0) {
        console.error("No models found in registry.");
        return;
    }

    // Pick a model (e.g. Qwen 2.5 Coder)
    const model = models.find(m => m.id.includes("Qwen")) || models[0];
    console.log(`Using Model: ${model.id}`);

    // 4. Resolve Auth & Headers (The "Pi Way")
    const authResult = await registry.getApiKeyAndHeaders(model);
    if (!authResult.ok) {
        console.error("Auth resolution failed:", authResult.error);
        return;
    }

    // 5. Run Inference through Pi's OpenAI Streamer
    const context: Context = {
        messages: [
            { role: "user", content: "Write a short, punchy tagline for a developer tool called 'Pi'.", timestamp: Date.now() }
        ]
    };

    console.log("\n--- Requesting Completion ---\n");

    try {
        const stream = streamOpenAICompletions(model as Model<Api>, context, {
            apiKey: authResult.apiKey,
            headers: authResult.headers
        });

        let fullResponse = "";
        for await (const event of stream) {
            if (event.type === "text_delta") {
                process.stdout.write(event.delta);
                fullResponse += event.delta;
            } else if (event.type === "error") {
                console.error("\nStream Error:", event.error);
            }
        }
        console.log("\n\n--- Inference Complete ---");
    } catch (e) {
        console.error("Pipeline execution failed:", e);
    }
}

runInferenceDemo().catch(console.error);
