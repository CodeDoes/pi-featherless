/**
 * Featherless AI provider extension for pi.
 *
 * Featherless serves models via an OpenAI-compatible API (vLLM), but tool calls
 * are returned as <tool_call> tags in text content rather than proper OpenAI
 * `tool_calls` objects. This extension provides a custom streamSimple that
 * parses those tags into pi-ai ToolCall events so tool execution works.
 *
 * Usage:
 *   FEATHERLESS_API_KEY=rc_... pi -e ./path/to/pi-featherless
 */

import {
    type Api,
    type AssistantMessage,
    type AssistantMessageEventStream,
    type Context,
    calculateCost,
    createAssistantMessageEventStream,
    type Model,
    type SimpleStreamOptions,
    type StopReason,
    type TextContent,
    type ThinkingContent,
    type Tool,
    type ToolCall,
    type ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import OpenAI from "openai";
import { FEATHERLESS_MODELS, MODEL_META } from "./models";

// =============================================================================
// Tool-call tag parser
// =============================================================================

interface ParsedContent {
    /** Text before any <tool_call> tags (may be empty) */
    textBefore: string;
    /** Parsed tool calls from <tool_call> tags */
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

/**
 * Try to extract a JSON tool call object from a string.
 * Expects `{"name": "...", "arguments": {...}}` format.
 */
function tryParseToolCallJson(
    jsonStr: string,
): { name: string; arguments: Record<string, unknown> } | null {
    const trimmed = jsonStr.trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.name === "string") {
            return { name: parsed.name, arguments: parsed.arguments ?? {} };
        }
    } catch {
        // Not valid JSON
    }
    return null;
}

/**
 * Parse tool call tags from model output.
 *
 * Handles multiple formats used by Featherless models:
 *
 * 1. `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` (Qwen3, most models)
 * 2. `<tool_call>{"name": "...", "arguments": {...}}` (QRWKV - sometimes omits closing tag)
 * 3. `<function-call><name>...</name><arguments>{...}</arguments></function-call>` (RWKV6Qwen2.5)
 */
/** @internal Exported for testing */
export function parseToolCallTags(text: string): ParsedContent {
    const toolCalls: ParsedContent["toolCalls"] = [];
    let textBefore = "";
    let searchFrom = 0;

    while (searchFrom < text.length) {
        // Try <tool_call> format first
        const toolCallIdx = text.indexOf("<tool_call>", searchFrom);
        // Try <function-call> format
        const funcCallIdx = text.indexOf("<function-call>", searchFrom);

        // Pick whichever comes first
        const useToolCall =
            toolCallIdx !== -1 &&
            (funcCallIdx === -1 || toolCallIdx <= funcCallIdx);
        const useFuncCall =
            funcCallIdx !== -1 &&
            (toolCallIdx === -1 || funcCallIdx < toolCallIdx);

        if (!useToolCall && !useFuncCall) {
            textBefore += text.slice(searchFrom);
            break;
        }

        if (useToolCall) {
            const openTag = "<tool_call>";
            const closeTag = "</tool_call>";
            const openIdx = toolCallIdx;
            textBefore += text.slice(searchFrom, openIdx);

            const closeIdx = text.indexOf(closeTag, openIdx + openTag.length);
            let jsonStr: string;

            if (closeIdx !== -1) {
                jsonStr = text.slice(openIdx + openTag.length, closeIdx);
                searchFrom = closeIdx + closeTag.length;
            } else {
                // No closing tag (QRWKV) - take everything after the open tag
                jsonStr = text.slice(openIdx + openTag.length);
                searchFrom = text.length;
            }

            const parsed = tryParseToolCallJson(jsonStr);
            if (parsed) {
                toolCalls.push(parsed);
            } else {
                textBefore += text.slice(
                    openIdx,
                    closeIdx !== -1 ? closeIdx + closeTag.length : text.length,
                );
            }
        } else if (useFuncCall) {
            const openTag = "<function-call>";
            const closeTag = "</function-call>";
            // Also accept </functioncall> (some models emit this)
            const openIdx = funcCallIdx;
            textBefore += text.slice(searchFrom, openIdx);

            let closeIdx = text.indexOf(closeTag, openIdx + openTag.length);
            let actualCloseLen = closeTag.length;
            if (closeIdx === -1) {
                closeIdx = text.indexOf(
                    "</functioncall>",
                    openIdx + openTag.length,
                );
                actualCloseLen = "</functioncall>".length;
            }

            if (closeIdx !== -1) {
                const inner = text.slice(openIdx + openTag.length, closeIdx);
                // Try JSON format first
                const jsonParsed = tryParseToolCallJson(inner);
                if (jsonParsed) {
                    toolCalls.push(jsonParsed);
                } else {
                    // Try XML-like <name>...</name><arguments>...</arguments> format
                    const nameMatch = inner.match(/<name>\s*(.*?)\s*<\/name>/s);
                    const argsMatch = inner.match(
                        /<arguments>\s*([\s\S]*?)\s*<\/arguments>/s,
                    );
                    if (nameMatch) {
                        let args: Record<string, unknown> = {};
                        if (argsMatch) {
                            try {
                                args = JSON.parse(argsMatch[1].trim());
                            } catch {
                                // ignore parse failure
                            }
                        }
                        toolCalls.push({
                            name: nameMatch[1].trim(),
                            arguments: args,
                        });
                    } else {
                        textBefore += text.slice(
                            openIdx,
                            closeIdx + actualCloseLen,
                        );
                    }
                }
                searchFrom = closeIdx + actualCloseLen;
            } else {
                textBefore += text.slice(openIdx);
                searchFrom = text.length;
            }
        }
    }

    return { textBefore: textBefore.trim(), toolCalls };
}

