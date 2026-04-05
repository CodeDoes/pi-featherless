/**
 * Featherless CLI Provider Extension
 *
 * Features:
 *   - Accurate token counting via /v1/tokenize API
 *   - Context window management with real token counts
 *   - OAuth support for easy authentication
 *   - Concurrency tracking for Featherless API
 *   - High-fidelity compaction summaries
 *
 * Usage:
 *   pi -e git:github.com/CodeDoes/pi-featherless-2
 *   # Then /login featherless-ai api key, or set FEATHERLESS_API_KEY=...
 */

import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import {
    type ExtensionAPI,
    type SessionBeforeCompactResult,
    serializeConversation,
    convertToLlm
} from "@mariozechner/pi-coding-agent";
import { MODELS, getModelConfig, getRealContextLimit, getConcurrencyUse, getModelClass } from "./models";
import { tokenize, extractText, clearTokenCache } from "./tokenize";

const BASE_URL = "https://api.featherless.ai/v1";
const PROVIDER = "featherless-ai";

/**
 * Format token count for human-readable display.
 * E.g., 1500 -> "1.5k", 2300000 -> "2.3M"
 */
function formatTokenCount(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
    return `${(count / 1000000).toFixed(1)}M`;
}

/**
 * Get the API key from environment or OAuth credentials.
 */
async function getApiKeyFromContext(ctx: any): Promise<string | undefined> {
    // Try model registry first (async method)
    if (ctx.modelRegistry) {
        const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
        if (key) return key;
    }

    // Fall back to environment
    return process.env.FEATHERLESS_API_KEY;
}

/**
 * Count tokens for messages using Featherless API.
 * Falls back to estimation if API unavailable.
 */
async function countContextTokens(
    model: string,
    messages: any[],
    apiKey: string | undefined
): Promise<number> {
    let total = 0;
    for (const msg of messages) {
        const text = extractText(msg);
        if (text) {
            try {
                total += await tokenize(model, text, apiKey);
            } catch {
                // Fallback to heuristic
                total += Math.ceil(text.length / 4);
            }
        }
    }
    return total;
}

/**
 * Track context state across tool results.
 * We track character delta and call API when threshold is exceeded.
 */
const contextTracker = new Map<string, {
    charsSinceLastCheck: number;  // Characters added since last API call
    lastTokenCount: number;       // Last accurate token count from API
}>();

/**
 * Character threshold for triggering an API token check.
 * ~10k chars = ~3k tokens (rough estimate, varies by content type)
 */
const CHAR_CHECK_THRESHOLD = 10000;

/**
 * Cache statistics for visibility.
 * Tracks cumulative cache hits and tokens saved.
 */
interface CacheStats {
    hits: number;          // Number of cache hits
    tokensSaved: number;   // Total tokens saved by caching
    lastCacheRead: number; // Last turn's cache read tokens
}
const cacheStats: CacheStats = { hits: 0, tokensSaved: 0, lastCacheRead: 0 };

/**
 * Concurrency tracking for Featherless API.
 * Tracks in-flight requests and their concurrency cost.
 */
interface ConcurrencyState {
    activeRequests: Map<string, number>;  // requestId -> concurrency cost
    totalCost: number;                     // Sum of all active request costs
    limit: number;                         // User's plan limit (from 429 errors)
}
const concurrency: ConcurrencyState = {
    activeRequests: new Map(),
    totalCost: 0,
    limit: 4,  // Default assumption; updated from 429 responses
};
let requestIdCounter = 0;

/**
 * Parse a 429 error response to extract concurrency limit.
 * Featherless returns: "Your plan limit: X units"
 */
function parse429Limit(errorText: string): number | null {
    const match = errorText.match(/plan limit:\s*(\d+)/i);
    if (match) {
        return parseInt(match[1], 10);
    }
    return null;
}

/**
 * Handle errors from Featherless API, updating concurrency state.
 */
