/**
 * Swarm TUI demo — visual only, no real processing.
 *
 * Run: npx tsx demos/swarm-tui.ts
 */

import { setTimeout as sleep } from "timers/promises";
import {
    TUI,
    ProcessTerminal,
    type Component,
    visibleWidth,
    truncateToWidth,
} from "@mariozechner/pi-tui";

// ─── colours ──────────────────────────────────────────────────────────────────

const R = "\x1b[0m";
const bold = (s: string) => `\x1b[1m${s}${R}`;
const dim = (s: string) => `\x1b[2m${s}${R}`;
const gray = (s: string) => `\x1b[90m${s}${R}`;
const botCol = (i: number, s: string) => {
    return [`\x1b[36m`, `\x1b[33m`, `\x1b[35m`, `\x1b[32m`][i % 4] + s + R;
};

// Background colour fills — dark per-bot hues + dim gray for empty portion
const BOT_BG = [
    "\x1b[48;5;23m",
    "\x1b[48;5;130m",
    "\x1b[48;5;53m",
    "\x1b[48;5;22m",
];
const EMPTY_BG = "\x1b[48;5;236m";
const OVERALL_FILL_BG = "\x1b[48;5;18m";
const OVERALL_EMPTY_BG = "\x1b[48;5;234m";
const WHITE_FG = "\x1b[97m";

/** Render a full-width background progress bar with plain text overlaid. */
function bgBar(
    plainText: string,
    width: number,
    pct: number,
    fillBg: string,
    emptyBg: string,
): string {
    const padded = plainText.padEnd(width).slice(0, width);
    const filledW = Math.round((pct / 100) * width);
    return `${fillBg}${WHITE_FG}${padded.slice(0, filledW)}${R}${emptyBg}${WHITE_FG}${padded.slice(filledW)}${R}`;
}

// ─── Lines component (simple static log) ─────────────────────────────────────

class Lines implements Component {
    lines: string[] = [];
    add(line: string) {
        this.lines.push(line);
    }
    render(w: number): string[] {
        return this.lines.map((l) => truncateToWidth(l, w));
    }
    invalidate() {}
}

// ─── SwarmPanel — compact single-line-per-bot + collective bar ───────────────

interface BotState {
    fileIdx: number | null;
    file: string | null;
    progress: number; // 0–100
    snippet: string; // short response text shown inline
    status: "idle" | "reading" | "done";
}

class SwarmPanel implements Component {
    bots: BotState[] = [0, 1, 2, 3].map(() => ({
        fileIdx: null,
        file: null,
        progress: 0,
        snippet: "",
        status: "idle" as const,
    }));
    filesCompleted = 0;

    constructor(public totalFiles: number) {}

    render(w: number): string[] {
        const lines: string[] = [];

        // ── collective bar ───────────────────────────────────────────────────
        const overallPct = Math.round(
            (this.filesCompleted / this.totalFiles) * 100,
        );
        const overallLabel = `  ◈ overall  ${this.filesCompleted}/${this.totalFiles} files  ${overallPct}%`;
        lines.push(
            bgBar(
                overallLabel,
                w,
                overallPct,
                OVERALL_FILL_BG,
                OVERALL_EMPTY_BG,
            ),
        );
        lines.push("");

        // ── one line per bot ─────────────────────────────────────────────────
        for (let i = 0; i < 4; i++) {
            const b = this.bots[i];
            const pctStr =
                b.status !== "idle"
                    ? `  ${String(b.progress).padStart(3)}%`
                    : "";
            const tag = b.fileIdx !== null ? ` [${b.fileIdx}]` : "";
            const label = `  sbot-${i}${tag}`;
            const file = b.file ? `  ${b.file}` : "";
            const snip = b.snippet
                ? `  ${b.snippet}`
                : b.status === "idle"
                  ? "  idle"
                  : "";
            // build plain text: name + file + snippet (truncated), pct right-aligned
            const rightW = pctStr.length;
            const leftMax = w - rightW;
            let left = label + file + snip;
            if (left.length > leftMax) left = left.slice(0, leftMax);
            const plain = left.padEnd(leftMax) + pctStr;
            lines.push(bgBar(plain, w, b.progress, BOT_BG[i], EMPTY_BG));
        }

        return lines;
    }

    invalidate() {}
}

// ─── demo data ────────────────────────────────────────────────────────────────