// =============================================================================
// Message conversion
// =============================================================================

function convertMessages(
    context: Context,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const params: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (context.systemPrompt) {
        params.push({ role: "system", content: context.systemPrompt });
    }

    for (let i = 0; i < context.messages.length; i++) {
        const msg = context.messages[i];

        if (msg.role === "user") {
            const content =
                typeof msg.content === "string"
                    ? msg.content
                    : msg.content
                          .filter((c): c is TextContent => c.type === "text")
                          .map((c) => c.text)
                          .join("\n");
            if (content) params.push({ role: "user", content });
        } else if (msg.role === "assistant") {
            const textBlocks = msg.content.filter(
                (b): b is TextContent => b.type === "text",
            );
            const toolCallBlocks = msg.content.filter(
                (b): b is ToolCall => b.type === "toolCall",
            );

            const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam =
                {
                    role: "assistant",
                    content: textBlocks.map((b) => b.text).join("") || null,
                };

            if (toolCallBlocks.length > 0) {
                // Use native OpenAI tool_calls format
                assistantMsg.tool_calls = toolCallBlocks.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                }));
            }

            params.push(assistantMsg);
        } else if (msg.role === "toolResult") {
            // Each tool result is a separate "tool" role message
            const toolMsg = msg as ToolResultMessage;
            const textResult = toolMsg.content
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.text)
                .join("\n");
            params.push({
                role: "tool" as const,
                tool_call_id: toolMsg.toolCallId,
                content: textResult,
            });
        }
    }

    return params;
}

function convertTools(
    tools: Tool[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
        },
    }));
}

// =============================================================================
// Streaming implementation
// =============================================================================

/**
 * Longest opening tag we need to detect: "<function-call>" (15 chars).
 * We hold back up to this many chars to avoid emitting partial tag starts.
 */
const TAG_OPENS = ["<tool_call>", "<function-call>"] as const;
const TAG_CLOSE_MAP: Record<string, string[]> = {
    "<tool_call>": ["</tool_call>"],
    "<function-call>": ["</function-call>", "</functioncall>"],
};
const MAX_TAG_OPEN_LEN = 15; // length of "<function-call>"

/**
 * Find how many trailing characters of `text` (from `from` onwards)
 * could be the start of one of our tag opens. We hold these back
 * so we don't emit a partial `<tool_` as visible text.
 */
function trailingTagPrefixLen(text: string, from: number): number {
    let best = 0;
    for (
        let len = 1;
        len <= Math.min(MAX_TAG_OPEN_LEN - 1, text.length - from);
        len++
    ) {
        const tail = text.slice(text.length - len);
        for (const tag of TAG_OPENS) {
            if (tag.startsWith(tail)) {
                best = len;
            }
        }
    }
    return best;
}

