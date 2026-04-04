/**
 * Featherless AI provider extension for pi.
 *
 * Featherless serves models via an OpenAI-compatible API (vLLM), but tool calls
 * are returned as <tool_call> tags in text content rather than proper OpenAI
 * `tool_calls` objects. This extension provides a custom streamSimple that
 * parses those tags into pi-ai ToolCall events so tool execution works.
 *
 * This extension is Qwen3-focused for now, supporting only the <tool_call> format.
 */

import type {
    AssistantMessageEventStream,
    Context,
    Model,
    OpenAICompletionsCompat,
    ProviderModelConfig,
    SimpleStreamOptions,
    ToolCall,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import OpenAI from "openai";
import { FEATHERLESS_MODELS, MODEL_META } from "./models";

// =============================================================================
// Tool-call tag parser (Qwen3-only)
// =============================================================================

interface ParsedContent {
    /** Text before any <tool_call> tags (may be empty) */
    textBefore: string;
    /** Parsed tool calls from <tool_call> tags */
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

/**
 * Try to extract a JSON tool call object from a string.
 * Returns null if parsing fails.
 */
function tryParseToolCallJson(
    jsonStr: string,
): { name: string; arguments: Record<string, unknown> } | null {
    const trimmed = jsonStr.trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "name" in parsed) {
            return {
                name: parsed.name,
                arguments: parsed.arguments || {},
            };
        }
    } catch {
        // ignore parse errors
    }
    return null;
}

/**
 * Parse tool calls from text content (Qwen3 format only).
 * Supports: `<tool_call>{...}</tool_call>` (Qwen3 pure models)
 */
/** @internal Exported for testing */
export function parseToolCallTags(text: string): ParsedContent {
    const toolCalls: ParsedContent["toolCalls"] = [];
    let textBefore = "";
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const openTag = "<tool_call>";
        const closeTag = "</tool_call>";
        const openIdx = text.indexOf(openTag, searchFrom);

        if (openIdx === -1) {
            textBefore += text.slice(searchFrom);
            break;
        }

        textBefore += text.slice(searchFrom, openIdx);
        const closeIdx = text.indexOf(closeTag, openIdx + openTag.length);

        if (closeIdx !== -1) {
            const jsonStr = text.slice(openIdx + openTag.length, closeIdx);
            const parsed = tryParseToolCallJson(jsonStr);
            if (parsed) {
                toolCalls.push(parsed);
            } else {
                textBefore += text.slice(openIdx, closeIdx + closeTag.length);
            }
            searchFrom = closeIdx + closeTag.length;
        } else {
            // No closing tag - treat as regular text
            textBefore += text.slice(openIdx);
            searchFrom = text.length;
        }
    }

    return { textBefore: textBefore.trim(), toolCalls };
}

// =============================================================================
// Message conversion
// =============================================================================

function convertMessages(
    context: Context,
    model: Model<"openai-completions">,
): Array<
    | { role: "user" | "assistant" | "tool"; content: string }
    | {
          role: "assistant";
          content: Array<{ type: "text"; text: string } | ToolCall>;
      }
> {
    const messages: Array<
        | { role: "user" | "assistant" | "tool"; content: string }
        | {
              role: "assistant";
              content: Array<{ type: "text"; text: string } | ToolCall>;
          }
    > = [];

    for (const msg of context.messages) {
        if (msg.role === "user" || msg.role === "system") {
            messages.push({ role: "user", content: msg.content });
        } else if (msg.role === "assistant") {
            const textBlocks: Array<{ type: "text"; text: string }> = [];
            const toolCallBlocks: ToolCall[] = [];

            for (const block of msg.content) {
                if (block.type === "text") {
                    textBlocks.push({ type: "text", text: block.text });
                } else if (block.type === "tool_call") {
                    toolCallBlocks.push({
                        type: "function" as const,
                        id: block.tool_call_id || `call_${Date.now()}`,
                        function: {
                            name: block.name,
                            arguments: block.arguments,
                        },
                    });
                }
            }

            if (toolCallBlocks.length > 0) {
                messages.push({
                    role: "assistant",
                    content: [...textBlocks, ...toolCallBlocks],
                });
            } else if (textBlocks.length > 0) {
                messages.push({
                    role: "assistant",
                    content: textBlocks[0].text,
                });
            }
        } else if (msg.role === "tool") {
            const textResult =
                typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content);
            messages.push({
                role: "tool",
                content: `{\"result\": ${JSON.stringify(textResult)}}`,
            });
        }
    }

    return messages;
}

