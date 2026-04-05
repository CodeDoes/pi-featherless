/**
 * Tokenization utilities for Featherless AI.
 *
 * Uses the Featherless /v1/tokenize API endpoint for accurate token counting.
 * Results are cached in memory to minimize API calls.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const TOKENIZE_URL = "https://api.featherless.ai/v1/tokenize";

/**
 * In-memory cache for token counts.
 * Key: `${model}:${text}` -> token count
 */
const tokenCache = new Map<string, number>();

/**
 * Maximum cache size (entries). LRU eviction when exceeded.
 */
const MAX_CACHE_SIZE = 10000;

/**
 * Get the API key for Featherless from the model registry.
 */
function getApiKey(pi: ExtensionAPI): string | undefined {
    // Try to get API key from the model registry
    const key = pi.getApiKey?.("featherless-ai");
    if (key) return key;

    // Fall back to environment variable
    return process.env.FEATHERLESS_API_KEY;
}

/**
 * Compute a cache key for a model + text combination.
 */
function cacheKey(model: string, text: string): string {
    return `${model}:${text}`;
}

/**
 * Tokenize text using the Featherless API.
 *
 * @param model - The model ID to use for tokenization
 * @param text - The text to tokenize
 * @param apiKey - Optional API key (will be resolved if not provided)
 * @returns The number of tokens
 */
export async function tokenize(
    model: string,
    text: string,
    apiKey?: string
): Promise<number> {
    // Check cache first
    const key = cacheKey(model, text);
    const cached = tokenCache.get(key);
    if (cached !== undefined) {
        return cached;
    }

    // Make API request
    const response = await fetch(TOKENIZE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, text }),
    });

    if (!response.ok) {
        // Fall back to estimation on error
        const body = await response.text().catch(() => "unknown");
        console.warn(`Tokenize API error: ${response.status} ${response.statusText}`, body);
        return estimateTokens(text);
    }

    const data = await response.json() as { count?: number; tokens?: number[] };
    
    // API returns either {count: number} or {tokens: number[]}
    const count = data.count ?? (data.tokens?.length ?? 0);

    // Cache the result (with LRU eviction)
    if (tokenCache.size >= MAX_CACHE_SIZE) {
        // Delete oldest entries (first 10%)
        const keysToDelete = Array.from(tokenCache.keys()).slice(0, Math.floor(MAX_CACHE_SIZE * 0.1));
        for (const k of keysToDelete) {
            tokenCache.delete(k);
        }
    }
    tokenCache.set(key, count);

    return count;
}

/**
 * Tokenize multiple texts in batch (more efficient for context estimation).
 *
 * @param model - The model ID to use for tokenization
 * @param texts - Array of texts to tokenize
 * @param apiKey - Optional API key
 * @returns Array of token counts (same order as input)
 */
export async function tokenizeBatch(
    model: string,
    texts: string[],
    apiKey?: string
): Promise<number[]> {
    // Check cache for each text
    const results: number[] = new Array(texts.length);
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
        const key = cacheKey(model, texts[i]);
        const cached = tokenCache.get(key);
        if (cached !== undefined) {
            results[i] = cached;
        } else {
            uncached.push({ index: i, text: texts[i] });
        }
    }

    // If all cached, return early
    if (uncached.length === 0) {
        return results;
    }

    // Fetch uncached texts (sequential to avoid rate limits)
    for (const { index, text } of uncached) {
        try {
            const count = await tokenize(model, text, apiKey);
            results[index] = count;
        } catch {
            // Fall back to estimation
            results[index] = estimateTokens(text);
        }
    }

    return results;
}

/**
 * Simple heuristic token estimation.
 *
 * Uses content-type-aware estimation:
 * - Bash output (ls, file listings): ~1.8 chars/token
 * - Default: ~3.2 chars/token (measured average across content types)
 *
 * This is more accurate than chars/4 which underestimates by ~27%.
 */
export function estimateTokens(text: string, defaultCharsPerToken = 3.2): number {
    const chars = text.length;
    if (chars === 0) return 0;

    // Detect bash output by looking for file permission patterns
    // Lines like: "drwxr-xr-x  2 kit kit  4096 Apr  5 10:23 ."
    // or: "-rw-r--r--  1 kit kit 12345 Apr  5 10:22 index.ts"
    const lines = text.split('\n');
    const permissionPattern = /^[d-][rwx-]{9}\s/;
    const matchingLines = lines.filter(line => permissionPattern.test(line));
    
    // If more than half the lines look like file listings, treat as bash output
    if (matchingLines.length > 0 && matchingLines.length >= lines.length * 0.5) {
        return Math.ceil(chars / 1.8);
    }

    return Math.ceil(chars / defaultCharsPerToken);
}

/**
 * Extract text content from a message for token counting.
 */
export function extractText(message: any): string {
    switch (message.role) {
        case "user": {
            const content = message.content;
            if (typeof content === "string") {
                return content;
            }
            if (Array.isArray(content)) {
                return content
                    .filter((block: any) => block.type === "text")
                    .map((block: any) => block.text || "")
                    .join("");
            }
            return "";
        }
        case "assistant": {
            const parts: string[] = [];
            for (const block of message.content || []) {
                if (block.type === "text") {
                    parts.push(block.text || "");
                } else if (block.type === "thinking") {
                    parts.push(block.thinking || "");
                } else if (block.type === "toolCall") {
                    parts.push(block.name || "");
                    parts.push(JSON.stringify(block.arguments || {}));
                }
            }
            return parts.join("");
        }
        case "toolResult": {
            const content = message.content;
            if (typeof content === "string") {
                return content;
            }
            if (Array.isArray(content)) {
                return content
                    .filter((block: any) => block.type === "text")
                    .map((block: any) => block.text || "")
                    .join("");
            }
            return "";
        }
        default:
            return "";
    }
}

/**
 * Count tokens for a single message using the Featherless API.
 *
 * @param model - The model ID to use
 * @param message - The message to count tokens for
 * @param apiKey - Optional API key
 * @returns Token count for the message
 */
export async function countMessageTokens(
    model: string,
    message: any,
    apiKey?: string
): Promise<number> {
    const text = extractText(message);
    if (!text) return 0;
    return tokenize(model, text, apiKey);
}

/**
 * Count tokens for multiple messages.
 *
 * @param model - The model ID to use
 * @param messages - Array of messages
 * @param apiKey - Optional API key
 * @returns Total token count
 */
export async function countMessagesTokens(
    model: string,
    messages: any[],
    apiKey?: string
): Promise<number> {
    const counts = await tokenizeBatch(
        model,
        messages.map(extractText),
        apiKey
    );
    return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Clear the token cache (useful for testing or memory management).
 */
export function clearTokenCache(): void {
    tokenCache.clear();
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; maxSize: number } {
    return {
        size: tokenCache.size,
        maxSize: MAX_CACHE_SIZE,
    };
}