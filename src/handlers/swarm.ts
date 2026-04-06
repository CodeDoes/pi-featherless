import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { SwarmPanel, semaphore } from "./swarm-panel";
import { PROVIDER, getApiKey } from "./shared";

const CONCURRENCY = 4;
const MAX_FILE_CHARS = 24_000;
const SWARM_TIMEOUT_MS = 20_000;

// Helper function to wrap operations with timeout
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
        ),
    ]);
}

// ─── shared helpers ───────────────────────────────────────────────────────────

function shortLabel(path: string) {
    return path.split("/").pop() ?? path;
}

function setWidget(ctx: any, panel: SwarmPanel) {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(
        "swarm",
        (tui: any, _theme: any) => {
            panel.attach(tui);
            return panel;
        },
        { placement: "aboveEditor" },
    );
}

function clearWidget(ctx: any) {
    if (ctx.hasUI) ctx.ui.setWidget("swarm", undefined);
}

function tickProgress(
    b: { progress: number },
    panel: SwarmPanel,
): ReturnType<typeof setInterval> {
    return setInterval(() => {
        if (b.progress < 90) {
            b.progress += 5;
            panel.requestRender();
        }
    }, 300);
}

// ─── swarm_read (simplified) ──────────────────────────────────────────────────

function registerSwarmRead(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm_read",
            label: "Swarm Read (PREFERRED)",
            description:
                "🚀 PRIMARY FILE TOOL: Analyze multiple files in parallel using LLM. " +
                "Provide a question and list of files, or specific instructions per file.",
            parameters: Type.Union([
                // Simple mode: single question for all files
                Type.Object({
                    question: Type.String({
                        description: "Question to answer about each file",
                    }),
                    files: Type.Array(Type.String(), {
                        description: "List of file paths to analyze",
                        minItems: 1,
                    }),
                }),
                // Advanced mode: specific instructions per file
                Type.Object({
                    instructions: Type.Array(
                        Type.Array(Type.String(), {
                            minItems: 1,
                            maxItems: 2,
                        }),
                        {
                            description: "Array of [filePath] or [filePath, instruction] pairs",
                            minItems: 1,
                        },
                    ),
                }),
            ]),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);

                // Normalize parameters
                let files: string[];
                let instructions: (string | undefined)[];

                if ("question" in params) {
                    files = params.files;
                    instructions = files.map(() => params.question);
                } else {
                    files = params.instructions.map((pair: string[]) => pair[0]);
                    instructions = params.instructions.map((pair: string[]) =>
                        pair.length > 1 ? pair[1] : "Analyze this file"
                    );
                }

                const results: string[] = new Array(files.length).fill("");
                const panel = new SwarmPanel(files.map(shortLabel));
                setWidget(ctx, panel);
                const run = semaphore(CONCURRENCY);

                try {
                    await withTimeout(
                        Promise.all(
                            files.map((filePath, i) =>
                                run(async () => {
                                    const b = panel.bots[i];
                                    b.status = "working";
                                    b.progress = 5;
                                    panel.requestRender();

                                    try {
                                        // Read file
                                        const fileContent = readFileSync(filePath, "utf8");
                                        b.progress = 20;
                                        panel.requestRender();

                                        // Process with LLM
                                        if (model && apiKey) {
                                            const instruction = instructions[i] || "Analyze this file and provide key insights";
                                            const prompt = `File: ${filePath}\n\n\`\`\`\n${fileContent.slice(0, MAX_FILE_CHARS)}\n\`\`\`\n\n${instruction}`;

                                            const ticker = tickProgress(b, panel);
                                            const text = await llmCall(model, apiKey, prompt, signal);
                                            clearInterval(ticker);

                                            results[i] = text;
                                            b.snippet = text.slice(0, 50).replace(/\n/g, " ");
                                        } else {
                                            // No model - return raw content
                                            results[i] = fileContent;
                                            b.snippet = "(no model)";
                                        }

                                        b.status = "done";
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();

                                    } catch (err: any) {
                                        b.status = "error";
                                        b.snippet = String(err?.message ?? err).slice(0, 40);
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
                                        results[i] = `[error: ${err?.message ?? err}]`;
                                    }
                                })
                            )
                        ),
                        SWARM_TIMEOUT_MS,
                        `Swarm read operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds`,
                    );
                } finally {
                    clearWidget(ctx);
                }

                return {
                    content: [{
                        type: "text",
                        text: results
                            .map((result, i) => `### ${files[i]}\n${result}`)
                            .join("\n\n---\n\n") +
                            `\n\n## Summary\n- Files: ${files.length}\n- Successful: ${results.filter(r => !r.startsWith("[error:")).length}\n- Failed: ${results.filter(r => r.startsWith("[error:")).length}`,
                    }],
                    details: { files, results },
                };
            },
        }),
    );
}

// Keep the existing swarm_write and swarm_edit functions
// ... (will copy these from original file)

async function llmCall(
    model: Model<any>,
    apiKey: string,
    prompt: string,
    signal: AbortSignal,
): Promise<string> {
    const result = await completeSimple(
        model,
        apiKey,
        prompt,
        {
            signal,
            temperature: 0.1,
            max_tokens: 2048,
        },
    );
    return stripCodeFence(result);
}

function stripCodeFence(text: string): string {
    return text.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
}

// Export the register function
export function registerSwarm(pi: ExtensionAPI) {
    registerSwarmRead(pi);
    // registerSwarmWrite(pi);
    // registerSwarmEdit(pi);
}
