import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getRealContextLimit } from "../models";
import { tokenize, extractText, clearTokenCache } from "../tokenize";
import { PROVIDER, getApiKey } from "./shared";
import { handleApiError } from "./concurrency";

// Characters added since last accurate API token count.
// We only call the tokenize API again once this exceeds the threshold.
const CHAR_CHECK_THRESHOLD = 10000;

const tracker = new Map<string, { charsSinceLastCheck: number; lastTokenCount: number }>();

async function countTokens(modelId: string, messages: any[], apiKey: string | undefined): Promise<number> {
    let total = 0;
    for (const msg of messages) {
        const text = extractText(msg);
        if (text) {
            try { total += await tokenize(modelId, text, apiKey); }
            catch { total += Math.ceil(text.length / 4); }
        }
    }
    return total;
}

export function registerContextTracking(pi: ExtensionAPI) {
    pi.on("session_start", async () => {
        clearTokenCache();
        tracker.clear();
    });

    pi.on("before_provider_request", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const realContextWindow = getRealContextLimit(model.id);
        if (!realContextWindow) return;

        const sessionFile = ctx.sessionManager.getSessionFile()!;
        const entry = tracker.get(sessionFile);

        if (entry && entry.lastTokenCount > 0 && entry.charsSinceLastCheck < CHAR_CHECK_THRESHOLD) {
            return;
        }

        const apiKey = await getApiKey(ctx);
        const messages = (event.payload as any)?.messages ?? [];

        try {
            const count = await countTokens(model.id, messages, apiKey);
            tracker.set(sessionFile, { charsSinceLastCheck: 0, lastTokenCount: count });
        } catch (err) {
            handleApiError(err);
        }
    });

    pi.on("tool_result", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const realContextWindow = getRealContextLimit(model.id);
        if (!realContextWindow) return;

        const sessionFile = ctx.sessionManager.getSessionFile()!;
        const entry = tracker.get(sessionFile) ?? { charsSinceLastCheck: 0, lastTokenCount: 0 };

        let charsAdded = 0;
        for (const block of (event.content ?? [])) {
            if (block.type === "text" && block.text) charsAdded += block.text.length;
        }
        entry.charsSinceLastCheck += charsAdded;
        tracker.set(sessionFile, entry);

        if (entry.charsSinceLastCheck < CHAR_CHECK_THRESHOLD) return;

        const messages = ctx.sessionManager
            .getBranch()
            .filter((e: any) => e.type === "message")
            .map((e: any) => e.message);

        if (messages.length === 0) return;

        const apiKey = await getApiKey(ctx);
        try {
            const count = await countTokens(model.id, messages, apiKey);
            entry.lastTokenCount = count;
            entry.charsSinceLastCheck = 0;
            tracker.set(sessionFile, entry);
        } catch (err) {
            handleApiError(err);
        }
    });
}
