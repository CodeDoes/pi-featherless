#!/usr/bin/env node
/**
 * Test script for pi-featherless extension
 * 
 * Usage:
 *   npx tsx test-api.ts ping      - Test API connectivity
 *   npx tsx test-api.ts chat      - Test chat completion
 *   npx tsx test-api.ts tools     - Test tool calling
 */

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

async function testPing(apiKey: string) {
    console.log("🏓 Pinging API (simple chat)...");
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
                messages: [{ role: "user", content: "Reply with: pong" }],
                max_tokens: 10
            })
        })
    );

    const elapsed = Date.now() - start;

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const usage = data.usage || {};

    console.log(`✅ API reachable in ${elapsed}ms`);
    console.log(`   Model: ${MODEL_ID}`);
    console.log(`   Usage: ${JSON.stringify(usage)}`);
}

async function testChat(apiKey: string) {
    console.log("🤖 Testing chat completion...");
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
                max_tokens: 50
            })
        })
    );

    const elapsed = Date.now() - start;

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "(no content)";
    const reasoning = data.choices?.[0]?.message?.reasoning || "";
    const usage = data.usage || {};

    console.log(`✅ Chat completion succeeded in ${elapsed}ms`);
    console.log(`   Model: ${MODEL_ID}`);
    console.log(`   Response: "${content}"`);
    if (reasoning) console.log(`   Reasoning: "${reasoning.slice(0, 100)}..."`);
    console.log(`   Usage: ${JSON.stringify(usage)}`);
}

async function testTools(apiKey: string) {
    console.log("🔧 Testing tool calling...");
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
        throw new Error(`Request failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message || {};
    const toolCalls = message.tool_calls || [];

    console.log(`✅ Tool calling test completed in ${elapsed}ms`);
    console.log(`   Model: ${MODEL_ID}`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    console.log(`   Content: "${message.content || "(none)"}"`);
    if (toolCalls.length > 0) {
        console.log(`   Tool calls: ${JSON.stringify(toolCalls, null, 2)}`);
    }
}

async function main() {
    const apiKey = process.env.FEATHERLESS_API_KEY;
    if (!apiKey) {
        console.error("❌ FEATHERLESS_API_KEY not set");
        process.exit(1);
    }

    const command = process.argv[2] || "ping";

    try {
        switch (command) {
            case "ping":
                await testPing(apiKey);
                break;
            case "chat":
                await testChat(apiKey);
                break;
            case "tools":
                await testTools(apiKey);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                console.error("Usage: npx tsx test-api.ts [ping|chat|tools]");
                process.exit(1);
        }
    } catch (error) {
        console.error(`❌ Test failed: ${error}`);
        process.exit(1);
    }
}

main();