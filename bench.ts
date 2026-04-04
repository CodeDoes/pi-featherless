#!/usr/bin/env npx tsx
/**
 * Silly tool use bench for Featherless models.
 * One model at a time. Full output. Stats at the end.
 * Runs in batches to respect Featherless model switch limits.
 */

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { parseToolCallTags } from "./src/extensions/provider/index.ts";

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

// ── Flags ───────────────────────────────────────────────────────────────────

function getFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? Number(process.argv[i + 1]) : fallback;
}
const BATCH_SIZE = getFlag("batch", 4);
const BATCH_DELAY = getFlag("delay", 5);

// ── ANSI ────────────────────────────────────────────────────────────────────

const COLORS = [
  "\x1b[36m",
  "\x1b[33m",
  "\x1b[35m",
  "\x1b[32m",
  "\x1b[34m",
  "\x1b[91m",
  "\x1b[93m",
  "\x1b[95m",
  "\x1b[96m",
  "\x1b[92m",
  "\x1b[94m",
  "\x1b[31m",
];
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";
const BG_YELLOW = "\x1b[43m\x1b[30m";

// ── Bench model list ────────────────────────────────────────────────────────

interface BenchModel {
  id: string;
  short: string;
  cc: number;
  thinking: boolean;
  family: string;
}

const BENCH_MODELS: BenchModel[] = [
  // Qwen3
  {
    id: "Qwen/Qwen3-32B",
    short: "Qwen3 32B",
    cc: 2,
    thinking: true,
    family: "qwen3",
  },
  {
    id: "Qwen/Qwen3-14B",
    short: "Qwen3 14B",
    cc: 1,
    thinking: true,
    family: "qwen3",
  },
  {
    id: "Qwen/Qwen3-8B",
    short: "Qwen3 8B",
    cc: 1,
    thinking: true,
    family: "qwen3",
  },
  {
    id: "Qwen/Qwen3-4B",
    short: "Qwen3 4B",
    cc: 1,
    thinking: true,
    family: "qwen3",
  },
  // Qwen3.5
  {
    id: "Qwen/Qwen3.5-27B",
    short: "Qwen3.5 27B",
    cc: 2,
    thinking: true,
    family: "qwen3.5",
  },
  {
    id: "Qwen/Qwen3.5-9B",
    short: "Qwen3.5 9B",
    cc: 1,
    thinking: true,
    family: "qwen3.5",
  },
  // Qwen2.5
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    short: "Qwen2.5 72B",
    cc: 4,
    thinking: false,
    family: "qwen2.5",
  },
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    short: "Qwen2.5-Coder 32B",
    cc: 2,
    thinking: false,
    family: "qwen2.5",
  },
  // DeepSeek
  {
    id: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    short: "DS-R1 Qwen3-8B",
    cc: 1,
    thinking: true,
    family: "deepseek",
  },
  {
    id: "deepseek-ai/DeepSeek-V3.2",
    short: "DeepSeek V3.2",
    cc: 4,
    thinking: false,
    family: "deepseek",
  },
  // Kimi
  {
    id: "moonshotai/Kimi-K2-Instruct",
    short: "Kimi K2",
    cc: 4,
    thinking: false,
    family: "kimi",
  },
  // Llama
  {
    id: "meta-llama/Llama-3.1-70B-Instruct",
    short: "Llama 3.1 70B",
    cc: 4,
    thinking: false,
    family: "llama",
  },
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    short: "Llama 3.1 8B",
    cc: 1,
    thinking: false,
    family: "llama",
  },
  // Mistral
  {
    id: "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
    short: "Mistral 3.2 24B",
    cc: 2,
    thinking: false,
    family: "mistral",
  },
  // Hermes
  {
    id: "NousResearch/Hermes-4-14B",
    short: "Hermes 4 14B",
    cc: 1,
    thinking: false,
    family: "hermes",
  },
  // Gemma
  {
    id: "google/gemma-3-27b-it",
    short: "Gemma 3 27B",
    cc: 2,
    thinking: false,
    family: "gemma",
  },
  {
    id: "google/gemma-3-12b-it",
    short: "Gemma 3 12B",
    cc: 1,
    thinking: false,
    family: "gemma",
  },
  // RWKV
  {
    id: "featherless-ai/QRWKV-72B",
    short: "QRWKV 72B",
    cc: 4,
    thinking: false,
    family: "rwkv",
  },
  {
    id: "recursal/RWKV6Qwen2.5-32B-QwQ-Preview",
    short: "RWKV6 32B",
    cc: 2,
    thinking: false,
    family: "rwkv",
  },
  // Nvidia
  {
    id: "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
    short: "Nemotron 70B",
    cc: 4,
    thinking: false,
    family: "nvidia",
  },
  // Phi
  {
    id: "microsoft/Phi-4-mini-reasoning",
    short: "Phi-4 Reasoning",
    cc: 1,
    thinking: false,
    family: "phi",
  },
];