const FILES = [
    {
        name: "index.ts",
        content: [
            'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
            'import { registerProvider }        from "./handlers/provider";',
            'import { registerConcurrencyTracking } from "./handlers/concurrency";',
            'import { registerContextTracking }  from "./handlers/context";',
            'import { registerCompaction }       from "./handlers/compaction";',
            "",
            "export default function(pi: ExtensionAPI) {",
            "    registerProvider(pi);",
            "    registerConcurrencyTracking(pi);",
            "    registerContextTracking(pi);",
            "    registerCompaction(pi);",
            "}",
        ],
        resp: "Main entry point. Wires up four handler modules: provider, concurrency, context, and compaction.",
    },
    {
        name: "models.ts",
        content: [
            "const SAFETY_FACTOR = 0.75;",
            "const MODEL_CLASSES: Record<string, ModelClass> = {",
            '    "glm47-flash": { context_limit: 32768, concurrency_use: 2 },',
            '    "kimi-k2":     { context_limit: 32768, concurrency_use: 4 },',
            '    "deepseek-v3.2": { context_limit: 32768, concurrency_use: 4 },',
            '    "qwen3-32b":   { context_limit: 32768, concurrency_use: 2 },',
            '    "qwen3-235b":  { context_limit: 32768, concurrency_use: 4 },',
            "};",
            "export function getModelConfig(entry: ModelEntry) {",
            "    const safe = Math.floor(mc.context_limit * SAFETY_FACTOR);",
            "    return { id: entry.id, contextWindow: safe, ... };",
            "}",
        ],
        resp: "Defines 14 model configs across 8 classes. 0.75 safety factor shrinks the reported window to prevent chars/4 overflow.",
    },
    {
        name: "tokenize.ts",
        content: [
            "const tokenCache = new Map<string, number>();",
            "",
            "export async function tokenize(",
            "    model: string, text: string, apiKey?: string",
            "): Promise<number> {",
            "    const key = `${model}:${simpleHash(text)}`;",
            "    if (tokenCache.has(key)) return tokenCache.get(key)!;",
            "    const res = await fetch(`${BASE_URL}/tokenize`, {",
            '        method: "POST",',
            "        body: JSON.stringify({ model, prompt: text }),",
            "        headers: { Authorization: `Bearer ${apiKey}` },",
            "    });",
            "    const count = (await res.json()).tokens;",
            "    tokenCache.set(key, count);",
            "    return count;",
            "}",
        ],
        resp: "Calls /v1/tokenize for accurate counts. LRU cache on (model, text_hash) avoids redundant API calls.",
    },
    {
        name: "handlers/shared.ts",
        content: [
            'export const BASE_URL = "https://api.featherless.ai/v1";',
            'export const PROVIDER = "featherless-ai";',
            "",
            "export async function getApiKey(ctx: any): Promise<string | undefined> {",
            "    if (ctx.modelRegistry) {",
            "        const key = await ctx.modelRegistry",
            "            .getApiKeyForProvider(PROVIDER);",
            "        if (key) return key;",
            "    }",
            "    return process.env.FEATHERLESS_API_KEY;",
            "}",
        ],
        resp: "Shared constants and getApiKey() — checks modelRegistry first, falls back to env var.",
    },
    {
        name: "handlers/provider.ts",
        content: [
            "export function registerProvider(pi: ExtensionAPI) {",
            "    pi.registerProvider(PROVIDER, {",
            "        baseUrl: BASE_URL,",
            '        api: "openai-completions",',
            "        models: MODELS.map(getModelConfig),",
            "        oauth: {",
            '            name: "Featherless AI",',
            "            async login(callbacks) {",
            '                callbacks.onAuth({ url: "featherless.ai/account/api-keys" });',
            '                const key = await callbacks.onPrompt({ message: "Paste key:" });',
            "                return { access: key, expires: 60*60*24*360 };",
            "            },",
            "        },",
            "    });",
            "}",
        ],
        resp: "Registers the featherless-ai provider with OAuth. Redirects to API keys page and prompts for key.",
    },
    {
        name: "handlers/concurrency.ts",
        content: [
            "const state = {",
            "    activeRequests: new Map<string, number>(),",
            "    totalCost: 0,",
            "    limit: 4,",
            "};",
            "",
            "export function registerConcurrencyTracking(pi: ExtensionAPI) {",
            '    pi.on("before_provider_request", async (event, ctx) => {',
            "        const cost = getConcurrencyUse(modelClass);",
            "        state.activeRequests.set(requestId, cost);",
            "        state.totalCost += cost;",
            "    });",
            '    pi.on("turn_end", async (_e, ctx) => {',
            "        release(ctx.model.id);",
            "    });",
            "}",
        ],
        resp: "Tracks in-flight request costs. Parses 429s to auto-calibrate limit. Releases on turn_end.",
    },
    {
        name: "handlers/compaction.ts",
        content: [
            "const MAX_SUMMARY_TOKENS = Math.floor(0.8 * 16384); // 13107",
            "",
            "export function registerCompaction(pi: ExtensionAPI) {",
            '    pi.on("session_before_compact", async (event, ctx) => {',
            "        const { messagesToSummarize, turnPrefixMessages,",
            "                firstKeptEntryId, previousSummary } = event.preparation;",
            "        const convText = serializeConversation(",
            "            convertToLlm([...messagesToSummarize, ...turnPrefixMessages])",
            "        );",
            "        const prevCtx = previousSummary",
            '            ? `\\n\\nPrevious summary:\\n${previousSummary}` : "";',
            "        const response = await completeSimple(model, {",
            '            messages: [{ role: "user", content:',
            '                [{ type: "text", text: summaryPrompt + prevCtx + convText }]',
            "            }]}, { apiKey, maxTokens: MAX_SUMMARY_TOKENS });",
            "    });",
            "}",
        ],
        resp: "Custom high-fidelity compaction. Injects previous summary as context, caps output at 80% of 16k reserve.",
    },
];

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);

    const preChat = new Lines();
    const panel = new SwarmPanel(FILES.length);
    const postChat = new Lines();

    tui.addChild(preChat);
    tui.start();

    const R_ = tui.requestRender.bind(tui);

    // Typing helper — writes into a Lines component character by character
    async function type(log: Lines, prefix: string, text: string, delay = 16) {
        let current = "";
        const before = log.lines.slice();
        for (const ch of text) {
            current += ch;
            log.lines = [...before, prefix + current];
            R_();
            await sleep(delay);
        }
        log.lines = [...before, prefix + text];
        R_();
    }

    // ── scene 1: user asks ────────────────────────────────────────────────────
    preChat.add("");
    preChat.add(gray("┌ user"));
    await type(
        preChat,
        gray("│ ") + "\x1b[97m",
        "What does this codebase do and how is it structured?",
        22,
    );
    preChat.add(gray("└"));
    preChat.add("");
    await sleep(400);

    // ── scene 2: bot-0 wakes up ───────────────────────────────────────────────
    preChat.add(botCol(0, bold("┌ bot-0")));
    await type(
        preChat,
        botCol(0, "│ "),
        "Just woke up. Let me get my bearings.",
        20,
    );
    await sleep(300);
    preChat.add(botCol(0, "│ ") + dim("$ ls"));
    R_();
    await sleep(500);
    for (const row of [
        "demos/           docs/            handlers/",
        "index.ts         models.ts        node_modules/",
        "package.json     summaryPrompt.txt tokenize.ts",
    ]) {
        preChat.add(botCol(0, "│ ") + dim(row));
        R_();
        await sleep(70);
    }
    await sleep(300);
    await type(
        preChat,
        botCol(0, "│ "),
        "Seven source files. I'll read them all at once — launching a swarm.",
        18,
    );
    preChat.add(botCol(0, "└"));
    preChat.add("");
    R_();
    await sleep(400);

    // ── scene 3: swarm panel + postChat appear together (postChat grows below) ──
    tui.addChild(panel);
    tui.addChild(postChat);
    postChat.add("");
    R_();
    await sleep(300);

    let fileQueue = 4;

    function addFileSummary(f: (typeof FILES)[number]) {
        postChat.add(bold(f.name));
        const words = f.resp.split(" ");
        let line = "  ";
        for (const word of words) {
            if (
                visibleWidth(line) + word.length + 1 > terminal.columns - 2 &&
                line.trim()
            ) {
                postChat.add(dim(line));
                line = "  " + word + " ";
            } else line += word + " ";
        }
        if (line.trim()) postChat.add(dim(line));
        postChat.add("");
        R_();
    }

    async function runBot(
        botIdx: number,
        globalIdx: number,
        file: (typeof FILES)[number],
    ) {
        const b = panel.bots[botIdx];
        b.fileIdx = globalIdx;
        b.file = file.name;
        b.progress = 0;
        b.snippet = "";
        b.status = "reading";
        R_();

        const DURATION = 1000;
        const STEPS = 25;

        await Promise.all([
            // progress ticks
            (async () => {
                for (let s = 1; s <= STEPS; s++) {
                    await sleep(DURATION / STEPS);
                    b.progress = Math.round((s / STEPS) * 100);
                    R_();
                }
            })(),
            // build snippet word-by-word
            (async () => {
                const words = file.resp.split(" ");
                const MAX_SNIP = 40;
                let built = "";
                for (const word of words) {
                    const next = built ? built + " " + word : word;
                    built = next.length > MAX_SNIP ? built : next;
                    b.snippet = built;
                    R_();
                    await sleep(DURATION / words.length);
                }
            })(),
        ]);

        b.status = "done";
        panel.filesCompleted++;
        addFileSummary(file);
        await sleep(200);

        const next = fileQueue++;
        if (next < FILES.length) {
            await runBot(botIdx, next, FILES[next]);
        }
    }

    // Kick off 4 bots with slight stagger
    await Promise.all([
        (async () => {
            await sleep(0);
            await runBot(0, 0, FILES[0]);
        })(),
        (async () => {
            await sleep(40);
            await runBot(1, 1, FILES[1]);
        })(),
        (async () => {
            await sleep(20);
            await runBot(2, 2, FILES[2]);
        })(),
        (async () => {
            await sleep(55);
            await runBot(3, 3, FILES[3]);
        })(),
    ]);

    await sleep(300);

    postChat.add(botCol(0, bold("┌ bot-0")));
    for (const line of [
        "This is a Featherless AI provider extension for pi.",
        "Responsibility is split across four handler modules.",
        "Token counting uses /v1/tokenize with delta-based batching.",
        "Concurrency is auto-calibrated from 429 responses.",
        "Compaction caps summaries at 80% of a 16k token reserve.",
        "The 0.75 safety factor prevents silent overflow from chars/4.",
    ]) {
        await type(postChat, botCol(0, "│ "), line, 13);
        await sleep(60);
    }
    postChat.add(botCol(0, "└"));
    postChat.add("");
    R_();

    await sleep(1200);
    tui.stop();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
