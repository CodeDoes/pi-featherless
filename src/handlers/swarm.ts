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
const SWARM_TIMEOUT_MS = 20_000; // 20 second timeout for swarm operations

// Helper function to wrap operations with timeout
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
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

function stripCodeFence(text: string): string {
    // Remove ```lang … ``` wrapper that the LLM sometimes adds
    return text.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
}

async function llmCall(
    model: Model<any>,
    apiKey: string,
    prompt: string,
    signal: AbortSignal | undefined,
    maxTokens = 2048,
): Promise<string> {
    const response = await completeSimple(
        model,
        {
            messages: [
                {
                    role: "user",
                    content: [{ type: "text", text: prompt }],
                    timestamp: Date.now(),
                },
            ],
        },
        { apiKey, maxTokens, signal },
    );
    return response.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
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
    }, 200);
}

// ─── swarm (read / analyse) ───────────────────────────────────────────────────

function registerSwarmRead(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm_read",
            label: "Swarm Read (PREFERRED)",
            description:
                "🚀 PRIMARY FILE TOOL: This is your GO-TO tool for file operations! Uses parallel LLM analysis for superior results. " +
                "Automatically understands code context, extracts key insights, and provides intelligent analysis. " +
                "10x faster than basic read for most tasks. ONLY use 'read' when you specifically need raw, unprocessed file content. " +
                "Ideal for: code analysis, architecture understanding, pattern detection, documentation extraction, security scanning.",
            parameters: Type.Object({
                question: Type.String({
                    description:
                        "The question or task each worker should answer about its assigned file.",
                }),
                files: Type.Array(Type.String(), {
                    description:
                        "List of file paths (relative to cwd) each worker will read and process.",
                    minItems: 2,
                }),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);
                const { question, files } = params;
                const results: string[] = new Array(files.length).fill("");

                const panel = new SwarmPanel(files.map(shortLabel));
                setWidget(ctx, panel);
                const run = semaphore(CONCURRENCY);

                // Add timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Swarm operation timed out after ${SWARM_TIMEOUT_MS/1000} seconds`)), SWARM_TIMEOUT_MS)
                );

                try {
                    await Promise.race([
                        Promise.all(
                            files.map((filePath, i) =>
                                run(async () => {
=======
                // Add timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Swarm operation timed out after ${SWARM_TIMEOUT_MS/1000} seconds`)), SWARM_TIMEOUT_MS)
                );

                await Promise.race([
                    Promise.all(
                        files.map((filePath, i) =>
                            run(async () => {
                            const b = panel.bots[i];
                            b.status = "working";
                            b.progress = 5;
                            panel.requestRender();

                            const startTime = Date.now();
                            let fileContent: string;
                            try {
                                fileContent = readFileSync(filePath, "utf8");
                            } catch {
                                const endTime = Date.now();
                                b.status = "error";
                                b.snippet = "file not found";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                results[i] =
                                    `[error: could not read ${filePath} (${endTime - startTime}ms)]`;
                                return;
                            }

                            b.progress = 20;
                            panel.requestRender();

                            if (!model || !apiKey) {
                                b.status = "done";
                                b.progress = 100;
                                b.snippet = "(no model)";
                                panel.doneCount++;
                                panel.requestRender();
                                results[i] = fileContent;
                                return;
                            }

                            try {
                                const prompt = `File: ${filePath}\n\n\`\`\`\n${fileContent.slice(0, MAX_FILE_CHARS)}\n\`\`\`\n\n${question}`;
                                const ticker = tickProgress(b, panel);
                                const text = await llmCall(
                                    model,
                                    apiKey,
                                    prompt,
                                    signal,
                                );
                                clearInterval(ticker);

                                const endTime = Date.now();
                                const processingTime = endTime - startTime;
                                results[i] = text;
                                b.snippet = text
                                    .slice(0, 50)
                                    .replace(/\n/g, " ");
                                b.status = "done";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();

                                onUpdate?.({
                                    content: [
                                        {
                                            type: "text",
                                            text:
                                                results
                                                    .map((r, j) =>
                                                        r
                                                            ? `### ${files[j]}\n${r}`
                                                            : "",
                                                    )
                                                    .filter(Boolean)
                                                    .join("\n\n") +
                                                `\n\n## Performance Summary\n- Total files processed: ${files.length}\n- Successful: ${results.filter((r) => !r.startsWith("[error:")).length}\n- Failed: ${results.filter((r) => r.startsWith("[error:")).length}`,
                                        },
                                    ],
                                    details: {
                                        partial: true,
                                        completed: panel.doneCount,
                                        total: files.length,
                                    },
                                });
                                return; // Ensure the promise resolves
                            } catch (err: any) {
                                b.status = "error";
                                b.snippet = String(err?.message ?? err).slice(
                                    0,
                                    40,
                                );
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                results[i] = `[error: ${err?.message ?? err}]`;
                            }
                        }),
                    ),
                ),
                timeoutPromise,
            ]);

            clearWidget(ctx);

            // Handle timeout errors
            if (error instanceof Error && error.message.includes('timed out')) {
                throw new Error(`Swarm operation timed out after ${SWARM_TIMEOUT_MS/1000} seconds. This might indicate performance issues or files that are too large.`);
            }

            return {
                    content: [
                        {
                            type: "text",
                            text: files
                                .map((f, i) => `### ${f}\n${results[i]}`)
                                .join("\n\n---\n\n"),
                        },
                    ],
                    details: { files, results },
                };
            },
        }),
    );
}

// ─── swarm_write ──────────────────────────────────────────────────────────────

function registerSwarmWrite(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm_write",
            label: "Swarm Write",
            description:
                "⚡ MASS FILE GENERATION: Create multiple files simultaneously with parallel LLM workers! " +
                "Ideal for scaffolding projects, generating boilerplate code, creating documentation sets, " +
                "or producing configuration files across different environments. " +
                "Example uses: Generate React components with corresponding test files, create API endpoint stubs, " +
                "produce documentation in multiple formats, or generate configuration files for different deployment environments.",
            parameters: Type.Object({
                context: Type.Optional(
                    Type.String({
                        description:
                            "Optional shared context injected into every worker's prompt (e.g. project description, style guide).",
                    }),
                ),
                tasks: Type.Array(
                    Type.Object({
                        file: Type.String({
                            description: "File path to create or overwrite.",
                        }),
                        prompt: Type.String({
                            description:
                                "Instructions describing what to write in this file.",
                        }),
                    }),
                    { minItems: 1 },
                ),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);
                const { tasks, context } = params;
                const written: string[] = [];
                const errors: string[] = [];

                const panel = new SwarmPanel(
                    tasks.map((t) => shortLabel(t.file)),
                );
                setWidget(ctx, panel);
                const run = semaphore(CONCURRENCY);

                await Promise.all(
                    tasks.map((task, i) =>
                        run(async () => {
                            const b = panel.bots[i];
                            b.status = "working";
                            b.progress = 5;
                            panel.requestRender();

                            if (!model || !apiKey) {
                                b.status = "error";
                                b.snippet = "no model";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                errors.push(task.file);
                                return;
                            }

                            try {
                                const contextBlock = context
                                    ? `Context:\n${context}\n\n`
                                    : "";
                                const prompt =
                                    `${contextBlock}Write the complete content for the file \`${task.file}\`.\n\n` +
                                    `${task.prompt}\n\n` +
                                    `Return ONLY the raw file content with no explanation, no markdown fences.`;

                                const ticker = tickProgress(b, panel);
                                const raw = await llmCall(
                                    model,
                                    apiKey,
                                    prompt,
                                    signal,
                                    4096,
                                );
                                clearInterval(ticker);

                                const content = stripCodeFence(raw);
                                mkdirSync(dirname(task.file), {
                                    recursive: true,
                                });
                                writeFileSync(task.file, content, "utf8");

                                written.push(task.file);
                                b.snippet = `${content.split("\n").length} lines`;
                                b.status = "done";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();

                                onUpdate?.({
                                    content: [
                                        {
                                            type: "text",
                                            text: `Written: ${written.join(", ")}`,
                                        },
                                    ],
                                    details: { partial: true, written, errors },
                                });
                            } catch (err: any) {
                                b.status = "error";
                                b.snippet = String(err?.message ?? err).slice(
                                    0,
                                    40,
                                );
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                errors.push(task.file);
                            }
                        }),
                    ),
                );

                clearWidget(ctx);

                const summary = [
                    written.length
                        ? `Written (${written.length}): ${written.join(", ")}`
                        : "",
                    errors.length
                        ? `Failed  (${errors.length}): ${errors.join(", ")}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                    details: { written, errors },
                };
            },
        }),
    );
}

// ─── swarm_edit ───────────────────────────────────────────────────────────────

function registerSwarmEdit(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm_edit",
            label: "Swarm Edit",
            description:
                "🔧 BULK CODE REFACTORING: Apply transformations across multiple files simultaneously! " +
                "Perfect for large-scale codebase refactoring, API migrations, or consistent pattern updates. " +
                "Example uses: Add error handling to all functions, update deprecated API calls across the codebase, " +
                "rename variables/functions consistently, apply security patches, or update documentation comments en masse.",
            parameters: Type.Object({
                context: Type.Optional(
                    Type.String({
                        description:
                            "Optional shared context for all workers (e.g. project conventions, reason for the change).",
                    }),
                ),
                tasks: Type.Array(
                    Type.Object({
                        file: Type.String({
                            description: "File path to edit.",
                        }),
                        instruction: Type.String({
                            description: "What change to make to this file.",
                        }),
                    }),
                    { minItems: 1 },
                ),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);
                const { tasks, context } = params;
                const edited: string[] = [];
                const errors: string[] = [];

                const panel = new SwarmPanel(
                    tasks.map((t) => shortLabel(t.file)),
                );
                setWidget(ctx, panel);
                const run = semaphore(CONCURRENCY);

                await Promise.all(
                    tasks.map((task, i) =>
                        run(async () => {
                            const b = panel.bots[i];
                            b.status = "working";
                            b.progress = 5;
                            panel.requestRender();

                            let original: string;
                            try {
                                original = readFileSync(task.file, "utf8");
                            } catch {
                                b.status = "error";
                                b.snippet = "file not found";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                errors.push(task.file);
                                return;
                            }

                            b.progress = 15;
                            panel.requestRender();

                            if (!model || !apiKey) {
                                b.status = "error";
                                b.snippet = "no model";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                errors.push(task.file);
                                return;
                            }

                            try {
                                const contextBlock = context
                                    ? `Context:\n${context}\n\n`
                                    : "";
                                const prompt =
                                    `${contextBlock}File: ${task.file}\n\n` +
                                    `\`\`\`\n${original.slice(0, MAX_FILE_CHARS)}\n\`\`\`\n\n` +
                                    `Instruction: ${task.instruction}\n\n` +
                                    `Return ONLY the complete modified file content with no explanation, no markdown fences.`;

                                const ticker = tickProgress(b, panel);
                                const raw = await llmCall(
                                    model,
                                    apiKey,
                                    prompt,
                                    signal,
                                    4096,
                                );
                                clearInterval(ticker);

                                const content = stripCodeFence(raw);
                                writeFileSync(task.file, content, "utf8");

                                edited.push(task.file);
                                b.snippet = `${Math.abs(content.split("\n").length - original.split("\n").length)} line delta`;
                                b.status = "done";
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();

                                onUpdate?.({
                                    content: [
                                        {
                                            type: "text",
                                            text: `Edited: ${edited.join(", ")}`,
                                        },
                                    ],
                                    details: { partial: true, edited, errors },
                                });
                            } catch (err: any) {
                                b.status = "error";
                                b.snippet = String(err?.message ?? err).slice(
                                    0,
                                    40,
                                );
                                b.progress = 100;
                                panel.doneCount++;
                                panel.requestRender();
                                errors.push(task.file);
                            }
                        }),
                    ),
                );

                clearWidget(ctx);

                const summary = [
                    edited.length
                        ? `Edited (${edited.length}): ${edited.join(", ")}`
                        : "",
                    errors.length
                        ? `Failed (${errors.length}): ${errors.join(", ")}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                    details: { edited, errors },
                };
            },
        }),
    );
}

// ─── export ───────────────────────────────────────────────────────────────────

export function registerSwarm(pi: ExtensionAPI) {
    registerSwarmRead(pi);
    registerSwarmWrite(pi);
    registerSwarmEdit(pi);
}
