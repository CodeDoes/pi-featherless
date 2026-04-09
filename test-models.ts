/**
 * Automated Tool Calling Model Evaluator
 *
 * Tests a list of models for tool calling capability and outputs results.
 * Separates configuration (model list) from logic (testing, reporting).
 *
 * Usage: npx tsx test-models.ts
 * Requires FEATHERLESS_API_KEY in .env or environment
 */

import { config } from 'dotenv';
config();

import OpenAI from 'openai';

const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) {
  console.error('Missing FEATHERLESS_API_KEY');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://api.featherless.ai/v1',
});

// ============================================================================
// DATA: Model list (easy to add/remove models)
// ============================================================================
interface ModelConfig {
  id: string;
  short: string;
  expectedCc?: number; // concurrency cost if known
}

const MODELS: ModelConfig[] = [
  { id: "DreamFast/gemma-3-12b-it-heretic-v2", short: "gemma-3-12b-heretic-v2" },
  { id: "Sabomako/gemma-3-12b-it-heretic", short: "gemma-3-12b-heretic" },
  { id: "Lightricks/gemma-3-12b-it-qat-q4_0-unquantized", short: "gemma-3-12b-qat" },
  { id: "Trendyol/Trendyol-LLM-Asure-12B", short: "Trendyol-Asure-12B" },
  { id: "nvidia/Nemotron-Terminal-14B", short: "Nemotron-14B" },
  { id: "farbodtavakkoli/OTel-LLM-14B-IT", short: "OTel-LLM-14B" },
  { id: "DavidAU/gemma-3-12b-it-vl-GLM-4.7-Flash-Heretic-Uncensored-Thinking", short: "gemma-12b-GLM-mashup" },
  { id: "DreamFast/gemma-3-12b-it-heretic", short: "gemma-3-12b-heretic" },
  { id: "TheDrummer/Rocinante-X-12B-v1", short: "Rocinante-X-12B" },
  { id: "DavidAU/Mistral-Nemo-2407-12B-Thinking-Claude-Gemini-GPT5.2-Uncensored-HERETIC", short: "Mistral-Nemo-12B-megamix" },
  { id: "McGill-NLP/AfriqueQwen-14B", short: "Afriquewen-14B" },
  { id: "TeichAI/Qwen3-14B-Claude-4.5-Opus-High-Reasoning-Distill", short: "Qwen3-14B-distill" },
  { id: "p-e-w/gemma-3-12b-it-heretic-v2", short: "gemma-3-12b-heretic-v2" },
];

const TOOLS = [{
  type: "function",
  function: {
    name: "bash",
    description: "Execute bash command",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
}];

// ============================================================================
// LOGIC: Model testing
// ============================================================================

type TestResult =
  | { status: "native"; tool_count: number }
  | { status: "xml"; format: string }
  | { status: "custom"; sample: string }
  | { status: "none"; sample: string }
  | { status: "unavailable"; reason: string }
  | { status: "error"; reason: string };

async function testModel(modelId: string): Promise<TestResult> {
  // 1. Connectivity test
  try {
    await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    });
  } catch (e: any) {
    if ([404, 401].includes(e.status) || e.message?.includes('gated') || e.message?.includes('not available')) {
      return { status: "unavailable", reason: e.message?.slice(0, 80) ?? "unknown" };
    }
    if (e.message?.includes('completion service')) {
      return { status: "error", reason: "service error (500)" };
    }
    return { status: "error", reason: e.message?.slice(0, 80) ?? "unknown error" };
  }

  // 2. Tool calling test
  try {
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: "Run: echo hello" }],
      tools: TOOLS,
      max_tokens: 150,
      temperature: 0.7,
    });

    const msg = res.choices[0].message;
    const toolCalls = msg.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      return { status: "native", tool_count: toolCalls.length };
    }

    const content = msg.content || "";
    if (content.includes("<function>") || content.includes("")) {
      // Extract which format was found
      const format = content.includes("<function>") ? "<function>" : "";
      return { status: "xml", format };
    }
    if (content.includes("call:")) {
      return { status: "custom", sample: content.slice(0, 60) };
    }

    return { status: "none", sample: content.slice(0, 60) };
  } catch (e: any) {
    return { status: "error", reason: e.message?.slice(0, 80) ?? "unknown error" };
  }
}

// ============================================================================
// REPORTING: Output results
// ============================================================================

function resultToEmoji(result: TestResult): string {
  switch (result.status) {
    case "native": return "✅";
    case "xml": return "🔧";
    case "custom": return "🧩";
    case "none": return "❌";
    case "unavailable": return "🚫";
    default: return "💥";
  }
}

function resultToDescription(result: TestResult): string {
  switch (result.status) {
    case "native": return `native tool_calls (${result.tool_count} call${result.tool_count === 1 ? '' : 's'})`;
    case "xml": return `XML (${result.format}) - needs parser`;
    case "custom": return `custom format - ${result.sample.trim()}`;
    case "none": return `no tool use - "${result.sample?.trim()}"`;
    case "unavailable": return `unavailable (${result.reason})`;
    default: return `error - ${result.reason}`;
  }
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  console.log("\n" + "=".repeat(80));
  console.log(" TOOL CALLING MODEL EVALUATOR");
  console.log("=".repeat(80) + "\n");

  const results: { model: ModelConfig; result: TestResult }[] = [];

  for (const model of MODELS) {
    process.stdout.write(`Testing ${model.short.padEnd(32)} `);
    const result = await testModel(model.id);
    results.push({ model, result });
    console.log(`${resultToEmoji(result)} ${resultToDescription(result)}`);
  }

  // Summary
  console.log("\n" + "-".repeat(80));
  console.log(" SUMMARY");
  console.log("-".repeat(80));

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.result.status] = (counts[r.result.status] ?? 0) + 1;

  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${resultToEmoji({ status: status as any })} ${status.padEnd(12)}: ${count} model${count === 1 ? '' : 's'}`);
  }

  console.log("\n Models with native tool_calls:");
  const nativeModels = results.filter(r => r.result.status === "native");
  if (nativeModels.length > 0) {
    nativeModels.forEach(r => {
      console.log(`   ✅ ${r.model.id} (${r.model.short})`);
    });
  } else {
    console.log("   (none)");
  }

  console.log("\n Done.\n");
})().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