function convertTools(
    tools: Array<{ name: string; description: string }>,
): Array<{
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {},
        },
    }));
}

// =============================================================================
// Constants
// =============================================================================

const TAG_OPENS = ["<tool_call>", "<function-call>"];
const TAG_CLOSE_MAP: Record<string, string> = {
    "<tool_call>": "</tool_call>",
    "<function-call>": "</function-call>",
};
const MAX_TAG_OPEN_LEN = Math.max(...TAG_OPENS.map((t) => t.length));

/**
 * Check if text ends with a partial tool-call tag prefix.
 * Returns length of the partial prefix if found, 0 otherwise.
 */
function trailingTagPrefixLen(text: string): number {
    let best = 0;
    for (const openTag of TAG_OPENS) {
        const tail = text.slice(-openTag.length);
        if (openTag.startsWith(tail)) {
            best = Math.max(best, tail.length);
        }
    }
    return best;
}

// =============================================================================
// Main streamSimple implementation
// =============================================================================

export async function* streamSimple(
    model: Model<"openai-completions">,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const stream: AssistantMessageEventStream = [];
    const output: {
        role: "assistant";
        content: Array<{ type: "text"; text: string } | ToolCall>;
        usage?: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
            cost?: {
                input: number;
                output: number;
                cacheRead: number;
                cacheWrite: number;
                total: number;
            };
        };
        stopReason?: string;
        timestamp?: number;
    } = {
        role: "assistant",
        content: [],
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
        },
    };

    const apiKey = model.credentials?.apiKey;
    if (!apiKey) {
        throw new Error("Featherless API key not configured");
    }

    const client = new OpenAI({
        baseURL: model.baseUrl,
        apiKey,
        dangerouslyAllowBrowser: true,
    });

    const params: any = {
        model: model.id,
        messages: convertMessages(context, model),
        stream: true,
    };

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
        inputTokenCount = Math.ceil(JSON.stringify(params.messages).length / 4);
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
    let inTag = false;
    let tagOpen = "";
    let tagBuffer = "";

    function flushText() {
        if (inText && tagBuffer) {
            const textBlock: { type: "text"; text: string } = {
                type: "text",
                text: tagBuffer,
            };
            output.content.push(textBlock);

            stream.push({
                type: "content",
                contentIndex: output.content.length - 1,
                partial: true,
            });

            stream.push({
                type: "content",
                contentIndex: output.content.length - 1,
                delta: textBlock,
                partial: true,
            });

            tagBuffer = "";
        }
    }

    function closeText() {
        if (inText) {
            flushText();
            inText = false;

            stream.push({
                type: "content",
                contentIndex: textIndex,
                content: output.content[textIndex],
                partial: false,
            });
        }
    }

    function emitToolCall(
        name: string,
        args: Record<string, unknown>,
        id: string,
    ) {
        const toolCall: ToolCall = {
            type: "function",
            id,
            function: {
                name,
                arguments: args,
            },
        };

        const idx = output.content.length;
        output.content.push(toolCall);

        stream.push({
            type: "content",
            contentIndex: idx,
            partial: true,
        });

        stream.push({
            type: "content",
            contentIndex: idx,
            delta: toolCall,
            partial: true,
        });

        stream.push({
            type: "content",
            contentIndex: idx,
            partial: false,
        });
    }

    function parseAndEmitTag(tagContent: string) {
        const parsed = parseToolCallTags(tagContent);
        const jsonParsed = tryParseToolCallJson(parsed.textBefore);

        if (jsonParsed) {
            let args: Record<string, unknown> = jsonParsed.arguments || {};
            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                } catch {
                    args = {};
                }
            }

            const nameMatch = jsonParsed.name;
            if (nameMatch) {
                emitToolCall(
                    nameMatch,
                    args,
                    `call_${Date.now()}_${toolCallCount++}`,
                );
            }
        }

        for (const toolCall of parsed.toolCalls) {
            let args = toolCall.arguments;
            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                } catch {
                    args = {};
                }
            }
            emitToolCall(
                toolCall.name,
                args,
                `call_${Date.now()}_${toolCallCount++}`,
            );
        }
    }

    function processContent(deltaText: string) {
        // Check for tool-call tags
        const closeTags = ["</tool_call>", "</function-call>"];
        let earliestIdx = Infinity;
        let matchedOpen = "";

        for (const openTag of TAG_OPENS) {
            const idx = deltaText.indexOf(openTag);
            if (idx !== -1 && idx < earliestIdx) {
                earliestIdx = idx;
                matchedOpen = openTag;
            }
        }

        if (earliestIdx !== Infinity) {
            // Found a tag
            const idx = earliestIdx;
            const openTag = matchedOpen;
            const closeTag = TAG_CLOSE_MAP[openTag];

            // Text before the tag
            const beforeTag = deltaText.slice(0, idx);
            if (beforeTag) {
                tagBuffer += beforeTag;
            }

            // Find closing tag
            const closeIdx = deltaText.indexOf(closeTag, idx + openTag.length);
            if (closeIdx !== -1) {
                // Complete tag in this chunk
                const inner = deltaText.slice(idx + openTag.length, closeIdx);
                const afterTag = deltaText.slice(closeIdx + closeTag.length);

                if (!inTag) {
                    // New tag
                    tagBuffer += openTag + inner + closeTag;
                    parseAndEmitTag(tagBuffer);
                    tagBuffer = afterTag;
                } else {
                    // Continuation of previous tag
                    tagBuffer += openTag + inner + closeTag;
                    parseAndEmitTag(tagBuffer);
                    tagBuffer = afterTag;
                    inTag = false;
                }
            } else {
                // Incomplete tag
                if (!inTag) {
                    // Start of new tag
                    tagBuffer += deltaText.slice(idx);
                    inTag = true;
                    tagOpen = openTag;
                } else {
                    // Continuation of existing tag
                    tagBuffer += deltaText;
                }
            }
        } else {
            // No tags found
            if (inTag) {
                // Check if this completes a previous tag
                const closeTag = TAG_CLOSE_MAP[tagOpen];
                const closeIdx = deltaText.indexOf(closeTag);
                if (closeIdx !== -1) {
                    tagBuffer += deltaText.slice(0, closeIdx + closeTag.length);
                    parseAndEmitTag(tagBuffer);
                    tagBuffer = deltaText.slice(closeIdx + closeTag.length);
                    inTag = false;
                } else {
                    tagBuffer += deltaText;
                }
            } else {
                tagBuffer += deltaText;
            }
        }
    }

    for await (const choice of openaiStream) {
        const delta = choice.choices[0]?.delta;
        if (!delta) continue;

        // -- Thinking blocks --
        const reasoning = (delta as any).reasoning;
        if (reasoning) {
            if (!inThinking) {
                const thinkingBlock: { type: "text"; text: string } = {
                    type: "text",
                    text: reasoning,
                };
                output.content.push(thinkingBlock);
                thinkingIndex = output.content.length - 1;

                stream.push({
                    type: "content",
                    contentIndex: thinkingIndex,
                    delta: thinkingBlock,
                    partial: true,
                });

                inThinking = true;
            } else {
                const lastThinking = output.content[thinkingIndex] as {
                    type: "text";
                    text: string;
                };
                lastThinking.text += reasoning;

                stream.push({
                    type: "content",
                    contentIndex: thinkingIndex,
                    delta: { type: "text" as const, text: reasoning },
                    partial: true,
                });
            }
            continue;
        }

        // -- Native tool_calls (OpenAI format) --
        if (delta.tool_calls) {
            gotNativeToolCalls = true;
            for (const toolCallDelta of delta.tool_calls) {
                if (toolCallDelta.index !== undefined) {
                    const idx = toolCallDelta.index;
                    let entry = nativeToolCalls.get(idx);
                    if (!entry && toolCallDelta.id) {
                        entry = {
                            id: toolCallDelta.id,
                            name: "",
                            arguments: "",
                        };
                        nativeToolCalls.set(idx, entry);
                    }

                    if (entry) {
                        if (toolCallDelta.function_call?.name) {
                            entry.name += toolCallDelta.function_call.name;
                        }
                        if (toolCallDelta.function_call?.arguments) {
                            entry.arguments +=
                                toolCallDelta.function_call.arguments;
                        }

                        // Emit complete tool calls
                        if (
                            toolCallDelta.function_call?.name &&
                            toolCallDelta.function_call?.arguments
                        ) {
                            let args: Record<string, unknown> = {};
                            try {
                                args = JSON.parse(entry.arguments);
                            } catch {
                                args = {};
                            }

                            const toolCall: ToolCall = {
                                type: "function",
                                id: entry.id,
                                function: {
                                    name: entry.name,
                                    arguments: args,
                                },
                            };

                            const idx = output.content.length;
                            output.content.push(toolCall);

                            stream.push({
                                type: "content",
                                contentIndex: idx,
                                partial: true,
                            });

                            stream.push({
                                type: "content",
                                contentIndex: idx,
                                delta: toolCall,
                                partial: true,
                            });

                            stream.push({
                                type: "content",
                                contentIndex: idx,
                                partial: false,
                            });
                        }
                    }
                }
            }
            continue;
        }

        // -- Regular text content --
        const text = delta.content;
        if (text) {
            if (!inText) {
                const textBlock: { type: "text"; text: string } = {
                    type: "text",
                    text: "",
                };
                output.content.push(textBlock);
                textIndex = output.content.length - 1;

                stream.push({
                    type: "content",
                    contentIndex: textIndex,
                    delta: textBlock,
                    partial: true,
                });

                inText = true;
            }

            if (inTag) {
                processContent(text);
            } else {
                tagBuffer += text;
                const trailing = trailingTagPrefixLen(tagBuffer);
                if (trailing > 0) {
                    // Hold back potential partial tag
                    const safeLen = tagBuffer.length - trailing;
                    const holdBack = tagBuffer.slice(safeLen);
                    tagBuffer = tagBuffer.slice(0, safeLen);
                    processContent(tagBuffer);
                    tagBuffer = holdBack;
                } else {
                    processContent(tagBuffer);
                    tagBuffer = "";
                }
            }

            outputTokenCount++;
        }
    }

    // -- Stream completion --
    flushText();
    closeText();

    if (inTag && tagBuffer) {
        // Unclosed tag at end of stream - treat as text
        if (inText) {
            const lastText = output.content[textIndex] as {
                type: "text";
                text: string;
            };
            lastText.text += tagBuffer;

            stream.push({
                type: "content",
                contentIndex: textIndex,
                content: lastText,
                partial: false,
            });
        }
    }

    // Update usage with actual token counts
    output.usage = {
        input: inputTokenCount,
        output: outputTokenCount,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: inputTokenCount + outputTokenCount,
    };

    const choice = openaiStream.getFinalChoice();
    if (choice) {
        const mapped = mapFinishReason(choice.finish_reason);
        if (mapped) {
            stream.push({
                type: "finish",
                reason: mapped.reason,
                message: mapped.message,
            });
        }
    }

    return yield* stream;
}