function streamFeatherless(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();

    (async () => {
        const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                },
            },
            stopReason: "stop",
            timestamp: Date.now(),
        };

        try {
            const apiKey = options?.apiKey ?? "";
            const client = new OpenAI({
                apiKey,
                baseURL: model.baseUrl,
                dangerouslyAllowBrowser: true,
            });

            const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
                {
                    model: model.id,
                    messages: convertMessages(context),
                    stream: true,
                };

            if (options?.maxTokens) {
                (params as any).max_tokens = options.maxTokens;
            }

            if (options?.temperature !== undefined) {
                params.temperature = options.temperature;
            }

            if (context.tools && context.tools.length > 0) {
                params.tools = convertTools(context.tools);
            }

            // Apply family-specific parameters
            if (model.id.includes("Qwen3")) {
                const { applyQwen3Params } = await import("./models/qwen3");
                applyQwen3Params(params, options);
            }

            // Get actual input token count via Featherless tokenize API
            let inputTokenCount = 0;
            try {
                const tokenizeResp = await fetch(`${model.baseUrl}/tokenize`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: model.id,
                        text: JSON.stringify(params.messages),
                    }),
                });
                if (tokenizeResp.ok) {
                    const tokenizeData = (await tokenizeResp.json()) as {
                        tokens: number[];
                    };
                    inputTokenCount = tokenizeData.tokens.length;
                }
            } catch {
                // Fall back to chars/4 estimate if tokenize fails
                inputTokenCount = Math.ceil(
                    JSON.stringify(params.messages).length / 4,
                );
            }

            const openaiStream = await client.chat.completions.create(params, {
                signal: options?.signal,
            });

            stream.push({ type: "start", partial: output });

            // -- Streaming state --
            let inThinking = false;
            let inText = false;
            let thinkingIndex = -1;
            let textIndex = -1;
            let toolCallCount = 0;
            let outputTokenCount = 0;

            // Native tool_calls accumulator (OpenAI streaming format)
            // Each entry accumulates incremental name/arguments deltas
            const nativeToolCalls = new Map<
                number,
                { id: string; name: string; arguments: string }
            >();
            let gotNativeToolCalls = false;

            // Text-based tool-call tag parser state (fallback for unsupported models)
            let pendingText = ""; // buffered text not yet emitted (might contain tag start)
            let inTag = false; // currently inside a <tool_call> or <function-call>
            let tagOpen = ""; // which opening tag we matched
            let tagBuffer = ""; // content inside the tag so far

            // -- Helper: emit confirmed text as a text_delta --
            function flushText(text: string) {
                if (!text) return;
                if (!inText) {
                    const textBlock: TextContent = { type: "text", text: "" };
                    output.content.push(textBlock);
                    textIndex = output.content.length - 1;
                    inText = true;
                    stream.push({
                        type: "text_start",
                        contentIndex: textIndex,
                        partial: output,
                    });
                }
                (output.content[textIndex] as TextContent).text += text;
                stream.push({
                    type: "text_delta",
                    contentIndex: textIndex,
                    delta: text,
                    partial: output,
                });
            }

            // -- Helper: close the current text block --
            function closeText() {
                if (inText) {
                    stream.push({
                        type: "text_end",
                        contentIndex: textIndex,
                        content: (output.content[textIndex] as TextContent)
                            .text,
                        partial: output,
                    });
                    inText = false;
                }
            }

            // -- Helper: emit a parsed tool call --
            function emitToolCall(name: string, args: Record<string, unknown>) {
                closeText();
                const toolCall: ToolCall = {
                    type: "toolCall",
                    id: `call_${Date.now()}_${toolCallCount++}`,
                    name,
                    arguments: args as Record<string, any>,
                };
                output.content.push(toolCall);
                const idx = output.content.length - 1;
                stream.push({
                    type: "toolcall_start",
                    contentIndex: idx,
                    partial: output,
                });
                stream.push({
                    type: "toolcall_delta",
                    contentIndex: idx,
                    delta: JSON.stringify(args),
                    partial: output,
                });
                stream.push({
                    type: "toolcall_end",
                    contentIndex: idx,
                    toolCall,
                    partial: output,
                });
                output.stopReason = "toolUse";
            }

            // -- Helper: parse inner tag content and emit tool call --
            function parseAndEmitTag(inner: string, openTag: string) {
                if (openTag === "<tool_call>") {
                    const parsed = tryParseToolCallJson(inner);
                    if (parsed) emitToolCall(parsed.name, parsed.arguments);
                } else {
                    // <function-call>: try JSON first, then XML
                    const jsonParsed = tryParseToolCallJson(inner);
                    if (jsonParsed) {
                        emitToolCall(jsonParsed.name, jsonParsed.arguments);
                    } else {
                        const nameMatch = inner.match(
                            /<name>\s*(.*?)\s*<\/name>/s,
                        );
                        const argsMatch = inner.match(
                            /<arguments>\s*([\s\S]*?)\s*<\/arguments>/s,
                        );
                        if (nameMatch) {
                            let args: Record<string, unknown> = {};
                            if (argsMatch) {
                                try {
                                    args = JSON.parse(argsMatch[1].trim());
                                } catch {
                                    // ignore
                                }
                            }
                            emitToolCall(nameMatch[1].trim(), args);
                        }
                    }
                }
            }

            // -- Helper: process a content delta through the streaming parser --
            function processContent(delta: string) {
                if (inTag) {
                    tagBuffer += delta;
                    // Check for any matching closing tag
                    const closeTags = TAG_CLOSE_MAP[tagOpen] ?? [];
                    for (const ct of closeTags) {
                        const closeIdx = tagBuffer.indexOf(ct);
                        if (closeIdx !== -1) {
                            const inner = tagBuffer.slice(0, closeIdx);
                            const remainder = tagBuffer.slice(
                                closeIdx + ct.length,
                            );
                            inTag = false;
                            tagBuffer = "";
                            parseAndEmitTag(inner, tagOpen);
                            // Process anything after the close tag
                            if (remainder) processContent(remainder);
                            return;
                        }
                    }
                    // Still waiting for close tag
                    return;
                }

                // Not in a tag - accumulate and look for tag opens
                pendingText += delta;

                // Look for a complete tag open in pendingText
                let earliestIdx = -1;
                let matchedOpen = "";
                for (const tag of TAG_OPENS) {
                    const idx = pendingText.indexOf(tag);
                    if (
                        idx !== -1 &&
                        (earliestIdx === -1 || idx < earliestIdx)
                    ) {
                        earliestIdx = idx;
                        matchedOpen = tag;
                    }
                }

                if (earliestIdx !== -1) {
                    // Emit text before the tag
                    flushText(pendingText.slice(0, earliestIdx));
                    // Enter tag mode
                    const afterTag = pendingText.slice(
                        earliestIdx + matchedOpen.length,
                    );
                    pendingText = "";
                    inTag = true;
                    tagOpen = matchedOpen;
                    tagBuffer = "";
                    // Process content after the opening tag (may contain close tag already)
                    if (afterTag) processContent(afterTag);
                    return;
                }

                // No complete tag found - emit text that's safe (hold back potential partial tag at end)
                const holdBack = trailingTagPrefixLen(pendingText, 0);
                const safeLen = pendingText.length - holdBack;
                if (safeLen > 0) {
                    flushText(pendingText.slice(0, safeLen));
                    pendingText = pendingText.slice(safeLen);
                }
            }

            for await (const chunk of openaiStream) {
                if (!chunk || typeof chunk !== "object") continue;

                output.responseId ||= chunk.id;

                if (chunk.usage) {
                    output.usage.input = chunk.usage.prompt_tokens || 0;
                    output.usage.output = chunk.usage.completion_tokens || 0;
                    output.usage.totalTokens =
                        output.usage.input + output.usage.output;
                    calculateCost(model, output.usage);
                }
                // Count streamed output tokens
                outputTokenCount++;

                const choice = chunk.choices?.[0];
                if (!choice) continue;

                if (choice.finish_reason) {
                    const mapped = mapFinishReason(choice.finish_reason);
                    output.stopReason = mapped;
                }

                if (!choice.delta) continue;

                // Handle reasoning delta (Qwen3 thinking)
                const reasoning = (choice.delta as any).reasoning;
                if (reasoning) {
                    if (!inThinking) {
                        const thinkingBlock: ThinkingContent = {
                            type: "thinking",
                            thinking: "",
                        };
                        output.content.push(thinkingBlock);
                        thinkingIndex = output.content.length - 1;
                        inThinking = true;
                        stream.push({
                            type: "thinking_start",
                            contentIndex: thinkingIndex,
                            partial: output,
                        });
                    }

                    (
                        output.content[thinkingIndex] as ThinkingContent
                    ).thinking += reasoning;
                    stream.push({
                        type: "thinking_delta",
                        contentIndex: thinkingIndex,
                        delta: reasoning,
                        partial: output,
                    });
                }

                // Handle content delta
                if (choice.delta.content) {
                    // Close thinking block if we were in one
                    if (inThinking) {
                        stream.push({
                            type: "thinking_end",
                            contentIndex: thinkingIndex,
                            content: (
                                output.content[thinkingIndex] as ThinkingContent
                            ).thinking,
                            partial: output,
                        });
                        inThinking = false;
                    }

                    // Only parse text tags if we haven't gotten native tool_calls
                    if (!gotNativeToolCalls) {
                        processContent(choice.delta.content);
                    }
                    // If we got native tool_calls, ignore content (it's duplicate <tool_call> tags)
                }

                // Handle native delta.tool_calls (Qwen3, Kimi-K2, etc.)
                if (choice.delta.tool_calls) {
                    gotNativeToolCalls = true;

                    // Close thinking if needed
                    if (inThinking) {
                        stream.push({
                            type: "thinking_end",
                            contentIndex: thinkingIndex,
                            content: (
                                output.content[thinkingIndex] as ThinkingContent
                            ).thinking,
                            partial: output,
                        });
                        inThinking = false;
                    }

                    for (const tc of choice.delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        let entry = nativeToolCalls.get(idx);
                        if (!entry) {
                            entry = {
                                id:
                                    tc.id ??
                                    `call_${Date.now()}_${toolCallCount++}`,
                                name: "",
                                arguments: "",
                            };
                            nativeToolCalls.set(idx, entry);
                        }
                        if (tc.function?.name) entry.name += tc.function.name;
                        if (tc.function?.arguments)
                            entry.arguments += tc.function.arguments;
                    }
                }
            }

            // -- Finalize after stream ends --

            // Emit native tool calls if we got them
            if (gotNativeToolCalls && nativeToolCalls.size > 0) {
                closeText();
                for (const [, entry] of nativeToolCalls) {
                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(entry.arguments);
                    } catch {
                        // ignore parse failure
                    }
                    const toolCall: ToolCall = {
                        type: "toolCall",
                        id: entry.id,
                        name: entry.name,
                        arguments: args as Record<string, any>,
                    };
                    output.content.push(toolCall);
                    const idx = output.content.length - 1;
                    stream.push({
                        type: "toolcall_start",
                        contentIndex: idx,
                        partial: output,
                    });
                    stream.push({
                        type: "toolcall_delta",
                        contentIndex: idx,
                        delta: entry.arguments,
                        partial: output,
                    });
                    stream.push({
                        type: "toolcall_end",
                        contentIndex: idx,
                        toolCall,
                        partial: output,
                    });
                }
                output.stopReason = "toolUse";
            }

            // Fallback: handle text-based tool call tags (unsupported models)
            if (!gotNativeToolCalls) {
                // Handle unclosed tool call tag (QRWKV omits closing tag)
                if (inTag && tagBuffer) {
                    parseAndEmitTag(tagBuffer, tagOpen);
                    inTag = false;
                }

                // Flush any remaining held-back text
                if (pendingText) {
                    flushText(pendingText);
                    pendingText = "";
                }
            }

            // Close any open blocks
            if (inThinking) {
                stream.push({
                    type: "thinking_end",
                    contentIndex: thinkingIndex,
                    content: (output.content[thinkingIndex] as ThinkingContent)
                        .thinking,
                    partial: output,
                });
            }
            closeText();

            // Featherless doesn't return usage for streaming requests.
            // Estimate so pi can trigger auto-compaction.
            if (output.usage.totalTokens === 0) {
                output.usage.input = inputTokenCount;
                output.usage.output = outputTokenCount;
                output.usage.totalTokens = inputTokenCount + outputTokenCount;
            }

            if (options?.signal?.aborted) {
                throw new Error("Request was aborted");
            }

            stream.push({
                type: "done",
                reason: output.stopReason as "stop" | "length" | "toolUse",
                message: output,
            });
            stream.end();
        } catch (error) {
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            // Extract detailed error info from OpenAI API errors
            let errorMsg =
                error instanceof Error ? error.message : String(error);
            if (error && typeof error === "object" && "status" in error) {
                const apiErr = error as {
                    status: number;
                    error?: { message?: string; type?: string };
                };
                if (apiErr.error?.message) {
                    errorMsg = `${apiErr.status}: ${apiErr.error.message}`;
                }
            }
            output.errorMessage = errorMsg;
            stream.push({
                type: "error",
                reason: output.stopReason,
                error: output,
            });
            stream.end();
        }
    })();

    return stream;
}

