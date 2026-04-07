/**
 * High-performance compaction speed check demo.
 *
 * This demo replays the compaction logic on a real session file and measures
 * the performance of the new "Aggressive Stripping" and "Parallel" strategy.
 *
 * Run:
 *   npx tsx demos/check-compaction.ts
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { completeSimple, type Model, type Context } from "@mariozechner/pi-ai";
import {
    serializeConversation,
    convertToLlm,
} from "@mariozechner/pi-coding-agent";

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
if (!API_KEY) {
    console.error("FEATHERLESS_API_KEY not set");
    process.exit(1);
}

// --- Config ---
const TARGET_SESSION =
    "/home/kit/.pi/agent/sessions/--home-kit-dev-AutoOps--/2026-04-07T14-59-05-177Z_0e74d8c9-ca93-4220-b67a-ecb31cf5ad85.jsonl";
const FAST_MODEL_ID = "zai-org/GLM-4.7-Flash";
const BASE_URL = "https://api.featherless.ai/v1";

const subModel: Model<any> = {
    id: FAST_MODEL_ID,
    name: FAST_MODEL_ID,
    api: "openai-completions",
    provider: "featherless-ai",
    baseUrl: BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 32768,
};

const SUB_SUMMARY_PROMPT = `Summarize this technical conversation segment.
FOCUS: Exact file paths touched, logic changes, errors/resolutions.
STRIP: ALL raw tool output (file contents, listings).`;

const FINAL_MERGE_PROMPT = `Merge these 2 segment summaries into one HIGH-FIDELITY technical summary.
RULES: Preserve exact file paths/errors. List active files. Record SUCCESS/FAILURE.
\${summariesText}`;

// --- Logic ---

function stripToMetadata(messages: any[]): any[] {
    return messages.map((m) => {
        if (m.role === "assistant" && Array.isArray(m.content)) {
            return {
                ...m,
                content: m.content
                    .map((c: any) => {
                        if (c.type === "thinking") return null;
                        if (c.type === "toolCall") {
                            const verboseTools = [
                                "read",
                                "write",
                                "ls",
                                "grep",
                                "find",
                                "bash",
                            ];
                            if (verboseTools.includes(c.name)) {
                                return {
                                    ...c,
                                    arguments: {
                                        summary: `[Called ${c.name} on ${c.arguments?.path || c.arguments?.command || "target"}]`,
                                    },
                                };
                            }
                        }
                        return c;
                    })
                    .filter(Boolean),
            };
        }
        if (m.role === "toolResult") {
            const verboseTools = [
                "read",
                "write",
                "ls",
                "grep",
                "find",
                "bash",
            ];
            if (verboseTools.includes(m.toolName)) {
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
        return m;
    });
}

function extractResponseText(response: any): string {
    return response.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
}

async function main() {
    console.log("=== High-Performance Compaction Speed Check ===");
    console.log(`Session: ${TARGET_SESSION}`);

    if (!existsSync(TARGET_SESSION)) {
        console.error("Session file not found!");
        return;
    }

    const entries = readFileSync(TARGET_SESSION, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));

    const messages = entries
        .filter((e) => e.type === "message")
        .map((e) => e.message);
    console.log(`Total Messages: ${messages.length}`);

    const startTime = Date.now();

    // 1. Strip
    console.log("1. Stripping verbose content...");
    const filtered = stripToMetadata(convertToLlm(messages));
    const stripTime = Date.now();

    console.log(`Filtered Messages: ${filtered.length}`);
    const totalChars = JSON.stringify(filtered).length;
    console.log(`Estimated Filtered Size: ${Math.round(totalChars / 1024)} KB`);

    // 2. Parallel Summarize
    console.log("2. Parallel summarizing (2 chunks)...");
    const chunkSize = Math.ceil(filtered.length / 2);
    const chunks = [];
    for (let i = 0; i < filtered.length; i += chunkSize) {
        chunks.push(filtered.slice(i, i + chunkSize));
    }

    const subSummaryPromises = chunks.map((chunk, idx) => {
        const segmentText = serializeConversation(chunk);
        const ctx: Context = {
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `${SUB_SUMMARY_PROMPT}\n\n${segmentText}`,
                        },
                    ],
                    timestamp: Date.now() + idx,
                },
            ],
        };
        return completeSimple(subModel, ctx, {
            apiKey: API_KEY,
            maxTokens: 1024,
        });
    });

    const results = await Promise.all(subSummaryPromises);
    const summariesText = results
        .map((res, i) => `### Segment ${i + 1}\n${extractResponseText(res)}`)
        .join("\n\n");
    const parallelTime = Date.now();

    // 3. Final Merge
    console.log("3. Merging summaries...");
    const mergeCtx: Context = {
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: FINAL_MERGE_PROMPT.replace(
                            "${summariesText}",
                            summariesText,
                        ),
                    },
                ],
                timestamp: Date.now(),
            },
        ],
    };
    const finalRes = await completeSimple(subModel, mergeCtx, {
        apiKey: API_KEY,
        maxTokens: 2048,
    });
    const finalOutput = extractResponseText(finalRes);
    const finalTime = Date.now();

    console.log("\n=== Results ===");
    console.log(`Stripping:   ${stripTime - startTime}ms`);
    console.log(`Parallel:    ${parallelTime - stripTime}ms`);
    console.log(`Final Merge: ${finalTime - parallelTime}ms`);
    console.log(`Total Time:  ${finalTime - startTime}ms`);
    console.log("\n--- Summary Preview ---");
    console.log(finalOutput.substring(0, 500) + "...");
}

main().catch(console.error);