// ── Tools ───────────────────────────────────────────────────────────────────

const bashTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "bash",
    description: "Run a bash command and return its output",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
      },
      required: ["command"],
    },
  },
};

const writeTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
};

const readTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file and return its content",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

// ── Scenarios ───────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  prompt: string;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  validate: (
    calls: Array<{ name: string; arguments: Record<string, unknown> }>,
    text: string,
  ) => string | null;
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
    name: "Right Tool",
    prompt: "Read the contents of /etc/hostname",
    tools: [bashTool, writeTool, readTool],
    validate: (c) => {
      if (c.length !== 1) return `${c.length} calls`;
      if (c[0].name === "write_file") return "tried to WRITE??";
      if (!JSON.stringify(c[0].arguments).includes("hostname"))
        return "wrong target";
      return null;
    },
  },
  {
    name: "JSON Inception",
    prompt:
      'Write a file called config.json with: {"port": 3000, "host": "0.0.0.0"}',
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
];

// ── Runner (sequential, one at a time) ──────────────────────────────────────

interface Result {
  modelId: string;
  modelShort: string;
  scenario: string;
  pass: boolean;
  error: string | null;
  timeMs: number;
  family: string;
}

async function runOne(
  model: BenchModel,
  color: string,
  scenario: Scenario,
): Promise<Result> {
  const w = process.stdout.write.bind(process.stdout);

  w(
    `\n  ${color}${BOLD}${model.short}${RESET} ${DIM}cc:${model.cc} ${model.family}${RESET}  ${BOLD}${scenario.name}${RESET}\n`,
  );
  w(`  ${DIM}prompt: ${scenario.prompt}${RESET}\n`);
  w(`  ${color}`);

  const start = Date.now();

  try {
    const params: any = {
      model: model.id,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant with tool access. Be concise.",
        },
        { role: "user", content: scenario.prompt },
      ],
      tools: scenario.tools,
      max_tokens: 512,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (model.thinking) params.enable_thinking = true;

    const stream = await client.chat.completions.create(params);

    let content = "";
    let thinkingText = "";
    let inThinking = false;
    // Native tool_calls
    const nativeTC = new Map<number, { name: string; args: string }>();
    let gotNative = false;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice?.delta) continue;

      // Thinking
      const reasoning = (choice.delta as any).reasoning;
      if (reasoning) {
        if (!inThinking) {
          w(`${DIM}`);
          inThinking = true;
        }
        thinkingText += reasoning;
        w(reasoning);
        continue;
      }

      // Content
      if (choice.delta.content) {
        if (inThinking) {
          w(`${RESET}\n  ${color}`);
          inThinking = false;
        }
        content += choice.delta.content;
        w(choice.delta.content);
      }

      // Native tool_calls
      if (choice.delta.tool_calls) {
        if (inThinking) {
          w(`${RESET}\n  ${color}`);
          inThinking = false;
        }
        gotNative = true;
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          let entry = nativeTC.get(idx);
          if (!entry) {
            entry = { name: "", args: "" };
            nativeTC.set(idx, entry);
          }
          if (tc.function?.name) {
            entry.name += tc.function.name;
            w(`${BOLD}${tc.function.name}${RESET}${color}`);
          }
          if (tc.function?.arguments) {
            entry.args += tc.function.arguments;
            w(tc.function.arguments);
          }
        }
      }
    }

    w(`${RESET}\n`);

    if (inThinking) {
      w(`${RESET}\n`);
    }

    const elapsed = Date.now() - start;

    // Parse tool calls
    let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> =
      [];
    let plainText = content;
    if (gotNative && nativeTC.size > 0) {
      for (const [, entry] of nativeTC) {
        try {
          toolCalls.push({
            name: entry.name,
            arguments: JSON.parse(entry.args),
          });
        } catch {
          toolCalls.push({ name: entry.name, arguments: {} });
        }
      }
    } else {
      const parsed = parseToolCallTags(content);
      toolCalls = parsed.toolCalls;
      plainText = parsed.textBefore;
    }

    const err = scenario.validate(toolCalls, plainText);
    const verdict =
      err === null
        ? `${BG_GREEN} PASS ${RESET}`
        : `${BG_RED} FAIL ${RESET} ${DIM}${err}${RESET}`;
    const tcInfo =
      toolCalls.length > 0
        ? `${DIM}tools: ${toolCalls.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(", ")}${RESET}`
        : gotNative
          ? `${DIM}(native, 0 calls)${RESET}`
          : "";

    w(`  ${verdict} ${DIM}${(elapsed / 1000).toFixed(1)}s${RESET} ${tcInfo}\n`);

    return {
      modelId: model.id,
      modelShort: model.short,
      scenario: scenario.name,
      pass: err === null,
      error: err,
      timeMs: elapsed,
      family: model.family,
    };
  } catch (e: any) {
    w(`${RESET}\n`);
    const elapsed = Date.now() - start;
    const msg = e.message?.slice(0, 80) ?? String(e);
    w(
      `  ${BG_RED} ERR ${RESET} ${DIM}${msg} | ${(elapsed / 1000).toFixed(1)}s${RESET}\n`,
    );
    return {
      modelId: model.id,
      modelShort: model.short,
      scenario: scenario.name,
      pass: false,
      error: msg,
      timeMs: elapsed,
      family: model.family,
    };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const positional: string[] = [];
  {
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith("--")) {
        i++;
        continue;
      }
      positional.push(argv[i]);
    }
  }
  const only = positional[0];
  const models = BENCH_MODELS.filter((m) =>
    only
      ? m.id.toLowerCase().includes(only.toLowerCase()) ||
        m.family.includes(only.toLowerCase()) ||
        m.short.toLowerCase().includes(only.toLowerCase())
      : true,
  );

  const totalBatches = Math.ceil(models.length / BATCH_SIZE);
  console.log(`\n${BOLD}  SILLY TOOL USE BENCH${RESET}`);
  console.log(
    `  ${DIM}${models.length} models x ${scenarios.length} scenarios = ${models.length * scenarios.length} runs${RESET}`,
  );
  console.log(
    `  ${DIM}${totalBatches} batch(es) of ${BATCH_SIZE} | ${BATCH_DELAY}s delay between batches${RESET}`,
  );

  const allResults: Result[] = [];

  for (let b = 0; b < totalBatches; b++) {
    const batch = models.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

    if (b > 0) {
      console.log(
        `\n${DIM}  --- waiting ${BATCH_DELAY}s for model switch limit ---${RESET}`,
      );
      await sleep(BATCH_DELAY * 1000);
    }

    console.log(
      `\n${BOLD}  ═══ BATCH ${b + 1}/${totalBatches} ═══${RESET} ${DIM}[${batch.map((m) => m.short).join(", ")}]${RESET}`,
    );

    for (const model of batch) {
      const color = COLORS[models.indexOf(model) % COLORS.length];
      for (const scenario of scenarios) {
        const r = await runOne(model, color, scenario);
        allResults.push(r);
      }
    }
  }

  // ── Scoreboard ────────────────────────────────────────────────────────

  console.log(`\n\n${BOLD}  ═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  SCOREBOARD${RESET}`);
  console.log(`  ═══════════════════════════════════════\n`);
  console.log(
    `  ${"Model".padEnd(25)} ${"Family".padEnd(10)} Pass  ${"Rate".padEnd(14)} Avg    CC`,
  );
  console.log(`  ${"─".repeat(78)}`);

  const byModel = new Map<string, Result[]>();
  for (const r of allResults) {
    const arr = byModel.get(r.modelId) ?? [];
    arr.push(r);
    byModel.set(r.modelId, arr);
  }

  const scores: Array<{
    model: string;
    short: string;
    family: string;
    color: string;
    pass: number;
    total: number;
    rate: number;
    avgMs: number;
    cc: number;
  }> = [];

  let mi = 0;
  for (const [modelId, results] of byModel) {
    const pass = results.filter((r) => r.pass).length;
    const total = results.length;
    const m = BENCH_MODELS.find((x) => x.id === modelId)!;
    scores.push({
      model: modelId,
      short: results[0].modelShort,
      family: results[0].family,
      color: COLORS[mi++ % COLORS.length],
      pass,
      total,
      rate: pass / total,
      avgMs: results.reduce((s, r) => s + r.timeMs, 0) / total,
      cc: m.cc,
    });
  }

  scores.sort((a, b) => b.rate - a.rate || a.avgMs - b.avgMs);

  for (const s of scores) {
    const bar =
      s.color +
      "\u2588".repeat(Math.round(s.rate * 10)) +
      RESET +
      DIM +
      "\u2591".repeat(10 - Math.round(s.rate * 10)) +
      RESET;
    const name = `${s.color}${s.short}${RESET}`;
    const pad = 25 - s.short.length;
    console.log(
      `  ${name}${" ".repeat(Math.max(1, pad))} ${DIM}${s.family.padEnd(10)}${RESET} ${s.pass}/${s.total}   ${bar} ${(s.rate * 100).toFixed(0).padStart(3)}%  ${(s.avgMs / 1000).toFixed(1).padStart(5)}s  ${DIM}${s.cc}${RESET}`,
    );
  }

  // ── By scenario ─────────────────────────────────────────────────────

  console.log(`\n${BOLD}  BY SCENARIO${RESET}`);
  for (const scenario of scenarios) {
    const results = allResults.filter((r) => r.scenario === scenario.name);
    const pass = results.filter((r) => r.pass).length;
    const bar =
      pass === results.length ? BG_GREEN : pass === 0 ? BG_RED : BG_YELLOW;
    console.log(
      `  ${scenario.name.padEnd(22)} ${bar} ${String(pass).padStart(2)}/${results.length} ${RESET}  ${DIM}${results.map((r) => (r.pass ? "\u2713" : "\u2717")).join("")}${RESET}`,
    );
  }

  // ── By family ───────────────────────────────────────────────────────

  console.log(`\n${BOLD}  BY FAMILY${RESET}`);
  const families = new Map<string, Result[]>();
  for (const r of allResults) {
    const arr = families.get(r.family) ?? [];
    arr.push(r);
    families.set(r.family, arr);
  }
  for (const [family, results] of [...families].sort((a, b) => {
    const ra = a[1].filter((r) => r.pass).length / a[1].length;
    const rb = b[1].filter((r) => r.pass).length / b[1].length;
    return rb - ra;
  })) {
    const pass = results.filter((r) => r.pass).length;
    const pct = ((pass / results.length) * 100).toFixed(0);
    console.log(`  ${family.padEnd(12)} ${pass}/${results.length} (${pct}%)`);
  }

  const totalPass = allResults.filter((r) => r.pass).length;
  const pct = ((totalPass / allResults.length) * 100).toFixed(0);
  console.log(
    `\n  ${BOLD}Total: ${totalPass}/${allResults.length} (${pct}%)${RESET}\n`,
  );
}

main();
