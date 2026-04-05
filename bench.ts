#!/usr/bin/env npx tsx
/**
 * Tool use bench for Featherless models.
 * Tracks pass rate, tokens generated, and time per scenario.
 *
 * Usage:
 *   npx tsx bench.ts              # run all
 *   npx tsx bench.ts glm          # filter by name/family
 *   npx tsx bench.ts --batch 2    # batch size
 *   npx tsx bench.ts --delay 10   # seconds between batches
 */

import { readFileSync } from "node:fs";
import OpenAI from "openai";

// Load .env
try {
    const env = readFileSync("../.env", "utf-8");
    for (const line of env.split("\n")) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
} catch {}

const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) {
    console.error("Set FEATHERLESS_API_KEY (or add to ../.env)");
    process.exit(1);
}

const client = new OpenAI({
    apiKey: API_KEY,
    baseURL: "https://api.featherless.ai/v1",
});

// ── Flags ──────────────────────────────────────────────────────────────────

function getFlag(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? Number(process.argv[i + 1]) : fallback;
}
const BATCH_SIZE = getFlag("batch", 1);
const BATCH_DELAY = getFlag("delay", 16);  // 4 switches/min limit

// ── ANSI ───────────────────────────────────────────────────────────────────

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";
const BG_YELLOW = "\x1b[43m\x1b[30m";

// Family markers — distinct unicode symbols for quick visual scanning
const FAMILY_MARKER: Record<string, string> = {
    glm: "\u25c6",       // ◆
    minimax: "\u25cf",    // ●
    kimi: "\u25b2",       // ▲
    deepseek: "\u25a0",   // ■
    mistral: "\u2666",    // ♦
    qwen3: "\u2605",      // ★
};

// ── Bench models ───────────────────────────────────────────────────────────

interface BenchModel {
    id: string;
    short: string;
    cc: number;
    thinking: boolean;
    family: string;
}