function handleApiError(error: any): void {
    const message = error?.message || String(error);
    
    // Check for 429 concurrency limit errors
    if (message.includes('429') || message.includes('Concurrency limit')) {
        const limit = parse429Limit(message);
        if (limit !== null) {
            concurrency.limit = limit;
            console.log(`[Featherless] Updated concurrency limit from 429: ${limit}`);
        }
    }
}

export default function (pi: ExtensionAPI) {
    // Register the Featherless provider
    pi.registerProvider(PROVIDER, {
        baseUrl: BASE_URL,
        apiKey: "FEATHERLESS_API_KEY",
        api: "openai-completions",
        authHeader: true,
        models: MODELS.map(getModelConfig),
        oauth: {
            name: "Featherless AI",
            async login(callbacks) {
                callbacks.onAuth({
                    url: "https://featherless.ai/account/api-keys",
                });
                const apiKey = await callbacks.onPrompt({
                    message: "Please create an API key and paste it below.",
                });
                if (!apiKey) {
                    throw new Error("No API key provided");
                }
                return {
                    refresh: "",
                    access: apiKey,
                    expires: 60 * 60 * 24 * 360,
                };
            },
            async refreshToken(cred) {
                return { ...cred };
            },
            getApiKey: (cred) => cred.access,
        },
    });

    // Handle model selection/changes
    pi.on("model_select", async (event, ctx) => {
        const { model } = event;
        if (model.provider !== PROVIDER) {
            return;
        }
    });

    // Clear token cache and tracker on session start
    pi.on("session_start", async (_event, ctx) => {
        clearTokenCache();
        contextTracker.clear();
        // Reset cache stats for new session
        cacheStats.hits = 0;
        cacheStats.tokensSaved = 0;
        cacheStats.lastCacheRead = 0;
        // Reset concurrency tracking
        concurrency.activeRequests.clear();
        concurrency.totalCost = 0;
    });

    // Log accurate token counts before provider requests (for debugging/visibility)
    pi.on("before_provider_request", async (event, ctx) => {
        // Only process Featherless models
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const modelId = model.id;
        const modelClass = getModelClass(modelId);
        const realContextWindow = getRealContextLimit(modelId);
        
        // Track concurrency cost for this request
        if (modelClass) {
            // Check if we already have an active request for this model class to avoid double-counting
            // This can happen if before_provider_request is called multiple times for the same turn
            // We'll use the model class as a coarse lock for now, though it's not perfect
            // if multiple requests for different models of the same class are in flight.
            const cost = getConcurrencyUse(modelClass);
            
            // Check if there's already an active request with this cost from this provider
            // This is a heuristic to prevent double-counting within the same turn.
            const alreadyTracked = Array.from(concurrency.activeRequests.values()).some(c => c === cost);
            if (alreadyTracked && concurrency.totalCost > 0) {
                // Potential double-count, but we don't have a reliable way to link 
                // before_provider_request to turn_end yet without a shared ID.
                // For now, we'll just log and continue, but in a real scenario 
                // we'd want a more robust way to track individual requests.
            }

            const requestId = `req_${++requestIdCounter}`;
            concurrency.activeRequests.set(requestId, cost);
            concurrency.totalCost += cost;
            console.log(`[Featherless] Request ${requestId} started (cost: ${cost}, total: ${concurrency.totalCost}/${concurrency.limit})`);
            
            // Store requestId in event for later cleanup
            (event as any)._featherlessRequestId = requestId;
        }
        
        if (!realContextWindow) return;

        // Check if we have a cached token count from tool_result tracking
        const sessionFile = ctx.sessionManager.getSessionFile();
        const tracker = contextTracker.get(sessionFile);
        
        if (tracker && tracker.lastTokenCount > 0 && tracker.charsSinceLastCheck < CHAR_CHECK_THRESHOLD) {
            // Use cached count - it's still accurate enough
            return;
        }

        // No cached count or too many chars added - call API
        const apiKey = await getApiKeyFromContext(ctx);
        const payload = event.payload as any;
        const messages = payload?.messages || [];

        try {
            const tokenCount = await countContextTokens(modelId, messages, apiKey);
            
            // Update tracker
            contextTracker.set(sessionFile, { charsSinceLastCheck: 0, lastTokenCount: tokenCount });
            console.log(`[Featherless] Context: ${tokenCount} tokens`);
        } catch (err) {
            handleApiError(err);
        }
    });

    // Helper to release concurrency cost
    const releaseConcurrency = (modelId: string, requestId?: string) => {
        if (requestId) {
            const cost = concurrency.activeRequests.get(requestId);
            if (cost !== undefined) {
                concurrency.activeRequests.delete(requestId);
                concurrency.totalCost -= cost;
                console.log(`[Featherless] Request ${requestId} released (total: ${concurrency.totalCost}/${concurrency.limit})`);
                return true;
            }
        }

        const modelClass = getModelClass(modelId);
        if (modelClass && concurrency.totalCost > 0) {
            const cost = getConcurrencyUse(modelClass);
            // Find and remove a request with this cost (approximate fallback)
            for (const [id, c] of concurrency.activeRequests) {
                if (c === cost) {
                    concurrency.activeRequests.delete(id);
                    concurrency.totalCost -= c;
                    console.log(`[Featherless] Request ${id} completed (remaining: ${concurrency.totalCost}/${concurrency.limit})`);
                    return true;
                }
            }
        }
        return false;
    };

    // Log actual vs estimated tokens on turn completion
    pi.on("turn_end", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        releaseConcurrency(model.id);

        const message = event.message;
        const usage = message?.usage;

        if (usage) {
            // Track cache statistics
            const cacheRead = usage.cacheRead || 0;
            const cacheWrite = usage.cacheWrite || 0;
            
            if (cacheRead > 0) {
                cacheStats.hits++;
                cacheStats.tokensSaved += cacheRead;
            }
            cacheStats.lastCacheRead = cacheRead;
            
            // Log actual token usage from API response
            const parts = [
                `${usage.input} input`,
                `${usage.output} output`,
            ];
            if (cacheRead > 0) parts.push(`${cacheRead} cache read`);
            if (cacheWrite > 0) parts.push(`${cacheWrite} cache write`);
            
            console.log(`[Featherless] Token usage: ${parts.join(", ")}`);
        }
    });

    // Track context and call API periodically based on character delta
    pi.on("tool_result", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const realContextWindow = getRealContextLimit(model.id);
        if (!realContextWindow) return;

        // Get API key for accurate token counting
        const apiKey = await getApiKeyFromContext(ctx);

        // Get the tool result content to track character delta
        const result = event.result;
        let charsAdded = 0;
        if (result?.content) {
            for (const block of result.content) {
                if (block.type === "text" && block.text) {
                    charsAdded += block.text.length;
                }
            }
        }

        // Update tracker with character delta
        const sessionFile = ctx.sessionManager.getSessionFile();
        const tracker = contextTracker.get(sessionFile) || { charsSinceLastCheck: 0, lastTokenCount: 0 };
        tracker.charsSinceLastCheck += charsAdded;
        contextTracker.set(sessionFile, tracker);

        // Only call API when we've added enough characters
        if (tracker.charsSinceLastCheck < CHAR_CHECK_THRESHOLD) {
            return;
        }

        // Get all messages for accurate count
        const messages = ctx.sessionManager.getBranch()
            .filter((e: any) => e.type === "message")
            .map((e: any) => e.message);

        if (messages.length === 0) return;

        // Call API for accurate token count
        try {
            const tokenCount = await countContextTokens(model.id, messages, apiKey);
            tracker.lastTokenCount = tokenCount;
            tracker.charsSinceLastCheck = 0;  // Reset delta
            contextTracker.set(sessionFile, tracker);

            // Log context usage
            const percent = ((tokenCount / realContextWindow) * 100).toFixed(0);
            console.log(`[Featherless] Context: ${tokenCount} / ${realContextWindow} tokens (${percent}%)`);
        } catch (err) {
            handleApiError(err);
            console.warn(`[Featherless] Failed to check context tokens:`, err);
        }
    });

    // Log compaction trigger points with accurate counts
    pi.on("session_before_compact", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const preparation = event.preparation;
        const realContextWindow = getRealContextLimit(model.id);
        
        // Log estimated tokens before compaction
        console.log(`[Featherless] Compaction triggered: ${preparation.tokensBefore} estimated tokens`);
        
        // Try to get accurate count
        const apiKey = await getApiKeyFromContext(ctx);
        const messages = ctx.sessionManager.getBranch()
            .filter((e: any) => e.type === "message")
            .map((e: any) => e.message);
        
        if (messages.length > 0) {
            try {
                const accurateCount = await countContextTokens(model.id, messages, apiKey);
                const percent = realContextWindow ? ((accurateCount / realContextWindow) * 100).toFixed(1) : "?";
                console.log(`[Featherless] Accurate context: ${accurateCount} tokens (${percent}% of ${realContextWindow || "unknown"})`);
            } catch (err) {
                handleApiError(err);
                console.warn(`[Featherless] Failed to get accurate token count:`, err);
            }
        }
    });
    
    // Log compaction completion
    pi.on("session_compact", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;
        
        console.log(`[Featherless] Compaction complete (from extension: ${event.fromExtension})`);
    });

    // Custom High-Fidelity Compaction
    pi.on("session_before_compact", async (event, ctx) => {
        const model = ctx.model;
        if (!model || model.provider !== PROVIDER) return;

        const { preparation, signal } = event;
        const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

        // Ensure we always have a reserve tokens value
        const reserveTokens = 16384; 
        const maxSummaryTokens = Math.floor(0.8 * reserveTokens);

        // We'll use the current model for summarization as well, unless it's too small
        const summarizerModel = model;

        const apiKey = await getApiKeyFromContext(ctx);
        if (!apiKey) return;

        console.log(`[Featherless] High-fidelity compaction: ${formatTokenCount(tokensBefore)} tokens...`);

        // Combine for summary
        const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
        const conversationText = serializeConversation(convertToLlm(allMessages));
        const previousContext = previousSummary ? `\n\nPrevious session summary for context:\n${previousSummary}` : "";

        const summaryPrompt = `You are a technical context summarizer. Create a HIGH-FIDELITY structured summary of this conversation for another LLM to continue the work without losing track of details.

RULES:
1. Preserve ALL exact file paths, function names, and specific error messages.
2. List all files currently in the conversation's "active set" (files that were read or modified).
3. Record the CURRENT STATE of the work: what was just attempted, what succeeded, and what failed.
4. Capture KEY DECISIONS and their rationale.
5. Identify the next 3-5 concrete steps.

${previousContext}

<conversation>
${conversationText}
</conversation>

Use Markdown with clear headers (Goals, Active Files, Progress, Key Decisions, Next Steps).`;

        const messages = [
            {
                role: "user" as const,
                content: [{ type: "text" as const, text: summaryPrompt }],
                timestamp: Date.now(),
            },
        ];

        try {
            const response = await completeSimple(
                summarizerModel as Model<any>,
                { messages },
                { apiKey, maxTokens: maxSummaryTokens, signal }
            );

            const summary = response.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");

            if (!summary.trim()) return;

            // Log successful high-fidelity compaction
            console.log(`[Featherless] High-fidelity summary generated (${summary.length} chars)`);

            return {
                compaction: {
                    summary,
                    firstKeptEntryId,
                    tokensBefore,
                }
            } as SessionBeforeCompactResult;
        } catch (err) {
            console.error("[Featherless] High-fidelity compaction failed:", err);
            return; // Fall back to default
        }
    });
}