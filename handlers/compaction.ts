import type { Context, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { serializeConversation, convertToLlm } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "fs";
import { PROVIDER, getApiKey } from "./shared";

const summaryPrompt = readFileSync("./summaryPrompt.txt").toString();
const MAX_SUMMARY_TOKENS = Math.floor(0.8 * 16384); // 13107

export function registerCompaction(pi: ExtensionAPI) {
    pi.on("session_before_compact", async (event, ctx) => {
        const model = ctx.model;
        if (!model || model.provider !== PROVIDER) return;

        const apiKey = await getApiKey(ctx);
        if (!apiKey) return;

        const { preparation, signal } = event;
        const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

        const conversationText = serializeConversation(convertToLlm([...messagesToSummarize, ...turnPrefixMessages]));
        const previousContext = previousSummary ? `\n\nPrevious session summary for context:\n${previousSummary}` : "";

        const messages: Context["messages"] = [{
            role: "user",
            content: [{ type: "text", text: `${summaryPrompt}${previousContext}\n\n${conversationText}` }],
            timestamp: Date.now(),
        }];

        try {
            const response = await completeSimple(
                model as Model<any>,
                { messages },
                { apiKey, maxTokens: MAX_SUMMARY_TOKENS, signal },
            );

            const summary = response.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");

            if (!summary.trim()) return;

            return { compaction: { summary, firstKeptEntryId, tokensBefore } };
        } catch {
            return;
        }
    });
}
