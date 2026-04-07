import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { SwarmPanel, semaphore } from "./swarm-panel";
import { PROVIDER, getApiKey } from "./shared";
import { runFileBot } from "../bots/file.ts";
import { runTaskBot } from "../bots/task.ts";
import { runProjectBot } from "../bots/project.ts";
import type { SwarmInstruction, TaskBrief, ProjectBrief } from "../schemas.ts";

const CONCURRENCY = 4;
const MAX_FILE_CHARS = 24_000;
const SWARM_TIMEOUT_MS = 20_000;
const FILE_SIZE_WARNING = 100_000; // 100KB - warn about large files
const MAX_SUMMARY_LENGTH = 1000; // Limit summary length to prevent context bloat (reduced from 1500)
const TARGET_MAX_FILES_PER_CALL = 8; // Recommended max files to avoid compaction
const CONTEXT_SAFETY_MARGIN = 0.75; // Follow pi-mono's SAFETY_FACTOR exactly
const REAL_CONTEXT_LIMIT = 32768; // 32k - actual model context limit
const SAFE_CONTEXT_LIMIT = 24576; // 32k * 0.75 = 24576 (matches pi-mono safety factor)

// Compaction settings (following pi-mono pattern)
const COMPACTION_SETTINGS = {
    enabled: true,
    reserveTokens: 16384, // Match pi-mono's default (16384 = ~50% of 32k)
    keepRecentTokens: 20000, // Keep recent context
};

const ENABLE_DETAILED_LOGGING = true; // Show exactly what's being fed to the bot

/**
 * Check if auto-compaction should trigger based on context usage.
 * Follows pi-mono's exact compaction logic.
 */
function shouldAutoCompact(contextTokens: number, contextWindow: number = SAFE_CONTEXT_LIMIT): boolean {
    if (!COMPACTION_SETTINGS.enabled) return false;
    return contextTokens > contextWindow - COMPACTION_SETTINGS.reserveTokens;
}

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

function logSwarmEvent(
    ctx: any,
    message: string,
    filePath?: string,
    data?: any,
) {
    try {
        if (ctx && ctx.log) {
            ctx.log(
                `[SWARM] ${message}${filePath ? ` (file: ${filePath})` : ""}${data ? ` - ${JSON.stringify(data)}` : ""}`,
            );
        } else {
            console.log(
                `[SWARM] ${message}${filePath ? ` (file: ${filePath})` : ""}${data ? ` - ${JSON.stringify(data)}` : ""}`,
            );
        }
    } catch (e) {
        console.error(`[SWARM_LOG_ERROR] ${e.message}`);
    }
}

// Pi-mono style tool logging functions
function logToolStart(
    ctx: any,
    toolName: string,
    label: string,
    args: Record<string, unknown>,
) {
    const timestamp = new Date().toISOString();
    const formattedArgs = JSON.stringify(args, null, 2);

    if (ctx && ctx.log) {
        ctx.log(`[${timestamp}] ↳ ${toolName}: ${label}`);
        if (formattedArgs) {
            ctx.log(
                `           ${formattedArgs.replace(/\n/g, "\n           ")}`,
            );
        }
    } else {
        console.log(`[${timestamp}] ↳ ${toolName}: ${label}`);
        if (formattedArgs) {
            console.log(
                `           ${formattedArgs.replace(/\n/g, "\n           ")}`,
            );
        }
    }
}

function logToolSuccess(
    ctx: any,
    toolName: string,
    durationMs: number,
    result: string,
) {
    const duration = (durationMs / 1000).toFixed(1);
    const timestamp = new Date().toISOString();

    if (ctx && ctx.log) {
        ctx.log(`[${timestamp}] ✓ ${toolName} (${duration}s)`);
        if (result) {
            const truncated =
                result.length > 1000
                    ? result.substring(0, 1000) + "\n(truncated at 1000 chars)"
                    : result;
            ctx.log(`           ${truncated.replace(/\n/g, "\n           ")}`);
        }
    } else {
        console.log(`[${timestamp}] ✓ ${toolName} (${duration}s)`);
        if (result) {
            const truncated =
                result.length > 1000
                    ? result.substring(0, 1000) + "\n(truncated at 1000 chars)"
                    : result;
            console.log(
                `           ${truncated.replace(/\n/g, "\n           ")}`,
            );
        }
    }
}