function mapFinishReason(reason: string): StopReason {
    switch (reason) {
        case "stop":
            return "stop";
        case "length":
            return "length";
        case "tool_calls":
            return "toolUse";
        default:
            return "stop";
    }
}

// =============================================================================
// Status API
// =============================================================================

interface ErrorRateEntry {
    key: number;
    key_as_string: string;
    value: number;
}

type ErrorRatesResponse = Record<string, ErrorRateEntry[]>;

async function fetchErrorRates(): Promise<ErrorRatesResponse> {
    const response = await fetch(
        "https://featherless.ai/api/feather/status/error-rates",
    );
    if (!response.ok) {
        throw new Error(`Status API returned ${response.status}`);
    }
    return response.json() as Promise<ErrorRatesResponse>;
}

function classifyHealth(recentErrorRate: number): string {
    if (recentErrorRate === 0) return "Healthy";
    if (recentErrorRate < 0.05) return "Mostly OK";
    if (recentErrorRate < 0.2) return "Degraded";
    if (recentErrorRate < 0.5) return "Impaired";
    return "Severely impaired";
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
    pi.registerProvider("featherless", {
        baseUrl: "https://api.featherless.ai/v1",
        apiKey: "FEATHERLESS_API_KEY",
        api: "featherless-openai",
        models: FEATHERLESS_MODELS,
        streamSimple: streamFeatherless,
        oauth: {
            name: "Featherless",
            async login(callbacks) {
                const key = await callbacks.onPrompt({
                    message: "Enter your Featherless API key:",
                    placeholder: "rc_...",
                });
                return {
                    access: key,
                    refresh: key,
                    expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
                };
            },
            async refreshToken(credentials) {
                return credentials;
            },
            getApiKey(credentials) {
                return credentials.access;
            },
        },
    });

    pi.registerCommand("featherless-status", {
        description: "Show Featherless model status and concurrency costs",
        handler: async (_args, ctx) => {
            try {
                const errorRates = await fetchErrorRates();

                // Group models by model class
                const classBuckets = new Map<
                    string,
                    {
                        models: typeof FEATHERLESS_MODELS;
                        concurrencyCost: number;
                    }
                >();
                for (const model of FEATHERLESS_MODELS) {
                    const meta = MODEL_META[model.id];
                    if (!meta) continue;
                    const existing = classBuckets.get(meta.modelClass);
                    if (existing) {
                        existing.models.push(model);
                    } else {
                        classBuckets.set(meta.modelClass, {
                            models: [model],
                            concurrencyCost: meta.concurrencyCost,
                        });
                    }
                }

                const lines: string[] = [];

                for (const [modelClass, bucket] of classBuckets) {
                    const entries = errorRates[modelClass];
                    const names = bucket.models.map((m) => m.name).join(", ");
                    const cc = bucket.concurrencyCost;

                    if (!entries || entries.length === 0) {
                        lines.push(
                            `[cc:${cc}] ${modelClass} -- No data -- ${names}`,
                        );
                        continue;
                    }

                    const recent = entries.slice(-6);
                    const avgRecent =
                        recent.reduce((sum, e) => sum + e.value, 0) /
                        recent.length;
                    const health = classifyHealth(avgRecent);

                    const last24 = entries.slice(-24);
                    const avg24h =
                        last24.reduce((sum, e) => sum + e.value, 0) /
                        last24.length;

                    const pctRecent = (avgRecent * 100).toFixed(1);
                    const pct24h = (avg24h * 100).toFixed(1);

                    lines.push(
                        `[cc:${cc}] ${modelClass} ${health} - ${pctRecent}% err (6h), ${pct24h}% (24h) -- ${names}`,
                    );
                }

                lines.push("");
                lines.push(
                    "cc = concurrency cost (Basic: 2 max, Premium: 4 max, Scale: 8 max)",
                );

                // Show other impaired classes
                const allImpaired: string[] = [];
                for (const [modelClass, entries] of Object.entries(
                    errorRates,
                )) {
                    if (classBuckets.has(modelClass)) continue;
                    if (!entries || entries.length === 0) continue;
                    const recent = entries.slice(-6);
                    const avg =
                        recent.reduce((sum, e) => sum + e.value, 0) /
                        recent.length;
                    if (avg >= 0.2) {
                        allImpaired.push(
                            `${modelClass}: ${(avg * 100).toFixed(1)}% err (6h)`,
                        );
                    }
                }

                if (allImpaired.length > 0) {
                    lines.push("");
                    lines.push("Other impaired classes:");
                    lines.push(...allImpaired);
                }

                await ctx.ui.select("Featherless Status", lines);
            } catch (error) {
                ctx.ui.notify(
                    `Failed to fetch status: ${error instanceof Error ? error.message : error}`,
                    "error",
                );
            }
        },
    });
}
