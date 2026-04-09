#!/usr/bin/env npx tsx
/**
 * Tool Use Benchmark for Featherless models.
 * Loads models from src/models.ts
 */

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { MODELS, getConcurrencyCost, getModelClass } from "./src/models.ts";

// Load .env if present
try {
  const env = readFileSync(".env", "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) {
  console.error("Set FEATHERLESS_API_KEY (or add to .env)");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: "https://api.featherless.ai/v1",
});

// ── ANSI ────────────────────────────────────────────────────────────────────

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";

// ── Bench model list ────────────────────────────────────────────────────────

interface BenchModel {
  id: string;
  short: string;
  cc: number;
  family: string;
}

// Best models
const BENCH_MODELS: BenchModel[] = [
  { id: "zai-org/GLM-4.7-Flash", short: "GLM-4.7-Flash", cc: 2, family: "glm" },
];

// ── Tools ───────────────────────────────────────────────────────────────────

const bashTool = {
  type: "function" as const,
  function: {
    name: "bash",
    description: "Execute a bash command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
      },
      required: ["command"],
    },
  },
};

const readTool = {
  type: "function" as const,
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
      },
      required: ["path"],
    },
  },
};

const writeTool = {
  type: "function" as const,
  function: {
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
};

const calculatorTool = {
  type: "function" as const,
  function: {
    name: "calculator",
    description: "Perform arithmetic calculations",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression to evaluate" },
      },
      required: ["expression"],
    },
  },
};

// ── System prompt for tool use ────────────────────────────────────────────

const TOOL_USE_SYSTEM_PROMPT = `You are a helpful assistant. Use tools when asked. Be concise.`;

// ── Scenarios ────────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  prompt: string;
  tools: any[];
  validate: (toolCalls: any[], text: string) => string | null;
}

const scenarios: Scenario[] = [
  {
    name: "Hello World",
    prompt: "Run echo hello",
    tools: [bashTool],
    validate: (c) => {
      if (c.length !== 1) return `${c.length} calls`;
      if (c[0].name !== "bash") return `called ${c[0].name}`;
      if (!String(c[0].arguments.command).includes("echo")) return "no echo";
      return null;
    },
  },
  {
    name: "Read File",
    prompt: "Read the contents of /etc/hostname",
    tools: [bashTool, writeTool, readTool],
    validate: (c) => {
      if (c.length !== 1) return `${c.length} calls`;
      if (c[0].name === "write_file") return "tried to WRITE??";
      if (!JSON.stringify(c[0].arguments).includes("hostname")) return "wrong target";
      return null;
    },
  },
  {
    name: "JSON Config",
    prompt: 'Write a file called config.json with: {"port": 3000, "host": "0.0.0.0"}',
    tools: [writeTool],
    validate: (c) => {
      if (c.length !== 1) return `${c.length} calls`;
      if (c[0].name !== "write_file") return `called ${c[0].name}`;
      try {
        const j = JSON.parse(String(c[0].arguments.content));
        if (j.port !== 3000) return "wrong port";
      } catch {
        return "content not valid JSON";
      }
      return null;
    },
  },
  {
    name: "Self Control",
    prompt: "What is 2 + 2? Answer directly, do not use any tools.",
    tools: [bashTool, writeTool, readTool],
    validate: (c, text) => {
      if (c.length > 0) return `used ${c.length} tool(s) for 2+2`;
      if (!text.includes("4")) return "didn't say 4";
      return null;
    },
  },
  {
    name: "Pipeline",
    prompt: "Run a single bash command: list files in /tmp piped to wc -l",
    tools: [bashTool],
    validate: (c) => {
      if (c.length < 1) return "no calls";
      const cmd = String(c[0].arguments.command);
      if (!cmd.includes("|")) return "no pipe";
      if (!cmd.includes("wc")) return "no wc";
      return null;
    },
  },
  {
    name: "Calculator",
    prompt: "What is 15 * 23? Use the calculator tool.",
    tools: [calculatorTool],
    validate: (c) => {
      if (c.length !== 1) return `${c.length} calls`;
      if (c[0].name !== "calculator") return `called ${c[0].name}`;
      if (!JSON.stringify(c[0].arguments).includes("15")) return "wrong args";
      return null;
    },
  },
];

// ── QRWKV tool call parser ──────────────────────────────────────────────────

function parseToolCallsFromText(text: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const results: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  // Format 1: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const regex1 = /<tool_call>\s*(\{.*?\})\s*<\/tool_call>/gs;
  for (const match of text.matchAll(regex1)) {
    try {
      const data = JSON.parse(match[1]);
      if (data.name && data.arguments !== undefined) {
        results.push({
          name: data.name,
          arguments: typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments,
        });
      }
    } catch { /* skip */ }
  }

  // Format 2: <function>{"name": "...", "arguments": {...}}</function> (legacy)
  const regex2 = /<function>\s*(\{.*?\})\s*<\/function>/gs;
  for (const match of text.matchAll(regex2)) {
    try {
      const data = JSON.parse(match[1]);
      if (data.name && data.arguments !== undefined) {
        results.push({
          name: data.name,
          arguments: typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments,
        });
      }
    } catch { /* skip */ }
  }

  return results;
}

// ── Runner ─────────────────────────────────────────────────────────────────

interface Result {
  modelId: string;
  modelShort: string;
  scenario: string;
  pass: boolean;
  error: string | null;
  timeMs: number;
  family: string;
  toolCallFormat: "native" | "xml" | "none";
}