// =============================================================================
// Finish reason mapping
// =============================================================================

function mapFinishReason(
    reason: string | null | undefined,
): { reason: string; message: string } | null {
    switch (reason) {
        case "stop":
            return { reason: "complete", message: "Model finished naturally" };
        case "length":
            return {
                reason: "length",
                message: "Model hit max tokens (try increasing maxTokens)",
            };
        case "content_filter":
            return {
                reason: "safety",
                message: "Content filtered by safety system",
            };
        case "tool_calls":
            return {
                reason: "tool_calls",
                message: "Model requested tool calls",
            };
        case "function_call":
            return {
                reason: "tool_calls",
                message: "Model requested function call",
            };
        default:
            return null;
    }
}

// =============================================================================
// Provider handler
// =============================================================================

interface ErrorRateEntry {
    model: string;
    errors: number;
    requests: number;
}

type ErrorRatesResponse = ErrorRateEntry[];

async function fetchErrorRates(apiKey: string): Promise<ErrorRatesResponse> {
    const response = await fetch("https://featherless.ai/api/error-rates", {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });
    return response.json();
}

function classifyHealth(
    errorRate: number,
): "healthy" | "degraded" | "unhealthy" {
    if (errorRate < 0.01) return "healthy";
    if (errorRate < 0.05) return "degraded";
    return "unhealthy";
}

