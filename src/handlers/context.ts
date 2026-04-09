import {
    buildSessionContext,
    type ExtensionAPI,
    type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getRealContextLimit, getModelClass } from "../models";
import { tokenizeBatch, extractText, clearTokenCache } from "../tokenize";
import { PROVIDER, getApiKey } from "./shared";
import { handleApiError } from "./concurrency";

// Models that return function calls as text instead of tool_calls
// Need to be parsed from <function>...</function> or <tool_call> XML tags
const MODELS_NEED_TOOL_CALL_PARSING = new Set([
    "qrwkv-72b-32k",
    "qrwkv-32b-32k",
    "qwen3-32b",
]);

/**
 * Parse tool calls from text content for models that return function calls
 * in XML format instead of proper tool_calls API responses.
 * Formats:
 * - <function>{"name": "ls", "arguments": {"path": "/tmp"}}</function>
 * - <tool_call>{"name": "ls", "arguments": {...}}</tool_call>
 */
function parseToolCallsFromText(
    text: string,
): Array<{ id: string; name: string; arguments: Record<string, any> }> | null {
    const results = [];

    // Format 1: <function>{...}</function>
    const regex1 = /<function>\s*(\{.*?\})\s*<\/function>/gs;
    for (const match of [...text.matchAll(regex1)]) {
        try {
            const data = JSON.parse(match[1]);
            if (data.name && data.arguments !== undefined) {
                results.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    name: data.name,
                    arguments: typeof data.arguments === 'string'
                        ? JSON.parse(data.arguments)
                        : data.arguments,
                });
            }
        } catch {
            // Skip invalid JSON
        }
    }

    // Format 2: <tool_call>{...}</tool_call>
    const regex2 = /<tool_call>\s*(\{.*?\})\s*<\/tool_call>/gs;
    for (const match of [...text.matchAll(regex2)]) {
        try {
            const data = JSON.parse(match[1]);
            if (data.name && data.arguments !== undefined) {
                results.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    name: data.name,
                    arguments: typeof data.arguments === 'string'
                        ? JSON.parse(data.arguments)
                        : data.arguments,
                });
            }
        } catch {
            // Skip invalid JSON
        }
    }

    return results.length > 0 ? results : null;
}

// Increased threshold: only call tokenize API after 10k new characters.
// This significantly reduces turn latency by avoiding API stalls.
const CHAR_CHECK_THRESHOLD = 10000;
const COMPACTION_THRESHOLD_FACTOR = 0.7;

const tracker = new Map<
    string,
    { charsSinceLastCheck: number; lastTokenCount: number }
>();

async function countTokens(
    modelId: string,
    messages: any[],
    apiKey: string | undefined,
): Promise<number> {
    const baseModelName = modelId.split("/").pop() || modelId;
    const texts = messages.map(extractText);
    try {
        const counts = await tokenizeBatch(baseModelName, texts, apiKey);
        return counts.reduce((sum, count) => sum + count, 0);
    } catch {
        return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
    }
}

/**
 * Unified function to update character counts, recount tokens if necessary,
 * and trigger proactive compaction if context usage exceeds threshold.
 */
async function syncAndCheckCompaction(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    options?: { charsAdded?: number; messagesOverride?: any[] },
) {
    const model = ctx.model;
    if (model?.provider !== PROVIDER) return;

    const realContextWindow = getRealContextLimit(model.id);
    if (!realContextWindow) return;

    const sessionFile = ctx.sessionManager.getSessionFile()!;
    let entry = tracker.get(sessionFile) || {
        charsSinceLastCheck: 0,
        lastTokenCount: 0,
    };

    if (options?.charsAdded) {
        entry.charsSinceLastCheck += options.charsAdded;
    }

    // Force recount if it's a model request (messagesOverride) or we hit the char threshold
    const needsRecount =
        !entry.lastTokenCount ||
        entry.charsSinceLastCheck >= CHAR_CHECK_THRESHOLD ||
        options?.messagesOverride !== undefined;

    if (needsRecount) {
        const apiKey = await getApiKey(ctx);
        const msgs =
            options?.messagesOverride ??
            buildSessionContext(
                ctx.sessionManager.getEntries(),
                ctx.sessionManager.getLeafId(),
            ).messages;

        if (msgs.length > 0) {
            try {
                const count = await countTokens(model.id, msgs, apiKey);
                entry = {
                    charsSinceLastCheck: 0,
                    lastTokenCount: count,
                };
            } catch (err) {
                handleApiError(err);
            }
        }
    }

    tracker.set(sessionFile, entry);

    if (
        entry.lastTokenCount >
        realContextWindow * COMPACTION_THRESHOLD_FACTOR
    ) {
        ctx.compact({
            keepRecentTokens: Math.floor(realContextWindow * 0.4),
            onComplete: () => {
                pi.sendUserMessage("Continue", { deliverAs: "followUp" });
            },
        } as any);
    }
}

export function registerContextTracking(pi: ExtensionAPI) {
    pi.on("session_start", async () => {
        clearTokenCache();
        tracker.clear();
    });

    pi.on("before_provider_request", async (event, ctx) => {
        const messagesOverride = (event.payload as any)?.messages;
        await syncAndCheckCompaction(pi, ctx, { messagesOverride });
    });

    pi.on("tool_result", async (event, ctx) => {
        let charsAdded = 0;
        for (const block of event.content ?? []) {
            if (block.type === "text" && block.text) {
                charsAdded += block.text.length;
            }
        }
        await syncAndCheckCompaction(pi, ctx, { charsAdded });
    });

    pi.on("turn_end", async (_event, ctx) => {
        // Only check at turn end, not during tool calls/messages
        // to minimize mid-conversation latency.
        await syncAndCheckCompaction(pi, ctx);
    });

    // Parse tool calls from text content for models that don't return proper tool_calls
    pi.on("message_end", async (event, ctx) => {
        const model = ctx.model;
        if (!model || model.provider !== PROVIDER) return;

        const modelClass = getModelClass(model.id);
        if (!modelClass || !MODELS_NEED_TOOL_CALL_PARSING.has(modelClass)) return;

        // Only process assistant messages
        if (event.message?.role !== "assistant") return;

        // Check if message already has tool calls
        const hasToolCalls = event.message.content?.some(
            (block: any) => block.type === "toolCall"
        );
        if (hasToolCalls) return;

        // Parse tool calls from text blocks
        const newContent: any[] = [];
        let foundToolCalls = false;

        for (const block of event.message.content ?? []) {
            if (block.type === "text" && block.text) {
                const parsed = parseToolCallsFromText(block.text);
                if (parsed && parsed.length > 0) {
                    // Convert to toolCall blocks
                    for (const tc of parsed) {
                        newContent.push({
                            type: "toolCall",
                            id: tc.id,
                            name: tc.name,
                            arguments: tc.arguments,
                        });
                    }
                    foundToolCalls = true;
                    // Skip the text block (it contained only function calls)
                    continue;
                }
            }
            newContent.push(block);
        }

        // Update message if tool calls were found
        if (foundToolCalls) {
            event.message.content = newContent;
            event.message.stopReason = "toolUse" as any;
        }
    });
}
