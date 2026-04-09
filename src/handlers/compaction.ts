import type { Context } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm } from "@mariozechner/pi-coding-agent";
import { PROVIDER, getApiKey } from "./shared";

/**
 * Simple Compaction Handler for Featherless AI.
 *
 * The model already has the full context in memory when compaction triggers.
 * Just ask it to summarize - no chunking, stripping, or separate model needed.
 * This is faster and preserves more information than complex preprocessing.
 */

const SUMMARY_PROMPT = `Summarize the conversation so far. Focus on:
- Files read/modified and key findings
- Errors encountered and resolutions
- Decisions made and reasoning
- Current task state and next steps

Be concise but preserve essential context for continuing the work.`;

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

        // Convert messages to LLM format
        const llmMessages = convertToLlm([...messagesToSummarize, ...turnPrefixMessages]);
        
        // Build the summarization request
        const messages: Context["messages"] = [
            ...llmMessages,
            {
                role: "user" as const,
                content: [{ type: "text" as const, text: SUMMARY_PROMPT }],
                timestamp: Date.now(),
            },
        ];

        try {
            // Ask the current model to summarize (it already knows the context)
            const result = await completeSimple(
                model,
                { messages },
                { apiKey, maxTokens: 2048, signal },
            );

            const summaryText = result.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");

            if (!summaryText.trim()) return;

            // Prepend previous summary if exists
            const summary = previousSummary
                ? `## Previous Context\n${previousSummary}\n\n## Recent Activity\n${summaryText}`
                : summaryText;

            return { compaction: { summary, firstKeptEntryId, tokensBefore } };
        } catch {
            // Fall back to default compaction on error
            return;
        }
    });
}
