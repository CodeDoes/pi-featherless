/**
 * Test Tool for pi-featherless Extension
 *
 * Tests the Featherless API directly with GLM-5.
 * Each test has a 20 second timeout.
 *
 * Commands:
 *   /test-ping     - Ping the API to check connectivity
 *   /test-chat     - Test a simple chat completion
 *   /test-tools    - Test tool calling capability
 *   /test-context  - Test context window calculation
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const TIMEOUT_MS = 20000;
const BASE_URL = "https://api.featherless.ai/v1";
const MODEL_ID = "zai-org/GLM-5";

async function withTimeout<T>(promise: Promise<T>, ms: number = TIMEOUT_MS): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
        promise.then(
            (result) => { clearTimeout(timer); resolve(result); },
            (error) => { clearTimeout(timer); reject(error); }
        );
    });
}

export default function testFeatherlessExtension(pi: ExtensionAPI) {
    // /test-ping - Check API connectivity
    pi.registerCommand("test-ping", {
        description: "Ping Featherless API (20s timeout)",
        handler: async (_args, ctx) => {
            ctx.ui.setStatus("test", "🏓 Pinging API...");

            try {
                const apiKey = process.env.FEATHERLESS_API_KEY;
                if (!apiKey) {
                    return `❌ FEATHERLESS_API_KEY not set`;
                }

                const start = Date.now();
                const response = await withTimeout(
                    fetch(`${BASE_URL}/models`, {
                        headers: { "Authorization": `Bearer ${apiKey}` }
                    })
                );

                const elapsed = Date.now() - start;

                if (!response.ok) {
                    const text = await response.text();
                    return `❌ API error ${response.status}:\n${text.slice(0, 500)}`;
                }

                const data = await response.json();
                const modelCount = data.data?.length ?? 0;

                // Find our model
                const ourModels = (data.data || []).filter(m =>
                    m.id.includes("GLM-5") || m.id.includes("GLM-4.7")
                );

                ctx.ui.setStatus("test", undefined);
                return `✅ **API reachable**\n\n` +
                    `- Time: ${elapsed}ms\n` +
                    `- Total models: ${modelCount}\n` +
                    `- GLM models found: ${ourModels.map(m => m.id).join(", ") || "none"}`;
            } catch (error) {
                ctx.ui.setStatus("test", undefined);
                return `❌ Ping failed: ${error}`;
            }
        },
    });

    // /test-chat - Test a simple chat completion
    pi.registerCommand("test-chat", {
        description: "Test a simple chat completion with GLM-5 (20s timeout)",
        handler: async (_args, ctx) => {
            ctx.ui.setStatus("test", "🤖 Testing chat completion...");

            try {
                const apiKey = process.env.FEATHERLESS_API_KEY;
                if (!apiKey) {
                    return `❌ FEATHERLESS_API_KEY not set`;
                }

                const start = Date.now();
                const response = await withTimeout(
                    fetch(`${BASE_URL}/chat/completions`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: MODEL_ID,
                            messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
                            max_tokens: 20
                        })
                    })
                );

                const elapsed = Date.now() - start;

                if (!response.ok) {
                    const text = await response.text();
                    return `❌ Request failed ${response.status}:\n${text.slice(0, 500)}`;
                }

                const data = await response.json();
                const content = data.choices?.[0]?.message?.content || "(no content)";
                const usage = data.usage || {};

                ctx.ui.setStatus("test", undefined);
                return `✅ **Chat completion succeeded**\n\n` +
                    `- Model: ${MODEL_ID}\n` +
                    `- Time: ${elapsed}ms\n` +
                    `- Response: "${content}"\n` +
                    `- Usage: ${JSON.stringify(usage)}`;
            } catch (error) {
                ctx.ui.setStatus("test", undefined);
                return `❌ Chat test failed: ${error}`;
            }
        },
    });

    // /test-tools - Test tool calling
    pi.registerCommand("test-tools", {
        description: "Test tool calling with GLM-5 (20s timeout)",
        handler: async (_args, ctx) => {
            ctx.ui.setStatus("test", "🔧 Testing tool calling...");

            try {
                const apiKey = process.env.FEATHERLESS_API_KEY;
                if (!apiKey) {
                    return `❌ FEATHERLESS_API_KEY not set`;
                }

                const start = Date.now();
                const response = await withTimeout(
                    fetch(`${BASE_URL}/chat/completions`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: MODEL_ID,
                            messages: [{ role: "user", content: "What is 2+2? Use the calculator tool." }],
                            max_tokens: 100,
                            tools: [{
                                type: "function",
                                function: {
                                    name: "calculator",
                                    description: "Perform arithmetic",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            expression: { type: "string", description: "Math expression" }
                                        },
                                        required: ["expression"]
                                    }
                                }
                            }]
                        })
                    })
                );

                const elapsed = Date.now() - start;

                if (!response.ok) {
                    const text = await response.text();
                    return `❌ Request failed ${response.status}:\n${text.slice(0, 500)}`;
                }

                const data = await response.json();
                const choice = data.choices?.[0];
                const message = choice?.message || {};
                const toolCalls = message.tool_calls || [];

                ctx.ui.setStatus("test", undefined);
                return `✅ **Tool calling test**\n\n` +
                    `- Model: ${MODEL_ID}\n` +
                    `- Time: ${elapsed}ms\n` +
                    `- Tool calls: ${toolCalls.length}\n` +
                    `- Content: "${message.content || "(none)"}"\n` +
                    `- Tool calls: ${JSON.stringify(toolCalls, null, 2)}`;
            } catch (error) {
                ctx.ui.setStatus("test", undefined);
                return `❌ Tool test failed: ${error}`;
            }
        },
    });

    // /test-context - Test context window calculation
    pi.registerCommand("test-context", {
        description: "Test context window safety factor (20s timeout)",
        handler: async (_args, ctx) => {
            const apiKey = process.env.FEATHERLESS_API_KEY;
            if (!apiKey) {
                return `❌ FEATHERLESS_API_KEY not set`;
            }

            try {
                // Test the /models endpoint to get API-reported context
                const response = await withTimeout(
                    fetch(`${BASE_URL}/models`, {
                        headers: { "Authorization": `Bearer ${apiKey}` }
                    })
                );

                if (!response.ok) {
                    return `❌ API error ${response.status}`;
                }

                const data = await response.json();
                const glm5 = data.data?.find((m: any) => m.id === MODEL_ID);
                const apiContext = glm5?.context_length ?? "unknown";

                // Now test our getModelConfig
                const { getModelConfig, MODELS, getRealContextLimit } = await import("../../src/models.ts");
                const entry = MODELS.find(m => m.id === MODEL_ID);
                if (!entry) {
                    return `❌ Model ${MODEL_ID} not found in MODELS`;
                }

                const config = getModelConfig(entry);
                const rawLimit = getRealContextLimit(MODEL_ID);

                if (!rawLimit) {
                    return `❌ Could not get raw limit for ${MODEL_ID}`;
                }

                const issues: string[] = [];
                
                // Check 1: contextWindow should be less than raw limit (safety factor applied)
                if (config.contextWindow >= rawLimit) {
                    issues.push(`contextWindow (${config.contextWindow}) >= rawLimit (${rawLimit}) - safety factor not applied!`);
                }

                // Check 2: maxTokens should be the raw limit
                if (config.maxTokens !== rawLimit) {
                    issues.push(`maxTokens (${config.maxTokens}) != rawLimit (${rawLimit})`);
                }

                // Check 3: contextWindow should be roughly 75% of raw limit
                const expectedMin = Math.floor(rawLimit * 0.7);
                const expectedMax = Math.floor(rawLimit * 0.8);
                if (config.contextWindow < expectedMin || config.contextWindow > expectedMax) {
                    issues.push(`contextWindow (${config.contextWindow}) not in expected range [${expectedMin}, ${expectedMax}] (70-80% of raw limit)`);
                }

                if (issues.length > 0) {
                    return `❌ **Context window check failed**\n\n` +
                        issues.map(i => `- ${i}`).join("\n") +
                        `\n\n**Config:**\n` +
                        `- Model: ${MODEL_ID}\n` +
                        `- Model class: ${entry.model_class}\n` +
                        `- Raw limit: ${rawLimit}\n` +
                        `- contextWindow: ${config.contextWindow}\n` +
                        `- maxTokens: ${config.maxTokens}`;
                }

                return `✅ **Context window check passed**\n\n` +
                    `- Model: ${MODEL_ID}\n` +
                    `- Model class: ${entry.model_class}\n` +
                    `- API context_length: ${apiContext}\n` +
                    `- Raw limit: ${rawLimit}\n` +
                    `- contextWindow: ${config.contextWindow} (reduced by safety factor)\n` +
                    `- maxTokens: ${config.maxTokens} (raw limit for output)`;
            } catch (error) {
                return `❌ Context test failed: ${error}`;
            }
        },
    });
}