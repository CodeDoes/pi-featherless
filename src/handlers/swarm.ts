import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
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
const STALL_TIMEOUT_MS = 20_000; // 20 seconds after stall detection
const MAX_FILE_SIZE = 500_000; // Split files larger than 500KB into chunks
const FILE_CHUNK_SIZE = 100_000; // Process files in 100KB chunks
const PROGRESS_CHECK_INTERVAL = 5_000; // Check for stalls every 5 seconds

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
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n\n");
}

function tickProgress(
    b: { progress: number },
    panel: SwarmPanel,
): ReturnType<typeof setInterval> {
    return setInterval(() => {
        if (b.progress < 90) {
            b.progress += 5;
            // Only render UI every 2nd progress update to reduce overhead
            if (b.progress % 10 === 0) {
                panel.requestRender();
            }
        }
    }, 300); // Increased from 200ms to 300ms
}

function logSwarmEvent(ctx: any, message: string, filePath?: string, data?: any) {
    try {
        if (ctx && ctx.log) {
            ctx.log(`[SWARM] ${message}${filePath ? ` (file: ${filePath})` : ''}${data ? ` - ${JSON.stringify(data)}` : ''}`);
        } else {
            console.log(`[SWARM] ${message}${filePath ? ` (file: ${filePath})` : ''}${data ? ` - ${JSON.stringify(data)}` : ''}`);
        }
    } catch (e) {
        console.error(`[SWARM_LOG_ERROR] ${e.message}`);
    }
}

function splitLargeFile(fileContent: string, filePath: string, chunkSize: number = FILE_CHUNK_SIZE): string[] {
    const chunks: string[] = [];

    // Try to split at logical boundaries (newlines, function boundaries, etc.)
    for (let i = 0; i < fileContent.length; i += chunkSize) {
        let end = i + chunkSize;

        // Find the nearest newline or logical break point
        if (end < fileContent.length) {
            const lastNewline = fileContent.lastIndexOf('\n', end);
            const lastSemicolon = fileContent.lastIndexOf(';', end);
            const lastBrace = fileContent.lastIndexOf('}', end);

            const breakPoints = [lastNewline, lastSemicolon, lastBrace].filter(pos => pos > i);
            if (breakPoints.length > 0) {
                end = Math.max(...breakPoints) + 1;
            }
        }

        const chunk = fileContent.slice(i, end);
        chunks.push(chunk);

        if (end >= fileContent.length) break;
    }

    logSwarmEvent(ctx, `Split large file into ${chunks.length} chunks`, filePath, {
        originalSize: fileContent.length,
        chunkSize: chunkSize,
        chunkCount: chunks.length
    });

    return chunks;
}

// ─── swarm_read (unified powerful version) ────────────────────────────────────