export default async function handler(api: ExtensionAPI) {
    const baseUrl =
        api.getFlag("featherlessBaseUrl") || "https://api.featherless.ai/v1";
    const apiKey = api.getFlag("featherlessApiKey");

    if (!apiKey) {
        api.auth.registerOAuth({
            name: "featherless",
            key: {
                message: "Connect to Featherless AI",
                placeholder: "Paste your Featherless API key",
            },
            access: {
                url: "https://featherless.ai/api/auth/token",
                method: "POST",
                body: { grant_type: "api_key", api_key: "{{input}}" },
                map: (data: any) => ({
                    apiKey: data.access_token,
                    expires: Date.now() + data.expires_in * 1000,
                }),
            },
            refresh: {
                url: "https://featherless.ai/api/auth/refresh",
                method: "POST",
                body: { refresh_token: "{{refreshToken}}" },
                map: (data: any) => ({
                    apiKey: data.access_token,
                    expires: Date.now() + data.expires_in * 1000,
                }),
            },
        });
    }

    const errorRates = await fetchErrorRates(apiKey).catch(() => []);
    const classBuckets: Record<string, number> = {
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
    };
    if (Array.isArray(errorRates)) {
        for (const entry of errorRates) {
            const health = classifyHealth(entry.errors / entry.requests);
            classBuckets[health]++;
        }
    }

    const meta: Record<
        string,
        { family: string; modelClass: string; concurrencyCost: number }
    > = {};
    for (const [id, data] of Object.entries(MODEL_META)) {
        meta[id] = data;
    }

    const existing = api.models.getProviderModels("featherless");
    const models: ProviderModelConfig[] = [];

    for (const config of FEATHERLESS_MODELS) {
        const existingConfig = existing.find((m) => m.id === config.id);
        if (existingConfig) {
            models.push(existingConfig);
        } else {
            models.push({
                ...config,
                api: "openai-completions",
                provider: "featherless",
                baseUrl,
                credentials: { apiKey },
                streamSimple,
                metadata: meta[config.id],
            });
        }
    }

    // Sort by concurrency cost (cheapest first)
    models.sort((a, b) => {
        const aCost = meta[a.id]?.concurrencyCost || 1;
        const bCost = meta[b.id]?.concurrencyCost || 1;
        return aCost - bCost;
    });

    // Add concurrency limits based on model size
    const lines: string[] = [];
    const entries: Array<{
        model: string;
        cost: number;
        recent: number[];
        last24: number[];
    }> = [];

    for (const model of models) {
        const cc = meta[model.id]?.concurrencyCost || 1;
        entries.push({
            model: model.id,
            cost: cc,
            recent: new Array(5).fill(0),
            last24: new Array(24).fill(0),
        });
    }

    const recent = entries.map(
        (e) => e.recent.reduce((a, b) => a + b, 0) / e.recent.length,
    );
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const health = classifyHealth(avgRecent);

    const last24 = entries.map(
        (e) => e.last24.reduce((a, b) => a + b, 0) / e.last24.length,
    );
    const avg24h = last24.reduce((a, b) => a + b, 0) / last24.length;
    const pctRecent =
        (recent.filter((r) => r > 0.1).length / recent.length) * 100;
    const pct24h = (last24.filter((r) => r > 0.1).length / last24.length) * 100;

    const allImpaired =
        health !== "healthy" || avg24h > 0.05 || pctRecent > 10 || pct24h > 5;

    api.models.registerProvider({
        id: "featherless",
        name: "Featherless AI",
        description: allImpaired
            ? "Featherless AI (degraded performance)"
            : "Featherless AI - Fast, reliable, and cost-effective inference",
        models,
        concurrencyCost: 1,
    });
}
