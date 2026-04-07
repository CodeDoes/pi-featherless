import type { Context, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    serializeConversation,
    convertToLlm,
} from "@mariozechner/pi-coding-agent";
import { PROVIDER, getApiKey } from "./shared";

/**
 * High-Performance Compaction Handler for Featherless AI.
 *
 * Strategy:
 * 1. Strip verbose tool outputs and thinking blocks to maximize signal-to-noise.
 * 2. Use character-based chunking (~30k chars) to respect 8k-16k context windows.
 * 3. Parallelize summarization using Qwen2.5-Coder-7B (Cost 1).
 * 4. Join summaries directly without an expensive merge step to minimize TTFT.
 */

const SUB_SUMMARY_PROMPT = `Summarize this technical segment. Focus: paths, logic, errors, state. Strip: raw tool output, filler.\n\n<segment>\n\${segmentText}\n</segment>`;

const FAST_MODEL_ID = "Qwen/Qwen2.5-Coder-7B-Instruct";
const CHUNK_SIZE_CHARS = 30000; // Aim for ~9k tokens per chunk to fit in 16k window

/**
 * Aggressively strips verbose blocks to maximize context density.
 */
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
                            text: `[${m.toolName} output stripped - Success: ${!m.isError}]`,
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

export function registerCompaction(pi: ExtensionAPI) {
    pi.on("session_before_compact", async (event, ctx) => {
        const model = ctx.model;
        if (!model || model.provider !== PROVIDER) return;

        const apiKey = await getApiKey(ctx);
        if (!apiKey) return;

        const { preparation, signal } = event;
        const {
            messagesToSummarize,
            turnPrefixMessages,
            tokensBefore,
            firstKeptEntryId,
            previousSummary,
        } = preparation;

        const filteredMessages = stripToMetadata(
            convertToLlm([...messagesToSummarize, ...turnPrefixMessages]),
        );

        // Character-based chunking to ensure every segment fits in the context window
        const chunks: any[][] = [];
        let currentChunk: any[] = [];
        let currentSize = 0;

        for (const msg of filteredMessages) {
            const msgSize = JSON.stringify(msg).length;
            if (
                currentSize + msgSize > CHUNK_SIZE_CHARS &&
                currentChunk.length > 0
            ) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentSize = 0;
            }
            currentChunk.push(msg);
            currentSize += msgSize;
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        const subModel = {
            ...model,
            id: FAST_MODEL_ID,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        } as Model<any>;

        try {
            const subSummaryPromises = chunks.map((chunk, idx) => {
                const segmentText = serializeConversation(chunk);
                const messages: Context["messages"] = [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: SUB_SUMMARY_PROMPT.replace(
                                    "${segmentText}",
                                    segmentText,
                                ),
                            },
                        ],
                        timestamp: Date.now() + idx,
                    },
                ];
                const timeoutSignal = AbortSignal.timeout(15000);
                const combinedSignal = (AbortSignal as any).any
                    ? (AbortSignal as any).any(
                          [signal, timeoutSignal].filter(Boolean),
                      )
                    : timeoutSignal;

                return completeSimple(
                    subModel,
                    { messages },
                    { apiKey, maxTokens: 1024, signal: combinedSignal },
                )
                    .then((res) => {
                        const text = res.content
                            .filter((c: any) => c.type === "text")
                            .map((c: any) => c.text)
                            .join("\n");
                        return text.trim() || "[Segment summary empty]";
                    })
                    .catch(() => "[Segment processing failed]");
            });

            const summaries = await Promise.all(subSummaryPromises);

            const previousContext = previousSummary
                ? `## Previous History\n${previousSummary}\n\n`
                : "";

            const summary =
                previousContext +
                summaries
                    .map((s, i) => `### Activity Segment ${i + 1}\n${s}`)
                    .join("\n\n");

            if (!summary.trim()) return;

            return { compaction: { summary, firstKeptEntryId, tokensBefore } };
        } catch {
            return;
        }
    });
}