function registerSwarmRead(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm_read",
            label: "Swarm Read (PREFERRED)",
            description:
                "🚀 PRIMARY FILE TOOL: Your GO-TO tool for file operations! Uses parallel LLM analysis for superior results. " +
                "FLEXIBLE INPUT: Provide either a single question for all files OR specific instructions per file. " +
                "Automatically understands code context, extracts key insights, and provides intelligent analysis. " +
                "10x faster than basic read for most tasks. ONLY use 'read' when you need exact raw file content. " +
                "Examples: " +
                "1. Simple: {question: 'Find security issues', files: ['file1.py', 'file2.py']} " +
                "2. Advanced: {instructions: [['file1.py', 'Analyze architecture'], ['file2.py', 'Check for bugs']]}",
            parameters: Type.Union([
                // Simple mode: single question for all files
                Type.Object({
                    question: Type.String({
                        description:
                            "The question or task to answer about each file.",
                    }),
                    files: Type.Array(Type.String(), {
                        description: "List of file paths to analyze.",
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
                            description:
                                "Array of [filePath] or [filePath, instruction] pairs.",
                            minItems: 1,
                        },
                    ),
                }),
            ]),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);

                logSwarmEvent(ctx, "Starting swarm_read operation", undefined, {
                    mode: "question" in params ? "simple" : "advanced",
                    fileCount: "question" in params ? params.files.length : params.instructions.length
                });

                // Normalize parameters to common format
                let files: string[];
                let instructions: (string | undefined)[];

                if ("question" in params) {
                    // Simple mode
                    files = params.files;
                    instructions = files.map(() => params.question);
                    logSwarmEvent(ctx, "Using simple mode", undefined, {
                        question: params.question,
                        files: params.files
                    });
                } else {
                    // Advanced mode
                    files = params.instructions.map(
                        (pair: string[]) => pair[0],
                    );
                    instructions = params.instructions.map((pair: string[]) =>
                        pair.length > 1 ? pair[1] : undefined,
                    );
                    logSwarmEvent(ctx, "Using advanced mode", undefined, {
                        instructionCount: params.instructions.length,
                        filesWithCustomInstructions: params.instructions.filter((p: string[]) => p.length > 1).length
                    });
                }

                const results: string[] = new Array(files.length).fill("");
                const panel = new SwarmPanel(files.map(shortLabel));
                setWidget(ctx, panel);
                const run = semaphore(CONCURRENCY);
                const operationStartTime = Date.now();

                logSwarmEvent(ctx, "Initialized swarm processing", undefined, {
                    concurrency: CONCURRENCY,
                    maxFileSize: MAX_FILE_SIZE,
                    stallTimeout: STALL_TIMEOUT_MS
                });

                // Track progress for stall detection
                let lastProgressTime = Date.now();
                let lastProgressCount = 0;

                // Set up stall detection
                const stallCheck = setInterval(() => {
                    const now = Date.now();
                    if (now - lastProgressTime > STALL_TIMEOUT_MS) {
                        clearInterval(stallCheck);
                        throw new Error(`Swarm operation stalled - no progress for ${STALL_TIMEOUT_MS / 1000} seconds`);
                    }
                    if (panel.doneCount > lastProgressCount) {
                        lastProgressTime = now;
                        lastProgressCount = panel.doneCount;
                    }
                }, PROGRESS_CHECK_INTERVAL);

                try {
                    await Promise.all(
                        files.map((filePath, i) =>
                            run(async () => {
                                    const b = panel.bots[i];
                                    b.status = "working";
                                    b.progress = 5;
                                    panel.requestRender();

                                    const startTime = Date.now();
                                    let fileContent: string;
                                    let fileChunks: string[] = [];

                                    logSwarmEvent(ctx, "Starting file processing", filePath);

                                    // Check file size to determine if chunking is needed

                                    try {
                                        const stats = statSync(filePath);
                                        logSwarmEvent(ctx, "File size checked", filePath, {
                                            size: stats.size,
                                            chunkThreshold: MAX_FILE_SIZE
                                        });

                                        fileContent = readFileSync(filePath, "utf8");
                                        logSwarmEvent(ctx, "File read successfully", filePath, {
                                            charCount: fileContent.length,
                                            processingTime: Date.now() - startTime
                                        });

                                        // Split large files into chunks
                                        if (fileContent.length > MAX_FILE_SIZE) {
                                            fileChunks = splitLargeFile(fileContent, filePath);
                                            logSwarmEvent(ctx, "Large file split into chunks for processing", filePath, {
                                                originalSize: fileContent.length,
                                                chunkCount: fileChunks.length,
                                                chunkSize: FILE_CHUNK_SIZE
                                            });
                                        }
                                    } catch (readError) {
                                        const endTime = Date.now();
                                        b.status = "error";
                                        b.snippet = "file not found";
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
                                        results[i] = `[error: could not read ${filePath} (${endTime - startTime}ms)]`;
                                        logSwarmEvent(ctx, "File read failed", filePath, {
                                            error: readError.message,
                                            processingTime: endTime - startTime
                                        });
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
                                        logSwarmEvent(ctx, "No model/API key - returning raw content", filePath);
                                        return;
                                    }

                                    try {
                                        // Use file-specific instruction or fallback to a default
                                        const instruction =
                                            instructions[i] &&
                                            instructions[i].trim() !== ""
                                                ? instructions[i]
                                                : "Analyze this file and provide key insights";

                                        // Process chunks if file was split, otherwise process whole file
                                        if (fileChunks.length > 0) {
                                            logSwarmEvent(ctx, "Processing file in chunks", filePath, {
                                                chunkCount: fileChunks.length,
                                                instruction: instruction.substring(0, 50) + (instruction.length > 50 ? "..." : "")
                                            });

                                            const chunkResults: string[] = [];
                                            let overallProgress = 20;

                                            for (let chunkIndex = 0; chunkIndex < fileChunks.length; chunkIndex++) {
                                                const chunk = fileChunks[chunkIndex];
                                                const chunkPrompt = `File: ${filePath} (Part ${chunkIndex + 1} of ${fileChunks.length})\n\n\`\`\`\n${chunk.slice(0, MAX_FILE_CHARS)}\n\`\`\`\n\n${instruction}`;

                                                logSwarmEvent(ctx, "Processing chunk", filePath, {
                                                    chunk: chunkIndex + 1,
                                                    totalChunks: fileChunks.length,
                                                    chunkSize: chunk.length
                                                });

                                                b.snippet = `Chunk ${chunkIndex + 1}/${fileChunks.length}`;
                                                b.progress = overallProgress + Math.floor((chunkIndex / fileChunks.length) * 60);
                                                panel.requestRender();

                                                const ticker = tickProgress(b, panel);
                                                const chunkStartTime = Date.now();
                                                const chunkResult = await llmCall(
                                                    model,
                                                    apiKey,
                                                    chunkPrompt,
                                                    signal,
                                                );
                                                clearInterval(ticker);

                                                chunkResults.push(chunkResult);
                                                overallProgress = b.progress;

                                                logSwarmEvent(ctx, "Chunk processed", filePath, {
                                                    chunk: chunkIndex + 1,
                                                    processingTime: Date.now() - chunkStartTime,
                                                    responseLength: chunkResult.length
                                                });
                                            }

                                            // Combine chunk results
                                            const combinedResult = chunkResults.join("\n\n---\n\n");
                                            results[i] = combinedResult;
                                            b.snippet = combinedResult.slice(0, 50).replace(/\n/g, " ");

                                            const endTime = Date.now();
                                            logSwarmEvent(ctx, "All chunks processed - combining results", filePath, {
                                                totalChunks: fileChunks.length,
                                                totalProcessingTime: endTime - startTime,
                                                combinedResultLength: combinedResult.length
                                            });
                                        } else {
                                            // Process as single file (original logic)
                                            logSwarmEvent(ctx, "Sending to LLM for analysis", filePath, {
                                                instruction: instruction.substring(0, 50) + (instruction.length > 50 ? "..." : ""),
                                                contentLength: fileContent.length,
                                                truncatedTo: MAX_FILE_CHARS
                                            });

                                            const prompt = `File: ${filePath}\n\n\`\`\`\n${fileContent.slice(0, MAX_FILE_CHARS)}\n\`\`\`\n\n${instruction}`;
                                            const ticker = tickProgress(b, panel);
                                            const llmStartTime = Date.now();
                                            const text = await llmCall(
                                                model,
                                                apiKey,
                                                prompt,
                                                signal,
                                            );
                                            clearInterval(ticker);

                                            const endTime = Date.now();
                                            const llmProcessingTime = endTime - llmStartTime;
                                            results[i] = text;
                                            b.snippet = text
                                                .slice(0, 50)
                                                .replace(/\n/g, " ");
                                            b.status = "done";
                                            b.progress = 100;
                                            panel.doneCount++;
                                            panel.requestRender();

                                            logSwarmEvent(ctx, "LLM analysis completed", filePath, {
                                                responseLength: text.length,
                                                llmProcessingTime: llmProcessingTime,
                                                totalProcessingTime: endTime - startTime
                                            });
                                        }

                                        // Stream results more efficiently
                                        const streamResult = async (
                                            fullText: string,
                                        ) => {
                                            const chunkSize = 500; // Increased from 50 to 500
                                            const streamDelay = 10; // Reduced from 20ms to 10ms

                                            for (
                                                let j = 0;
                                                j < fullText.length;
                                                j += chunkSize
                                            ) {
                                                const chunk = fullText.slice(
                                                    0,
                                                    j + chunkSize,
                                                );
                                                b.snippet = chunk
                                                    .slice(0, 50)
                                                    .replace(/\n/g, " ");

                                                // Only render UI every 3 chunks to reduce overhead
                                                if (j % (chunkSize * 3) === 0) {
                                                    panel.requestRender();
                                                }

                                                onUpdate?.({
                                                    content: [
                                                        {
                                                            type: "text",
                                                            text: `### ${files[i]}\n${chunk}`,
                                                        },
                                                    ],
                                                    details: {
                                                        partial: true,
                                                        completed:
                                                            panel.doneCount,
                                                        total: files.length,
                                                        streaming: true,
                                                    },
                                                });

                                                await new Promise((resolve) =>
                                                    setTimeout(
                                                        resolve,
                                                        streamDelay,
                                                    ),
                                                );
                                            }

                                            // Final render to ensure UI is up to date
                                            panel.requestRender();
                                        };

                                        await streamResult(text);
                                    } catch (err: any) {
                                        b.status = "error";
                                        b.snippet = String(
                                            err?.message ?? err,
                                        ).slice(0, 40);
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
                                        results[i] =
                                            `[error: ${err?.message ?? err}]`;
                                        logSwarmEvent(ctx, "LLM processing failed", filePath, {
                                            error: err?.message ?? err,
                                            stack: err?.stack ? err.stack.substring(0, 200) : undefined
                                        });
                                    }
                                })
                            ),
                        ),
                    );
                } catch (error) {
                    clearInterval(stallCheck);
                    if (
                        error instanceof Error &&
                        error.message.includes("stalled")
                    ) {
                        throw new Error(
                            `Swarm operation stalled after ${STALL_TIMEOUT_MS / 1000} seconds without progress. This might indicate performance issues or files that are too large.`,
                        );
                    }
                    throw error;
                } finally {
                    clearInterval(stallCheck);
                    clearWidget(ctx);
                }

                return {
                    content: [
                        {
                            type: "text",
                            text:
                                results
                                    .map(
                                        (result, i) =>
                                            `### ${files[i]}\n${result}`,
                                    )
                                    .join("\n\n---\n\n") +
                                `\n\n## Performance Summary\n- Total files: ${files.length}\n- Successful: ${results.filter((r) => !r.startsWith("[error:") && !r.startsWith("[skipped:")).length}\n- Skipped (too large): ${results.filter((r) => r.startsWith("[skipped:")).length}\n- Failed: ${results.filter((r) => r.startsWith("[error:")).length}`,
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

                // Wrap the entire operation with timeout
                try {
                    await withTimeout(
                        Promise.all(
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
                                        writeFileSync(
                                            task.file,
                                            content,
                                            "utf8",
                                        );

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
                                            details: {
                                                partial: true,
                                                written,
                                                errors,
                                            },
                                        });
                                    } catch (err: any) {
                                        b.status = "error";
                                        b.snippet = String(
                                            err?.message ?? err,
                                        ).slice(0, 40);
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
                                        errors.push(task.file);
                                    }
                                }),
                            ),
                        ),
                        SWARM_TIMEOUT_MS,
                        `Swarm write operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds`,
                    );
                } catch (error) {
                    // Handle timeout errors
                    if (
                        error instanceof Error &&
                        error.message.includes("timed out")
                    ) {
                        throw new Error(
                            `Swarm operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds. This might indicate performance issues or files that are too large.`,
                        );
                    }
                    // Re-throw other errors
                    throw error;
                } finally {
                    clearWidget(ctx);
                }

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

                // Wrap the entire operation with timeout
                try {
                    await withTimeout(
                        Promise.all(
                            tasks.map((task, i) =>
                                run(async () => {
                                    const b = panel.bots[i];
                                    b.status = "working";
                                    b.progress = 5;
                                    panel.requestRender();

                                    let original: string;
                                    try {
                                        original = readFileSync(
                                            task.file,
                                            "utf8",
                                        );
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
                                        writeFileSync(
                                            task.file,
                                            content,
                                            "utf8",
                                        );

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
                                            details: {
                                                partial: true,
                                                edited,
                                                errors,
                                            },
                                        });
                                    } catch (err: any) {
                                        b.status = "error";
                                        b.snippet = String(
                                            err?.message ?? err,
                                        ).slice(0, 40);
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
                                        errors.push(task.file);
                                    }
                                }),
                            ),
                        ),
                        SWARM_TIMEOUT_MS,
                        `Swarm edit operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds`,
                    );
                } catch (error) {
                    // Handle timeout errors
                    if (
                        error instanceof Error &&
                        error.message.includes("timed out")
                    ) {
                        throw new Error(
                            `Swarm operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds. This might indicate performance issues or files that are too large.`,
                        );
                    }
                    // Re-throw other errors
                    throw error;
                } finally {
                    clearWidget(ctx);
                }

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
