import { ModelRegistry } from "../pi-mono/packages/coding-agent/src/core/model-registry";
import { AuthStorage } from "../pi-mono/packages/coding-agent/src/core/auth-storage";
import { createExtensionRuntime } from "../pi-mono/packages/coding-agent/src/core/extensions/loader";
import { registerFeatherlessProvider } from "./src/extensions/provider/index";
import * as fs from "fs";
import * as path from "path";

async function runSimulation() {
    console.log("--- Pi Instance Simulation ---");

    // 1. Setup AuthStorage (mocked for this demo)
    const authStorage = AuthStorage.inMemory();
    
    // Try to load API key from .env if it exists
    const envPath = path.join(process.cwd(), "../.env");
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/FEATHERLESS_API_KEY=(.*)/);
        if (match) {
            console.log("Found FEATHERLESS_API_KEY in .env");
            authStorage.set("featherless", {
                type: "oauth",
                access: match[1].trim(),
                refresh: match[1].trim(),
                expires: Date.now() + 1000000
            });
        }
    }

    // 2. Setup ModelRegistry
    const registry = ModelRegistry.inMemory(authStorage);

    // 3. Setup Extension Runtime and API
    const runtime = createExtensionRuntime();
    
    // Mock the bindCore logic for registerProvider
    runtime.registerProvider = (name, config) => {
        console.log(`Extension registering provider: ${name}`);
        registry.registerProvider(name, config);
    };

    const mockPi: any = {
        registerProvider: (name: string, config: any) => runtime.registerProvider(name, config),
        registerFlag: (name: string, options: any) => {
            console.log(`Extension registering flag: ${name} (default: ${options.default})`);
        },
        getFlag: (name: string) => {
            return undefined; // Simulation: flags are off
        },
        auth: {
            credentials: {
                featherless: authStorage.get("featherless")
            }
        }
    };

    // 4. Load the extension
    console.log("Loading pi-featherless extension...");
    await registerFeatherlessProvider(mockPi);

    // 5. Output state
    console.log("\n--- Final Pi State (Models) ---");
    const models = registry.getAll();
    const featherlessModels = models.filter(m => m.provider === "featherless");
    
    console.log(`Total models: ${models.length}`);
    console.log(`Featherless models: ${featherlessModels.length}`);

    if (featherlessModels.length > 0) {
        console.log("\nFirst 10 Featherless Models:");
        featherlessModels.slice(0, 10).forEach(m => {
            console.log(`- ${m.id} (${m.name})`);
        });
    } else {
        console.log("No Featherless models found. Check if API key was provided and valid.");
    }
}

runSimulation().catch(console.error);