const BENCH_MODELS: BenchModel[] = [
    // GLM
    { id: "zai-org/GLM-Z1-9B-0414", short: "GLM-Z1 9B", cc: 1, thinking: true, family: "glm" },
    { id: "zai-org/GLM-Z1-32B-0414", short: "GLM-Z1 32B", cc: 2, thinking: true, family: "glm" },
    { id: "zai-org/GLM-4.7-Flash", short: "GLM-4.7 Flash", cc: 2, thinking: false, family: "glm" },
    { id: "zai-org/GLM-4.7", short: "GLM-4.7 357B", cc: 4, thinking: false, family: "glm" },
    { id: "zai-org/GLM-5", short: "GLM-5 754B", cc: 4, thinking: false, family: "glm" },
    // MiniMax
    { id: "MiniMaxAI/MiniMax-M2.5", short: "MiniMax M2.5", cc: 4, thinking: false, family: "minimax" },
    { id: "MiniMaxAI/MiniMax-M2.1", short: "MiniMax M2.1", cc: 4, thinking: false, family: "minimax" },
    // Kimi — officially supported for tool calling
    { id: "moonshotai/Kimi-K2-Instruct", short: "Kimi K2", cc: 4, thinking: false, family: "kimi" },
    { id: "moonshotai/Kimi-K2.5", short: "Kimi K2.5", cc: 4, thinking: false, family: "kimi" },
    // DeepSeek
    { id: "deepseek-ai/DeepSeek-V3.2", short: "DS V3.2", cc: 4, thinking: false, family: "deepseek" },
    { id: "deepseek-ai/DeepSeek-V3.1", short: "DS V3.1", cc: 4, thinking: false, family: "deepseek" },
    // Mistral
    { id: "mistralai/Mistral-Small-3.2-24B-Instruct-2506", short: "Mistral 3.2 24B", cc: 2, thinking: false, family: "mistral" },
    // Qwen3 — officially supported for tool calling
    { id: "Qwen/Qwen3-32B", short: "Qwen3 32B", cc: 2, thinking: true, family: "qwen3" },
    { id: "Qwen/Qwen3-235B-A22B", short: "Qwen3 235B", cc: 4, thinking: true, family: "qwen3" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", short: "Qwen3 Coder 480B", cc: 4, thinking: true, family: "qwen3" },
];

// ── Tools ──────────────────────────────────────────────────────────────────

const bashTool: OpenAI.Chat.Completions.ChatCompletionTool = {
    type: "function",
    function: {
        name: "bash",
        description: "Run a bash command and return its output",
        parameters: {
            type: "object",
            properties: { command: { type: "string", description: "The command to run" } },
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

// ── Scenarios ──────────────────────────────────────────────────────────────

interface Scenario {
    name: string;
    prompt: string;
    tools: OpenAI.Chat.Completions.ChatCompletionTool[];
    validate: (calls: Array<{ name: string; arguments: Record<string, unknown> }>, text: string) => string | null;
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
            if (!JSON.stringify(c[0].arguments).includes("hostname")) return "wrong target";
            return null;
        },
    },
    {
        name: "JSON Inception",
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
];

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Runner ─────────────────────────────────────────────────────────────────

interface Result {
    modelId: string;
    modelShort: string;
    scenario: string;
    pass: boolean;
    error: string | null;
    timeMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    family: string;
}

async function runOne(model: BenchModel, scenario: Scenario): Promise<Result> {
    const w = process.stdout.write.bind(process.stdout);
    const marker = FAMILY_MARKER[model.family] ?? "\u25cb";

    w(`\n  ${CYAN}${marker}${RESET} ${BOLD}${model.short}${RESET} ${DIM}cc:${model.cc}${RESET}  ${BOLD}${scenario.name}${RESET}\n`);
    w(`  ${DIM}prompt: ${scenario.prompt}${RESET}\n`);
    w(`  ${DIM}`);

    const start = Date.now();

    try {
        const params: any = {
            model: model.id,
            messages: [
                { role: "system", content: "You are a helpful assistant with tool access. Be concise." },
                { role: "user", content: scenario.prompt },
            ],
            tools: scenario.tools,
            max_tokens: 512,
            stream: true,
            stream_options: { include_usage: true },
        };
        if (model.thinking) params.enable_thinking = true;

        // Retry on 429 with backoff
        let stream: any;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                stream = await client.chat.completions.create(params);
                break;
            } catch (e: any) {
                if (e.status === 429 && attempt < 2) {
                    const wait = 20 * (attempt + 1);
                    w(`${YELLOW}429, waiting ${wait}s...${RESET} `);
                    await sleep(wait * 1000);
                    continue;
                }
                throw e;
            }
        }

        let content = "";
        let inThinking = false;
        const nativeTC = new Map<number, { name: string; args: string }>();
        let gotNative = false;
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        for await (const chunk of stream) {
            // Capture usage from the final chunk
            if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens ?? 0;
                completionTokens = chunk.usage.completion_tokens ?? 0;
                totalTokens = chunk.usage.total_tokens ?? 0;
            }

            const choice = chunk.choices?.[0];
            if (!choice?.delta) continue;

            const reasoning = (choice.delta as any).reasoning;
            if (reasoning) {
                if (!inThinking) { w(`${DIM}`); inThinking = true; }
                w(reasoning);
                continue;
            }

            if (choice.delta.content) {
                if (inThinking) { w(`${RESET}\n  ${DIM}`); inThinking = false; }
                content += choice.delta.content;
                w(choice.delta.content);
            }

            if (choice.delta.tool_calls) {
                if (inThinking) { w(`${RESET}\n  ${DIM}`); inThinking = false; }
                gotNative = true;
                for (const tc of choice.delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    let entry = nativeTC.get(idx);
                    if (!entry) { entry = { name: "", args: "" }; nativeTC.set(idx, entry); }
                    if (tc.function?.name) { entry.name += tc.function.name; w(`${CYAN}${tc.function.name}${RESET}${DIM}`); }
                    if (tc.function?.arguments) { entry.args += tc.function.arguments; w(tc.function.arguments); }
                }
            }
        }

        w(`${RESET}\n`);
        const elapsed = Date.now() - start;

        // Parse tool calls
        let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
        let plainText = content;
        if (gotNative && nativeTC.size > 0) {
            for (const [, entry] of nativeTC) {
                try {
                    toolCalls.push({ name: entry.name, arguments: JSON.parse(entry.args) });
                } catch {
                    toolCalls.push({ name: entry.name, arguments: {} });
                }
            }
        }

        const err = scenario.validate(toolCalls, plainText);
        const verdict = err === null
            ? `${BG_GREEN} PASS ${RESET}`
            : `${BG_RED} FAIL ${RESET} ${DIM}${err}${RESET}`;
        const tcInfo = toolCalls.length > 0
            ? `${DIM}tools: ${toolCalls.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(", ")}${RESET}`
            : "";
        const tokInfo = `${DIM}${completionTokens}tok${RESET}`;

        w(`  ${verdict} ${DIM}${(elapsed / 1000).toFixed(1)}s${RESET} ${tokInfo} ${tcInfo}\n`);

        return { modelId: model.id, modelShort: model.short, scenario: scenario.name, pass: err === null, error: err, timeMs: elapsed, promptTokens, completionTokens, totalTokens, family: model.family };
    } catch (e: any) {
        w(`${RESET}\n`);
        const elapsed = Date.now() - start;
        const msg = e.message?.slice(0, 80) ?? String(e);
        w(`  ${BG_RED} ERR ${RESET} ${DIM}${msg} | ${(elapsed / 1000).toFixed(1)}s${RESET}\n`);
        return { modelId: model.id, modelShort: model.short, scenario: scenario.name, pass: false, error: msg, timeMs: elapsed, promptTokens: 0, completionTokens: 0, totalTokens: 0, family: model.family };
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const positional: string[] = [];
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--")) { i++; continue; }
        positional.push(argv[i]);
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
    console.log(`\n${BOLD}  TOOL USE BENCH${RESET}`);
    console.log(`  ${DIM}${models.length} models x ${scenarios.length} scenarios = ${models.length * scenarios.length} runs${RESET}`);
    console.log(`  ${DIM}${totalBatches} batch(es) of ${BATCH_SIZE} | ${BATCH_DELAY}s delay between batches${RESET}`);

    const allResults: Result[] = [];

    for (let b = 0; b < totalBatches; b++) {
        const batch = models.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

        if (b > 0) {
            console.log(`\n${DIM}  --- waiting ${BATCH_DELAY}s for model switch limit ---${RESET}`);
            await sleep(BATCH_DELAY * 1000);
        }

        console.log(`\n${BOLD}  ═══ BATCH ${b + 1}/${totalBatches} ═══${RESET} ${DIM}[${batch.map((m) => m.short).join(", ")}]${RESET}`);

        for (const model of batch) {
            for (const scenario of scenarios) {
                const r = await runOne(model, scenario);
                allResults.push(r);
            }
        }
    }

    // ── Scoreboard ─────────────────────────────────────────────────────

    console.log(`\n\n${BOLD}  ═══════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}  SCOREBOARD${RESET}`);
    console.log(`  ═══════════════════════════════════════════════════════════════\n`);
    console.log(`  ${"Model".padEnd(22)} ${"Family".padEnd(10)} Pass  ${"Rate".padEnd(14)} Avg     Tok/run  Total   CC`);
    console.log(`  ${"─".repeat(95)}`);

    const byModel = new Map<string, Result[]>();
    for (const r of allResults) {
        const arr = byModel.get(r.modelId) ?? [];
        arr.push(r);
        byModel.set(r.modelId, arr);
    }

    const scores: Array<{
        short: string; family: string; marker: string;
        pass: number; total: number; rate: number; avgMs: number;
        avgCompletionTok: number; totalCompletionTok: number;
        totalPromptTok: number; cc: number;
    }> = [];

    for (const [modelId, results] of byModel) {
        const pass = results.filter((r) => r.pass).length;
        const total = results.length;
        const m = BENCH_MODELS.find((x) => x.id === modelId)!;
        const totalCompletionTok = results.reduce((s, r) => s + r.completionTokens, 0);
        const totalPromptTok = results.reduce((s, r) => s + r.promptTokens, 0);
        scores.push({
            short: results[0].modelShort, family: results[0].family,
            marker: FAMILY_MARKER[results[0].family] ?? "\u25cb",
            pass, total, rate: pass / total,
            avgMs: results.reduce((s, r) => s + r.timeMs, 0) / total,
            avgCompletionTok: totalCompletionTok / total,
            totalCompletionTok, totalPromptTok,
            cc: m.cc,
        });
    }

    scores.sort((a, b) => b.rate - a.rate || a.avgMs - b.avgMs);

    for (const s of scores) {
        const rateColor = s.rate === 1 ? GREEN : s.rate >= 0.6 ? YELLOW : RED;
        const bar = rateColor + "\u2588".repeat(Math.round(s.rate * 10)) + RESET + DIM + "\u2591".repeat(10 - Math.round(s.rate * 10)) + RESET;
        const name = `${CYAN}${s.marker}${RESET} ${s.short}`;
        const pad = 22 - s.short.length - 2;
        console.log(
            `  ${name}${" ".repeat(Math.max(1, pad))} ${DIM}${s.family.padEnd(10)}${RESET} ` +
            `${s.pass}/${s.total}   ${bar} ${(s.rate * 100).toFixed(0).padStart(3)}%  ` +
            `${(s.avgMs / 1000).toFixed(1).padStart(5)}s  ` +
            `${String(Math.round(s.avgCompletionTok)).padStart(5)}  ` +
            `${String(s.totalCompletionTok).padStart(6)}  ` +
            `${DIM}${s.cc}${RESET}`
        );
    }

    // ── Totals ─────────────────────────────────────────────────────────

    const grandTotalCompletion = allResults.reduce((s, r) => s + r.completionTokens, 0);
    const grandTotalPrompt = allResults.reduce((s, r) => s + r.promptTokens, 0);
    const grandTotalTime = allResults.reduce((s, r) => s + r.timeMs, 0);
    console.log(`\n  ${DIM}Total tokens: ${grandTotalPrompt} prompt + ${grandTotalCompletion} completion = ${grandTotalPrompt + grandTotalCompletion}${RESET}`);
    console.log(`  ${DIM}Total time: ${(grandTotalTime / 1000).toFixed(1)}s${RESET}`);

    // ── By scenario ────────────────────────────────────────────────────

    console.log(`\n${BOLD}  BY SCENARIO${RESET}`);
    for (const scenario of scenarios) {
        const results = allResults.filter((r) => r.scenario === scenario.name);
        const pass = results.filter((r) => r.pass).length;
        const bar = pass === results.length ? BG_GREEN : pass === 0 ? BG_RED : BG_YELLOW;
        console.log(`  ${scenario.name.padEnd(22)} ${bar} ${String(pass).padStart(2)}/${results.length} ${RESET}  ${DIM}${results.map((r) => (r.pass ? "\u2713" : "\u2717")).join("")}${RESET}`);
    }

    // ── By family ──────────────────────────────────────────────────────

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
        const tok = results.reduce((s, r) => s + r.completionTokens, 0);
        const pct = ((pass / results.length) * 100).toFixed(0);
        console.log(`  ${family.padEnd(12)} ${pass}/${results.length} (${pct}%)  ${DIM}${tok} completion tokens${RESET}`);
    }

    const totalPass = allResults.filter((r) => r.pass).length;
    const pct = ((totalPass / allResults.length) * 100).toFixed(0);
    console.log(`\n  ${BOLD}Total: ${totalPass}/${allResults.length} (${pct}%)${RESET}\n`);
}

main();