async function runOne(model: BenchModel, scenario: Scenario): Promise<Result> {
  const w = process.stdout.write.bind(process.stdout);
  w(`  ${BOLD}${model.short}${RESET} ${DIM}cc:${model.cc}${RESET}  ${scenario.name}`);

  const start = Date.now();

  try {
    const params: any = {
      model: model.id,
      messages: [
        { role: "system", content: TOOL_USE_SYSTEM_PROMPT },
        { role: "user", content: scenario.prompt },
      ],
      tools: scenario.tools,
      max_tokens: 128,
      stream: true,
    };

    const stream = await client.chat.completions.create(params);

    let content = "";
    let gotNativeToolCalls = false;
    const nativeToolCalls: Array<{ name: string; args: string }> = [];

    // @ts-ignore
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice?.delta) continue;

      if (choice.delta.content) {
        content += choice.delta.content;
        w(choice.delta.content);
      }

      if (choice.delta.tool_calls) {
        gotNativeToolCalls = true;
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? nativeToolCalls.length;
          if (!nativeToolCalls[idx]) nativeToolCalls[idx] = { name: "", args: "" };
          if (tc.function?.name) nativeToolCalls[idx].name += tc.function.name;
          if (tc.function?.arguments) nativeToolCalls[idx].args += tc.function.arguments;
        }
      }
    }

    w(`${RESET}\n`);
    const elapsed = Date.now() - start;

    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    let toolCallFormat: "native" | "xml" | "none" = "none";

    if (gotNativeToolCalls && nativeToolCalls.length > 0) {
      toolCallFormat = "native";
      for (const entry of nativeToolCalls) {
        try {
          toolCalls.push({ name: entry.name, arguments: JSON.parse(entry.args) });
        } catch {
          toolCalls.push({ name: entry.name, arguments: {} });
        }
      }
    } else {
      const parsed = parseToolCallsFromText(content);
      if (parsed.length > 0) {
        toolCallFormat = "xml";
        toolCalls = parsed;
      }
    }

    const err = scenario.validate(toolCalls, content);
    const verdict = err === null ? `${BG_GREEN} PASS ${RESET}` : `${BG_RED} FAIL ${RESET} ${DIM}${err}${RESET}`;
    const formatLabel = toolCallFormat === "native" ? `${DIM}[native]${RESET}` : toolCallFormat === "xml" ? `${DIM}[XML]${RESET}` : `${DIM}[none]${RESET}`;

    w(`    ${verdict} ${DIM}${(elapsed / 1000).toFixed(1)}s${RESET} ${formatLabel}\n`);

    return { modelId: model.id, modelShort: model.short, scenario: scenario.name, pass: err === null, error: err, timeMs: elapsed, family: model.family, toolCallFormat };
  } catch (e: any) {
    w(`${RESET}\n`);
    const elapsed = Date.now() - start;
    const msg = e.message?.slice(0, 80) ?? String(e);
    w(`    ${BG_RED} ERR ${RESET} ${DIM}${msg} | ${(elapsed / 1000).toFixed(1)}s${RESET}\n`);
    return { modelId: model.id, modelShort: model.short, scenario: scenario.name, pass: false, error: msg, timeMs: elapsed, family: model.family, toolCallFormat: "none" };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`\n${BOLD}  TOOL USE BENCHMARK${RESET}`);
  console.log(`  ${DIM}${BENCH_MODELS.length} models x ${scenarios.length} scenarios = ${BENCH_MODELS.length * scenarios.length} runs${RESET}\n`);

  const allResults: Result[] = [];

  for (const model of BENCH_MODELS) {
    console.log(`\n${BOLD}  ── ${model.short} (${model.family}) ──${RESET}`);
    for (const scenario of scenarios) {
      const r = await runOne(model, scenario);
      allResults.push(r);
      await sleep(200);
    }
  }

  // Scoreboard
  console.log(`\n\n${BOLD}  ═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  SCOREBOARD${RESET}`);
  console.log(`  ═══════════════════════════════════════\n`);

  console.log(`  ${"Model".padEnd(30)} Pass  Rate     Avg`);
  console.log(`  ${"─".repeat(55)}`);

  const byModel = new Map<string, Result[]>();
  for (const r of allResults) {
    const arr = byModel.get(r.modelId) ?? [];
    arr.push(r);
    byModel.set(r.modelId, arr);
  }

  for (const [modelId, results] of byModel) {
    const pass = results.filter((r) => r.pass).length;
    const total = results.length;
    const avgMs = results.reduce((s, r) => s + r.timeMs, 0) / total;
    const rate = (pass / total) * 100;
    console.log(`  ${results[0].modelShort.padEnd(30)} ${String(pass).padStart(2)}/${total}   ${rate.toFixed(0).padStart(3)}%  ${(avgMs / 1000).toFixed(1)}s`);
  }

  // By scenario
  console.log(`\n${BOLD}  BY SCENARIO${RESET}`);
  for (const scenario of scenarios) {
    const results = allResults.filter((r) => r.scenario === scenario.name);
    const pass = results.filter((r) => r.pass).length;
    const marks = results.map((r) => (r.pass ? "\u2713" : "\u2717")).join("");
    console.log(`  ${scenario.name.padEnd(18)} ${String(pass).padStart(2)}/${results.length}  ${marks}`);
  }

  const totalPass = allResults.filter((r) => r.pass).length;
  console.log(`\n  ${BOLD}Total: ${totalPass}/${allResults.length} (${((totalPass / allResults.length) * 100).toFixed(0)}%)${RESET}\n`);
}

main();
