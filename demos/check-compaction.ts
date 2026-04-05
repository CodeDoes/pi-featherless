/**
 * Compaction sanity check demo.
 *
 * Loads the largest real pi session, replays what our compaction handler
 * would see at each compaction point, and checks whether the summary fits
 * comfortably back inside the context window.
 *
 * Run:
 *   npx tsx demos/check-compaction.ts          # auto-detects biggest session
 *   SESSION=<path> npx tsx demos/check-compaction.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Model, Context } from "@mariozechner/pi-ai";
import { tokenize } from "../tokenize";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load .env from project root ---
for (const rel of ["../../.env", "../.env"]) {
    const p = resolve(__dirname, rel);
    if (existsSync(p)) {
        for (const line of readFileSync(p, "utf8").split("\n")) {
            const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
        }
        break;
    }
}

const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) { console.error("FEATHERLESS_API_KEY not set"); process.exit(1); }

// --- Config ---
const MODEL_ID        = "zai-org/GLM-4.7-Flash";
const BASE_URL        = "https://api.featherless.ai/v1";
const REAL_WINDOW     = 32768;
const SAFETY_FACTOR   = 0.75;
const REPORTED_WINDOW = Math.floor(REAL_WINDOW * SAFETY_FACTOR);   // 24576
const RESERVE_TOKENS  = 16384;
const MAX_SUMMARY_TOK = Math.floor(0.8 * RESERVE_TOKENS);          // 13107
// After compaction: summary + system_prompt + kept_msgs must stay under window.
// Anything above 40% means the 2nd compaction fires almost immediately.
const SAFE_BUDGET     = Math.floor(REPORTED_WINDOW * 0.4);         // 9830

// Max chars we can send as input (model context - summary reserve, at 3.2 chars/tok)
const MAX_INPUT_CHARS = Math.floor((REAL_WINDOW - MAX_SUMMARY_TOK) * 3.2); // ~63k

const model: Model<"openai-completions"> = {
    id: MODEL_ID, name: MODEL_ID, api: "openai-completions",
    provider: "featherless-ai", baseUrl: BASE_URL, reasoning: false,
    input: ["text"],
    cost: { input: 0.1, output: 0.1, cacheRead: 0.05, cacheWrite: 0.1 },
    contextWindow: REPORTED_WINDOW, maxTokens: REAL_WINDOW,
};

const summaryPrompt = readFileSync(resolve(__dirname, "../summaryPrompt.txt"), "utf8");

// --- Session loading ---

interface SessionEntry {
    type: string;
    id?: string;
    parentId?: string;
    timestamp?: string;
    message?: { role: string; content: any[] };
    firstKeptEntryId?: string;
    tokensBefore?: number;
    summary?: string;
}

function findBiggestSession(): string {
    const sessDir = join(process.env.HOME!, ".pi/agent/sessions");
    let biggest = { size: 0, path: "" };
    for (const dir of readdirSync(sessDir)) {
        const d = join(sessDir, dir);
        for (const f of readdirSync(d)) {
            if (!f.endsWith(".jsonl")) continue;
            const p = join(d, f);
            const size = statSync(p).size;
            if (size > biggest.size) biggest = { size, path: p };
        }
    }
    return biggest.path;
}

function loadSession(path: string): SessionEntry[] {
    return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(l => JSON.parse(l));
}

function extractText(entry: SessionEntry): string {
    const content = entry.message?.content;
    if (!content) return "";
    const parts: string[] = [];
    for (const c of content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "text") parts.push(c.text ?? "");
        else if (c.type === "tool_result") {
            for (const sub of (c.content ?? [])) {
                if (sub?.type === "text") parts.push(sub.text ?? "");
            }
        }
    }
    return parts.join("\n");
}

/**
 * Take the LAST messages before `endIdx` that fit within maxChars total.
 * Returns them in chronological order.
 */
function sliceMessages(
    entries: SessionEntry[],
    endIdx: number,
    maxChars: number,
): SessionEntry[] {
    const msgs = entries.slice(0, endIdx).filter(e => e.type === "message");
    let total = 0;
    const result: SessionEntry[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        const len = extractText(msgs[i]).length;
        if (total + len > maxChars) break;
        result.unshift(msgs[i]);
        total += len;
    }
    return result;
}

// --- Run compaction ---

