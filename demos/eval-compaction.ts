/**
 * Advanced Compaction Strategy Evaluator
 *
 * Tests different chunking strategies and multiple models to find the optimal
 * balance between speed and quality for Featherless AI.
 * Logs full results to markdown files for inspection.
 *
 * Run:
 *   npx tsx demos/eval-compaction.ts [session_path]
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { completeSimple, type Model, type Context } from "@mariozechner/pi-ai";
import {
    serializeConversation,
    convertToLlm,
} from "@mariozechner/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Environment Setup ---
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
if (!API_KEY) {
    console.error("FEATHERLESS_API_KEY not set");
    process.exit(1);
}

const BASE_URL = "https://api.featherless.ai/v1";

const TEST_MODELS = [
    "Qwen/Qwen2.5-3B-Instruct",
    "Qwen/Qwen2.5-Coder-7B-Instruct",
];

const CHUNK_SIZE_CHARS = 15000;

// --- Utilities ---

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.2);
}

function stripToMetadata(messages: any[]): any[] {
    return messages.map((m) => {
        if (m.role === "assistant") {
            if (typeof m.content === "string") {
                return m.content.length > 500
                    ? {
                          ...m,
                          content:
                              m.content.substring(0, 400) + "... [truncated]",
                      }
                    : m;
            }
            if (Array.isArray(m.content)) {
                return {
                    ...m,
                    content: m.content
                        .map((c: any) => {
                            if (c.type === "thinking") return null;
                            if (c.type === "text" && c.text.length > 800) {
                                return {
                                    ...c,
                                    text:
                                        c.text.substring(0, 400) +
                                        "... [text truncated]",
                                };
                            }
                            if (c.type === "toolCall") {
                                const verbose = [
                                    "read",
                                    "write",
                                    "ls",
                                    "grep",
                                    "find",
                                    "bash",
                                    "edit_file",
                                    "read_file",
                                    "list_directory",
                                ];
                                if (verbose.includes(c.name)) {
                                    return {
                                        ...c,
                                        arguments: {
                                            summary: `[${c.name} call stripped]`,
                                        },
                                    };
                                }
                            }
                            return c;
                        })
                        .filter(Boolean),
                };
            }
        }

        if (m.role === "toolResult") {
            const verbose = [
                "read",
                "write",
                "ls",
                "grep",
                "find",
                "bash",
                "edit_file",
                "read_file",
                "list_directory",
            ];
            if (verbose.includes(m.toolName)) {
                return {
                    ...m,
                    content: [
                        {
                            type: "text",
                            text: `[${m.toolName} output stripped]`,
                        },
                    ],
                };
            }
        }

        if (
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.length > 1500
        ) {
            return {
                ...m,
                content:
                    m.content.substring(0, 800) + "... [user prompt truncated]",
            };
        }

        return m;
    });
}

async function runStrategy(modelId: string, messages: any[]) {
    const startTime = Date.now();
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentSize = 0;
    let inputTokens = 0;

    for (const msg of messages) {
        const msgSize = JSON.stringify(msg).length;
        if (
            currentSize + msgSize > CHUNK_SIZE_CHARS &&
            currentChunk.length > 0
        ) {
            chunks.push(currentChunk);
            inputTokens += estimateTokens(serializeConversation(currentChunk));
            currentChunk = [];
            currentSize = 0;
        }
        currentChunk.push(msg);
        currentSize += msgSize;
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        inputTokens += estimateTokens(serializeConversation(currentChunk));
    }

    const numChunks = chunks.length;

    const testModel: Model<any> = {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: "featherless-ai",
        baseUrl: BASE_URL,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 32768,
    };

    console.log(`  > Testing ${modelId} with ${numChunks} chunks...`);

    // Parallel Summaries
    const p1 = Date.now();
    const subPromises = chunks.map((chunk, idx) => {
        const text = serializeConversation(chunk);
        const ctx: Context = {
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Summarize technical segment briefly: ${text}`,
                        },
                    ],
                    timestamp: Date.now() + idx,
                },
            ],
        };
        return completeSimple(testModel, ctx, {
            apiKey: API_KEY,
            maxTokens: 1024,
        }).catch((e) => {
            console.error(`    ! Segment ${idx + 1} failed:`, e.message);
            return {
                content: [{ type: "text", text: `[Error: ${e.message}]` }],
            };
        });
    });

    const subResults = await Promise.all(subPromises);
    const p2 = Date.now();

    // Join summaries directly
    const finalText = subResults
        .map((r: any, i) => {
            const text =
                r.content?.find((c: any) => c.type === "text")?.text ||
                "[No Text]";
            return `### Activity Segment ${i + 1}\n${text}`;
        })
        .join("\n\n");

    const logDir = join(
        __dirname,
        "compaction-logs",
        modelId.replace(/\//g, "_"),
    );
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `summary-${numChunks}-chunks.md`);
    writeFileSync(logPath, finalText, "utf8");

    return {
        modelId,
        numChunks,
        parallelTime: p2 - p1,
        totalTime: Date.now() - startTime,
        summaryLength: finalText.length,
        inputTokens,
        outputTokens: estimateTokens(finalText),
        logPath,
    };
}

async function main() {
    const sessionPath =
        process.argv[2] ||
        "/home/kit/.pi/agent/sessions/--home-kit-dev-AutoOps--/2026-04-07T14-59-05-177Z_0e74d8c9-ca93-4220-b67a-ecb31cf5ad85.jsonl";

    if (!existsSync(sessionPath)) {
        console.error("Session not found:", sessionPath);
        process.exit(1);
    }

    console.log(`=== Compaction Model & Strategy Evaluation ===`);
    console.log(`Target: ${sessionPath}\n`);

    const entries = readFileSync(sessionPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    const messages = entries
        .filter((e) => e.type === "message")
        .map((e) => e.message);
    const filtered = stripToMetadata(convertToLlm(messages));

    console.log(
        `Messages: ${messages.length} -> Filtered Size: ${Math.round(JSON.stringify(filtered).length / 1024)} KB\n`,
    );

    const results = [];

    for (const modelId of TEST_MODELS) {
        try {
            const res = await runStrategy(modelId, filtered);
            results.push(res);
        } catch (e: any) {
            console.error(`  ! Failed: ${modelId} : ${e.message}`);
        }
    }

    console.log("\n=== Results Table ===");
    console.log(
        "Model".padEnd(45) +
            " | Chunks | Total (ms) | Chars | In Tokens | Out Tokens",
    );
    console.log("-".repeat(110));
    for (const r of results) {
        console.log(
            `${r.modelId.padEnd(45)} | ${r.numChunks.toString().padEnd(6)} | ${r.totalTime.toString().padEnd(10)} | ${r.summaryLength.toString().padEnd(5)} | ${r.inputTokens.toString().padEnd(9)} | ${r.outputTokens}`,
        );
    }
}

main().catch(console.error);
