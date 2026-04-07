import {
    buildSessionContext,
    type ExtensionAPI,
    type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getRealContextLimit } from "../models";
import { tokenizeBatch, extractText, clearTokenCache } from "../tokenize";
import { PROVIDER, getApiKey } from "./shared";
import { handleApiError } from "./concurrency";

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
}
