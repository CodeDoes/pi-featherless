import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import { registerFeatherlessProvider } from "./src/extensions/provider/index";

async function runRealPiDemo() {
  console.log("--- Real Pi Instance State Demo ---");

  // 1. Initialize REAL Pi AuthStorage and ModelRegistry
  const authStorage = AuthStorage.inMemory();
  const registry = ModelRegistry.inMemory(authStorage);

  const envPath = path.join(process.cwd(), "../.env");
  let apiKey = "";
  if (fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, "utf-8")
      .match(/FEATHERLESS_API_KEY=(.*)/);
    if (match) apiKey = match[1].trim();
  }

  if (!apiKey) {
    throw new Error("Missing FEATHERLESS_API_KEY in .env");
  }

  const credentials = {
    access: apiKey,
    refresh: apiKey,
    expires: Date.now() + 1000000,
  };

  // Set in authStorage for the registry to use during inference
  authStorage.set("featherless", { ...credentials, type: "oauth" });

  const pi: any = {
    auth: { credentials: { featherless: credentials } },
    getFlag: () => false,
    registerFlag: () => {},
    registerProvider: (id: string, config: any) => {
      registry.registerProvider(id, config);
    },
  };

  console.log("Executing live registration through Pi Registry...");
  await registerFeatherlessProvider(pi);

  const models = registry.getAll().filter((m) => m.provider === "featherless");

  console.log(`\nPi ModelRegistry Results:`);
  console.log(`- Provider: featherless`);
  console.log(`- Total Live Models: ${models.length}`);

  if (models.length > 5) {
    console.log("\nSample of Live Models:");
    models.slice(0, 10).forEach((m) => {
      console.log(`  - [${m.id}] ${m.name}`);
    });
  } else {
    console.log(
      "\nWarning: Only fallback models visible. Check API key permissions.",
    );
    for (const m of models) console.log(`  - [${m.id}] ${m.name}`);
  }
}

runRealPiDemo().catch(console.error);