async function compact(
    msgs: SessionEntry[],
    previousSummary: string | null,
): Promise<{ summary: string; summaryTokens: number }> {
    const convText = msgs
        .map(e => `[${e.message?.role?.toUpperCase() ?? "?"}]\n${extractText(e)}`)
        .join("\n\n---\n\n");

    const prevCtx = previousSummary
        ? `\n\nPrevious session summary for context:\n${previousSummary}`
        : "";

    const ctx: Context = {
        messages: [{
            role: "user",
            content: [{ type: "text", text: `${summaryPrompt}${prevCtx}\n\n${convText}` }],
            timestamp: Date.now(),
        }],
    };

    const res = await completeSimple(model, ctx, { apiKey: API_KEY, maxTokens: MAX_SUMMARY_TOK });
    const summary = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

    let summaryTokens: number;
    try { summaryTokens = await tokenize(MODEL_ID, summary, API_KEY); }
    catch { summaryTokens = Math.ceil(summary.length / 3.2); }

    return { summary, summaryTokens };
}

// --- Display helpers ---

function pct(n: number, total: number) { return `${((n / total) * 100).toFixed(1)}%`; }
function bar(n: number, total: number, w = 40) {
    const f = Math.min(Math.round((n / total) * w), w);
    return "[" + "█".repeat(f) + "░".repeat(w - f) + "]";
}
function tok(chars: number) { return Math.ceil(chars / 3.2); }

// --- Main ---

async function main() {
    const sessionPath = process.env.SESSION ?? findBiggestSession();
    console.log("=== Compaction Check ===");
    console.log(`Session:         ${sessionPath}`);
    console.log(`Model:           ${MODEL_ID}`);
    console.log(`Reported window: ${REPORTED_WINDOW} tokens  (×${SAFETY_FACTOR})`);
    console.log(`Max summary:     ${MAX_SUMMARY_TOK} tokens  (input budget: ~${Math.round(MAX_INPUT_CHARS / 1000)}k chars)`);
    console.log(`Safe budget:     ${SAFE_BUDGET} tokens  (40% of window — exceed this → immediate re-compact)`);
    console.log();

    const entries   = loadSession(sessionPath);
    const compacts  = entries.map((e, i) => ({ ...e, _idx: i })).filter(e => e.type === "compaction");

    if (compacts.length === 0) {
        console.log("No compaction events found in this session.");
        return;
    }

    let prevStoredSummary: string | null = null;

    for (let r = 0; r < compacts.length; r++) {
        const comp = compacts[r];
        const num  = r + 1;

        console.log(`─── Round ${num} ────────────────────────────────────────`);
        console.log(`Stored compaction: tokensBefore=${comp.tokensBefore?.toLocaleString()}, summary=${comp.summary?.length ?? 0} chars`);

        const msgs = sliceMessages(entries, comp._idx, MAX_INPUT_CHARS);
        const inputChars = msgs.reduce((s, e) => s + extractText(e).length, 0);
        const inputTok   = tok(inputChars);

        console.log(`Input slice:     ${msgs.length} msgs, ${inputChars.toLocaleString()} chars (~${inputTok} tokens, ${pct(inputTok, REPORTED_WINDOW)} of window)`);
        console.log(`                 ${bar(inputTok, REPORTED_WINDOW)}`);
        console.log(`  Calling API...`);

        const { summary, summaryTokens } = await compact(msgs, prevStoredSummary);
        const storedTokens = tok(comp.summary?.length ?? 0);

        console.log(`Our summary:     ${summary.length} chars → ${summaryTokens} tokens  (${pct(summaryTokens, REPORTED_WINDOW)} of window)`);
        console.log(`                 ${bar(summaryTokens, REPORTED_WINDOW)}`);
        console.log(`Stored summary:  ${comp.summary?.length ?? 0} chars → ~${storedTokens} tokens`);

        const pass = summaryTokens <= SAFE_BUDGET;
        console.log(`Budget check:    ${pass ? "✓ PASS" : "✗ FAIL"}  (budget: ${SAFE_BUDGET} tokens)`);
        if (!pass) {
            console.log(`  ⚠  Over by ${summaryTokens - SAFE_BUDGET} tokens. Post-compaction context will be ≥${summaryTokens + 3000} tokens,`);
            console.log(`     which is ${pct(summaryTokens + 3000, REPORTED_WINDOW)} of the window. Next compaction fires almost immediately.`);
        }
        console.log();

        // Use stored summary as context for next round (what pi actually passed)
        prevStoredSummary = comp.summary ?? null;
    }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