function logToolError(
    ctx: any,
    toolName: string,
    durationMs: number,
    error: string,
) {
    const duration = (durationMs / 1000).toFixed(1);
    const timestamp = new Date().toISOString();

    if (ctx && ctx.log) {
        ctx.log(`[${timestamp}] ✗ ${toolName} (${duration}s)`);
        ctx.log(`           ${error.replace(/\n/g, "\n           ")}`);
    } else {
        console.log(`[${timestamp}] ✗ ${toolName} (${duration}s)`);
        console.log(`           ${error.replace(/\n/g, "\n           ")}`);
    }
}

function logPromptDetails(
    filePath: string,
    instruction: string,
    fileContent: string,
    truncated: boolean,
) {
    if (!ENABLE_DETAILED_LOGGING) return;

    console.log(`[SWARM_PROMPT] Processing: ${filePath}`);
    console.log(`[SWARM_PROMPT] Instruction: ${instruction}`);
    console.log(`[SWARM_PROMPT] Content length: ${fileContent.length} chars`);
    console.log(`[SWARM_PROMPT] Truncated: ${truncated}`);
    console.log(
        `[SWARM_PROMPT] First 200 chars: ${fileContent.slice(0, 200)}...`,
    );
}

function truncateSummary(summary: string): string {
    if (summary.length <= MAX_SUMMARY_LENGTH) return summary;

    // Try to find a natural breaking point
    let end = MAX_SUMMARY_LENGTH;
    const lastPeriod = summary.lastIndexOf(".", MAX_SUMMARY_LENGTH);
    const lastNewline = summary.lastIndexOf("\n", MAX_SUMMARY_LENGTH);

    if (lastPeriod > MAX_SUMMARY_LENGTH * 0.8) {
        end = lastPeriod + 1;
    } else if (lastNewline > MAX_SUMMARY_LENGTH * 0.8) {
        end = lastNewline;
    }

    return (
        summary.slice(0, end) +
        `\n\n[SUMMARY TRUNCATED: ${summary.length - end} characters remaining]`
    );
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
                            description:
                                "Array of [filePath] or [filePath, instruction] pairs",
                            minItems: 1,
                        },
                    ),
                }),
            ]),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);
                const startTime = Date.now();

                // Validate that we have a model and API key
                if (!model) {
                    const errorMsg =
                        "No LLM model available for swarm_read. Cannot analyze files without a model.";
                    logToolError(ctx, "swarm_read", 0, errorMsg);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ Error: ${errorMsg}`,
                            },
                        ],
                        details: { error: errorMsg },
                    };
                }

                if (!apiKey) {
                    const errorMsg =
                        "No API key available for Featherless AI. Please log in or set FEATHERLESS_API_KEY.";
                    logToolError(ctx, "swarm_read", 0, errorMsg);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `❌ Error: ${errorMsg}`,
                            },
                        ],
                        details: { error: errorMsg },
                    };
                }

                // Pi-mono style tool logging
                const label =
                    "question" in params
                        ? `Analyze ${params.files.length} files: ${params.question}`
                        : `Analyze ${params.instructions.length} files with custom instructions`;

                logToolStart(ctx, "swarm_read", label, params);

                logSwarmEvent(ctx, "Starting swarm_read operation", undefined, {
                    mode: "question" in params ? "simple" : "advanced",
                    fileCount:
                        "question" in params
                            ? params.files.length
                            : params.instructions.length,
                    timestamp: new Date().toISOString(),
                    model: model.id,
                    hasApiKey: !!apiKey,
                });

                // Normalize parameters
                let files: string[];
                let instructions: (string | undefined)[];

                if ("question" in params) {
                    files = params.files;
                    instructions = files.map(() => params.question);
                } else {
                    files = params.instructions.map(
                        (pair: string[]) => pair[0],
                    );
                    instructions = params.instructions.map((pair: string[]) =>
                        pair.length > 1 ? pair[1] : "Analyze this file",
                    );
                }

                // Log operation details
                logSwarmEvent(ctx, "Operation details", undefined, {
                    totalFiles: files.length,
                    concurrency: CONCURRENCY,
                    maxFileChars: MAX_FILE_CHARS,
                    timeoutMs: SWARM_TIMEOUT_MS,
                    modelId: model.id,
                    apiKeyAvailable: !!apiKey,
                });

                // Warn if too many files might cause compaction
                if (files.length > TARGET_MAX_FILES_PER_CALL) {
                    logSwarmEvent(ctx, "Context warning", undefined, {
                        message: `Processing ${files.length} files exceeds recommended limit of ${TARGET_MAX_FILES_PER_CALL} files per call`,
                        risk: "High risk of context compaction",
                        suggestion: `Split into ${Math.ceil(files.length / TARGET_MAX_FILES_PER_CALL)} batches of ${TARGET_MAX_FILES_PER_CALL} files each`,
                        estimatedContextUsage:
                            files.length * MAX_SUMMARY_LENGTH,
                        safetyMarginUsage:
                            (files.length * MAX_SUMMARY_LENGTH) /
                            SAFE_CONTEXT_LIMIT,
                        realContextLimit: REAL_CONTEXT_LIMIT,
                        safeContextLimit: SAFE_CONTEXT_LIMIT
                    });
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
                                        // Check file size and log warning if large
                                        const stats = statSync(filePath);
                                        if (stats.size > FILE_SIZE_WARNING) {
                                            logSwarmEvent(
                                                ctx,
                                                `Large file detected`,
                                                filePath,
                                                {
                                                    size: stats.size,
                                                    warningThreshold:
                                                        FILE_SIZE_WARNING,
                                                },
                                            );
                                        }

                                        // Read file
                                        const fileContent = readFileSync(
                                            filePath,
                                            "utf8",
                                        );
                                        const truncated =
                                            fileContent.length > MAX_FILE_CHARS;
                                        const contentForProcessing =
                                            fileContent.slice(
                                                0,
                                                MAX_FILE_CHARS,
                                            );

                                        logPromptDetails(
                                            filePath,
                                            instructions[i] ||
                                                "Analyze this file",
                                            contentForProcessing,
                                            truncated,
                                        );

                                        b.progress = 20;
                                        panel.requestRender();

                                        // Process with LLM (we already validated model and apiKey exist)
                                        const instruction =
                                            instructions[i] ||
                                            "Please analyze this file and provide key insights";
                                        const prompt = `${instruction}\n\nHere is the content of ${filePath}:\n\n${contentForProcessing}`;

                                        logSwarmEvent(
                                            ctx,
                                            "Sending to LLM for analysis",
                                            filePath,
                                            {
                                                promptLength: prompt.length,
                                                instruction:
                                                    instruction.substring(
                                                        0,
                                                        50,
                                                    ) +
                                                    (instruction.length > 50
                                                        ? "..."
                                                        : ""),
                                            },
                                        );

                                        const ticker = tickProgress(b, panel);
                                        const text = await llmCall(
                                            model,
                                            apiKey,
                                            prompt,
                                            signal,
                                        );
                                        clearInterval(ticker);

                                        const truncatedSummary =
                                            truncateSummary(text);
                                        results[i] = truncatedSummary;
                                        b.snippet = truncatedSummary
                                            .slice(0, 50)
                                            .replace(/\n/g, " ");

                                        logSwarmEvent(
                                            ctx,
                                            "Analysis completed",
                                            filePath,
                                            {
                                                summaryLength: text.length,
                                                truncatedSummaryLength:
                                                    truncatedSummary.length,
                                                truncated:
                                                    truncatedSummary.length <
                                                    text.length,
                                            },
                                        );

                                        b.status = "done";
                                        b.progress = 100;
                                        panel.doneCount++;
                                        panel.requestRender();
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
                                        logSwarmEvent(
                                            ctx,
                                            "Error processing file",
                                            filePath,
                                            {
                                                error: err?.message ?? err,
                                                stack: err?.stack
                                                    ? err.stack.substring(
                                                          0,
                                                          200,
                                                      )
                                                    : undefined,
                                            },
                                        );
                                    }
                                }),
                            ),
                        ),
                        SWARM_TIMEOUT_MS,
                        `Swarm read operation timed out after ${SWARM_TIMEOUT_MS / 1000} seconds`,
                    );
                } catch (timeoutError) {
                    logSwarmEvent(ctx, "Timeout occurred", undefined, {
                        error: timeoutError.message,
                        filesProcessed: results.filter((r) => r !== "").length,
                        filesRemaining:
                            files.length -
                            results.filter((r) => r !== "").length,
                    });
                    throw timeoutError;
                } finally {
                    clearWidget(ctx);
                    logSwarmEvent(ctx, "Operation completed", undefined, {
                        successful: results.filter(
                            (r) => !r.startsWith("[error:"),
                        ).length,
                        failed: results.filter((r) => r.startsWith("[error:"))
                            .length,
                        total: files.length,
                    });
                }

                // Pi-mono style tool completion logging
                const durationMs = Date.now() - startTime;
                const hasErrors = results.some((r) => r.startsWith("[error:"));
                const resultSummary = `
- Files: ${files.length}
- Successful: ${results.filter((r) => !r.startsWith("[error:")).length}
- Failed: ${results.filter((r) => r.startsWith("[error:")).length}
- Total characters: ${results.reduce((sum, r) => sum + r.length, 0)}`;

                if (hasErrors) {
                    const errorMessages = results
                        .filter((r) => r.startsWith("[error:"))
                        .map((r) => r.replace("[error: ", "").replace("]", ""))
                        .join("; ");
                    logToolError(
                        ctx,
                        "swarm_read",
                        durationMs,
                        `Completed with errors: ${errorMessages}${resultSummary}`,
                    );
                } else {
                    logToolSuccess(
                        ctx,
                        "swarm_read",
                        durationMs,
                        `Completed successfully${resultSummary}`,
                    );
                }

                // Add monitoring information to results
                const totalCharactersProcessed = results.reduce(
                    (sum, r) => sum + r.length,
                    0,
                );
                const estimatedTokenUsage = Math.round(
                    totalCharactersProcessed / 3.2,
                ); // chars/3.2 tokens
                const contextUsagePercentage = Math.round(
                    (estimatedTokenUsage / SAFE_CONTEXT_LIMIT) * 100,
                );

                const monitoringInfo = {
                    operation: "swarm_read",
                    timestamp: new Date().toISOString(),
                    filesProcessed: files.length,
                    successful: results.filter((r) => !r.startsWith("[error:"))
                        .length,
                    failed: results.filter((r) => r.startsWith("[error:"))
                        .length,
                    totalCharactersProcessed: totalCharactersProcessed,
                    estimatedTokenUsage: estimatedTokenUsage,
                    contextUsagePercentage: contextUsagePercentage,
                    contextRiskLevel:
                        contextUsagePercentage > 90
                            ? "CRITICAL"
                            : contextUsagePercentage > 75
                              ? "HIGH"
                              : contextUsagePercentage > 50
                                ? "MEDIUM"
                                : "LOW",
                    safeContextLimit: safeContextLimit,
                    realContextLimit: REAL_CONTEXT_LIMIT,
                    shouldAutoCompact: shouldAutoCompact(estimatedTokenUsage, SAFE_CONTEXT_LIMIT),
                    compactionUrgency: shouldAutoCompact(estimatedTokenUsage, SAFE_CONTEXT_LIMIT) ? "URGENT" : contextUsagePercentage > 80 ? "SOON" : "NONE",
                    compactionThreshold: SAFE_CONTEXT_LIMIT - COMPACTION_SETTINGS.reserveTokens,
                    reserveTokens: COMPACTION_SETTINGS.reserveTokens,
                    averageSummaryLength:
                        results.length > 0
                            ? results.reduce((sum, r) => sum + r.length, 0) /
                              results.length
                            : 0,
                    files: files.map((file, index) => ({
                        path: file,
                        status: results[index].startsWith("[error:")
                            ? "error"
                            : "success",
                        summaryLength: results[index].length,
                        estimatedTokens: Math.round(
                            results[index].length / 3.2,
                        ),
                    })),
                };

                logSwarmEvent(
                    ctx,
                    "Returning results",
                    undefined,
                    monitoringInfo,
                );

                // Auto-compaction check (pi-mono style)
                // IMPORTANT: Only warn, don't interrupt active bot work
                if (monitoringInfo.shouldAutoCompact) {
                    logSwarmEvent(ctx, "AUTO-COMPACTION RECOMMENDED", undefined, {
                        action: "warn-only",  // Do NOT interrupt active work
                        currentTokens: monitoringInfo.estimatedTokenUsage,
                        safeLimit: SAFE_CONTEXT_LIMIT,
                        reserveTokens: COMPACTION_SETTINGS.reserveTokens,
                        compactionThreshold: SAFE_CONTEXT_LIMIT - COMPACTION_SETTINGS.reserveTokens,
                        urgency: "HIGH - Context approaching safe limits",
                        recommendation: `Consider splitting into smaller batches or using more specific questions. Current usage: ${monitoringInfo.contextUsagePercentage}%`,
                        safeToCompact: false,  // Bot is still working
                        suggestedAction: "Complete current talk/think/tool cycle, then compact before next user interaction"
                    });
                } else if (monitoringInfo.compactionUrgency === "SOON") {
                    logSwarmEvent(ctx, "COMPACTION WARNING", undefined, {
                        action: "monitor",
                        currentTokens: monitoringInfo.estimatedTokenUsage,
                        safeLimit: SAFE_CONTEXT_LIMIT,
                        percentage: monitoringInfo.contextUsagePercentage,
                        urgency: "MEDIUM - Monitor context usage",
                        recommendation: `Context at ${monitoringInfo.contextUsagePercentage}%. Consider fewer files if adding more content.`,
                        safeToCompact: true  // Still safe to continue
                    });
                }

                // Add context state tracking for safe compaction points
                logSwarmEvent(ctx, "CONTEXT_STATE", undefined, {
                    state: "active-task",  // Indicates bot is still working
                    shouldCompact: monitoringInfo.shouldAutoCompact,
                    canCompactNow: false,  // Never compact during active work
                    suggestedCompactPoint: "after-talk-think-tool-cycle-completion"
                });

                // Create a compact summary that won't bloat the conversation context
                const createCompactSummary = () => {
                    // Extract key insights from each file analysis
                    const fileInsights = results.map((result, i) => {
                        const filePath = files[i];
                        const isError = result.startsWith("[error:");

                        if (isError) {
                            return {
                                file: filePath,
                                status: "error",
                                summary: result,
                            };
                        }

                        // Extract first 1-2 sentences as key insight
                        const firstSentence = result.split("\n")[0] || result;
                        const shortSummary =
                            firstSentence.length > 150
                                ? firstSentence.substring(0, 150) + "..."
                                : firstSentence;

                        return {
                            file: filePath,
                            status: "success",
                            summary: shortSummary,
                        };
                    });

                    // Create compact output
                    const successCount = fileInsights.filter(
                        (f) => f.status === "success",
                    ).length;
                    const errorCount = fileInsights.filter(
                        (f) => f.status === "error",
                    ).length;

                    const compactInsights = fileInsights
                        .filter((f) => f.status === "success")
                        .map((f) => `• ${f.file}: ${f.summary}`)
                        .join("\n");

                    const errorReports = fileInsights
                        .filter((f) => f.status === "error")
                        .map((f) => `• ${f.file}: ${f.summary}`)
                        .join("\n");

                    return {
                        compactInsights,
                        errorReports,
                        successCount,
                        errorCount,
                        monitoringInfo,
                    };
                };

                // Create an overall summary and forget the detailed results to prevent context bloat
                const createOverallSummary = async () => {
                    // Check if we should use LLM for high-quality summarization
                    const useLLMSummarization = files.length <= 8 && monitoringInfo.estimatedTokenUsage < 15000;

                    if (useLLMSummarization && model && apiKey) {
                        // Use LLM for high-quality architectural analysis
                        try {
                            const architecturePrompt = `Please analyze the architecture of this codebase based on the following files: ${files.join(', ')}.

Here are the key findings from individual files:
${results.map((r, i) => `- ${files[i]}: ${r.split('\n')[0]}`).join('\n')}

Please provide a concise architectural overview that includes:
1. What type of system this is (in 1 sentence)
2. The 3-5 key components (as bullet points)
3. How they interact (in 1 paragraph)
4. Any notable patterns or technologies (as bullet points)

Please format your response clearly and concisely.`;

                            logSwarmEvent(ctx, "Generating LLM-powered architectural summary", undefined, {
                                files: files.length,
                                tokenEstimate: architecturePrompt.length / 3.2
                            });

                            const summaryResult = await llmCall(model, apiKey, architecturePrompt, signal);

                            return {
                                overallInsights: [summaryResult.split('\n\n').join('\n').replace(/^\*\*\w+:\*\*/gm, '').trim()],
                                categorySummaries: [],
                                successCount: results.filter(r => !r.startsWith("[error:")).length,
                                errorCount: results.filter(r => r.startsWith("[error:")).length,
                                errorReports: results.filter(r => r.startsWith("[error:")).map(r => `• ${files[results.indexOf(r)]}: ${r.replace('[error: ', '').replace(']', '')}`),
                                monitoringInfo,
                                usedLLM: true
                            };
                        } catch (error) {
                            logSwarmEvent(ctx, "LLM summarization failed, falling back to local", undefined, { error: error.message });
                        }
                    }

                    // Fallback to local summarization (fast but basic)
=======
                // Create an overall summary and forget the detailed results to prevent context bloat
                const createOverallSummary = async () => {
                    // Check if we should use LLM for high-quality summarization
                    const useLLMSummarization = files.length <= 8 && monitoringInfo.estimatedTokenUsage < 15000;

                    if (useLLMSummarization && model && apiKey) {
                        // Use LLM for high-quality architectural analysis
                        try {
                            const architecturePrompt = `Please analyze the architecture of this codebase based on the following files: ${files.join(', ')}.

Here are the key findings from individual files:
${results.map((r, i) => `- ${files[i]}: ${r.split('\n')[0]}`).join('\n')}

Please provide a concise architectural overview that includes:
1. What type of system this is (in 1 sentence)
2. The 3-5 key components (as bullet points)
3. How they interact (in 1 paragraph)
4. Any notable patterns or technologies (as bullet points)

Please format your response clearly and concisely.`;

                            logSwarmEvent(ctx, "Generating LLM-powered architectural summary", undefined, {
                                files: files.length,
                                tokenEstimate: architecturePrompt.length / 3.2
                            });

                            const summaryResult = await llmCall(model, apiKey, architecturePrompt, signal);

                            return {
                                overallInsights: [summaryResult.split('\n\n').join('\n').replace(/^\*\*\w+:\*\*/gm, '').trim()],
                                categorySummaries: [],
                                successCount: results.filter(r => !r.startsWith("[error:")).length,
                                errorCount: results.filter(r => r.startsWith("[error:")).length,
                                errorReports: results.filter(r => r.startsWith("[error:")).map(r => `• ${files[results.indexOf(r)]}: ${r.replace('[error: ', '').replace(']', '')}`),
                                monitoringInfo,
                                usedLLM: true
                            };
                        } catch (error) {
                            logSwarmEvent(ctx, "LLM summarization failed, falling back to local", undefined, { error: error.message });
                        }
                    }

                    // Fallback to local summarization (fast but basic)
                    // Categorize files by type/role for better summarization
                    const categorizeFile = (filePath: string): string => {
                        if (filePath.includes("/bots/")) return "bots";
                        if (filePath.includes("/engine/")) return "engine";
                        if (filePath.includes("/envoy/")) return "envoy";
                        if (filePath.includes("/memory/")) return "memory";
                        if (filePath.includes("/swarm/")) return "swarm";
                        if (filePath.includes("/task/")) return "task";
                        if (filePath.includes("/project/")) return "project";
                        if (filePath.includes("/filesystem/"))
                            return "filesystem";
                        if (filePath.endsWith(".ts") && !filePath.includes("/"))
                            return "core";
                        if (filePath.endsWith(".json")) return "config";
                        if (filePath.endsWith(".md")) return "docs";
                        return "other";
                    };

                    // Extract key themes and patterns from successful results
                    const successThemes: Record<string, string[]> = {};
                    const errorReports: string[] = [];

                    results.forEach((result, i) => {
                        const filePath = files[i];
                        const isError = result.startsWith("[error:");

                        if (isError) {
                            errorReports.push(
                                `• ${filePath}: ${result.replace("[error: ", "").replace("]", "")}`,
                            );
                            return;
                        }

                        // Extract key phrases and concepts
                        const category = categorizeFile(filePath);
                        const firstSentence = result.split("\n")[0] || result;

                        // Extract meaningful keywords (simple approach)
                        const keywords = firstSentence
                            .replace(filePath, "")
                            .replace(/[.,;:()\-{}]/g, " ")
                            .split(" ")
                            .filter(
                                (word) =>
                                    word.length > 4 &&
                                    ![
                                        "this",
                                        "file",
                                        "contains",
                                        "provides",
                                        "handles",
                                        "manages",
                                    ].includes(word.toLowerCase()),
                            )
                            .slice(0, 3)
                            .join(", ");

                        if (!successThemes[category]) {
                            successThemes[category] = [];
                        }
                        successThemes[category].push(
                            `${filePath}: ${keywords || firstSentence.substring(0, 50)}...`,
                        );
                    });

                    // Generate overall summary by category
                    const categorySummaries: string[] = [];
                    const successCount = results.filter(
                        (r) => !r.startsWith("[error:"),
                    ).length;
                    const errorCount = errorReports.length;

                    for (const [category, files] of Object.entries(
                        successThemes,
                    )) {
                        const count = files.length;
                        const totalFiles = successCount;
                        const percentage = Math.round(
                            (count / totalFiles) * 100,
                        );

                        // Create concise category summary
                        const sampleFiles = files
                            .slice(0, 2)
                            .map(
                                (f) => `
  • ${f}`,
                            )
                            .join("");
                        categorySummaries.push(
                            `${category} (${count}/${percentage}%):${sampleFiles}`,
                        );
                    }

                    // Generate overall insights
                    const overallInsights = [];

                    // Architecture patterns
                    if (successThemes["bots"] || successThemes["engine"]) {
                        overallInsights.push(
                            "Multi-agent architecture with bot hierarchy (envoy → project → task → file bots)",
                        );
                    }

                    // Key components
                    if (
                        successThemes["core"] &&
                        successThemes["core"].length > 2
                    ) {
                        overallInsights.push(
                            `Core system with ${successThemes["core"].length} main components`,
                        );
                    }

                    // Configuration
                    if (successThemes["config"]) {
                        overallInsights.push(
                            `Configuration via ${successThemes["config"].join(", ")}`,
                        );
                    }

                    return {
                        overallInsights:
                            overallInsights.length > 0
                                ? overallInsights
                                : ["Diverse codebase with multiple components"],
                        categorySummaries,
                        successCount,
                        errorCount,
                        errorReports,
                        monitoringInfo,
                    };
                };

                const {
                    overallInsights,
                    categorySummaries,
                    successCount,
                    errorCount,
                    errorReports,
                } = await createOverallSummary();

                // Add context usage warning if approaching limits
                let contextWarning = "";
                if (monitoringInfo.shouldAutoCompact) {
                    contextWarning = `\n🟡 COMPACTION RECOMMENDED: Context at ${monitoringInfo.contextUsagePercentage}% (${monitoringInfo.estimatedTokenUsage}/${SAFE_CONTEXT_LIMIT} tokens). Will suggest compaction after current task completes.`;
                } else if (monitoringInfo.contextRiskLevel === "CRITICAL") {
                    contextWarning = `\n⚠️ CRITICAL: Context at ${monitoringInfo.contextUsagePercentage}% - split into smaller batches!`;
                } else if (monitoringInfo.contextRiskLevel === "HIGH") {
                    contextWarning = `\n⚠️ HIGH: Context at ${monitoringInfo.contextUsagePercentage}% - consider fewer files.`;
                } else if (monitoringInfo.compactionUrgency === "SOON") {
                    contextWarning = `\n🟢 COMPACTION SOON: Context at ${monitoringInfo.contextUsagePercentage}% - monitor usage`;
                }

                // Return overall summary and forget detailed results
                // This prevents context bloat while preserving key insights
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                `📊 **Swarm Analysis Complete: Overall Insights**\n\n` +
                                `**Key Findings:**\n${overallInsights.map((insight) => `• ${insight}`).join("\n")}\n\n` +
                                `**Component Breakdown:**\n${categorySummaries.join("\n")}\n\n` +
                                `**Summary:** ${successCount} files analyzed, ${errorCount} errors` +
                                (errorReports.length > 0
                                    ? `:\n${errorReports.join("\n")}`
                                    : ".") +
                                `\n\n**Context:** ${monitoringInfo.estimatedTokenUsage}/${SAFE_CONTEXT_LIMIT} tokens used (${monitoringInfo.contextUsagePercentage}% of ${SAFE_CONTEXT_LIMIT} safe limit)${contextWarning}`,
                        },
                    ],
                    details: {
                        // Only keep metadata, forget verbose file contents
                        summary: {
                            overallInsights,
                            componentBreakdown: categorySummaries,
                            stats: {
                                filesAnalyzed: files.length,
                                successful: successCount,
                                failed: errorCount,
                                estimatedTokens:
                                    monitoringInfo.estimatedTokenUsage,
                                contextUsagePercentage:
                                    monitoringInfo.contextUsagePercentage,
                            },
                            errors: errorReports,
                        },
                        // Full results intentionally omitted to prevent context bloat
                        // They can be regenerated if needed by running swarm_read again
                        monitoring: {
                            operation: "swarm_read",
                            timestamp: monitoringInfo.timestamp,
                            contextRiskLevel: monitoringInfo.contextRiskLevel,
                        },
                    },
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
        { apiKey, maxTokens: 2048, signal },
    );
    const result = response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n\n");
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
