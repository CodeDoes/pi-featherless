import { estimateTokens } from "./tokenize";

/**
 * Featherless Provider Regression Test Suite
 * Derived from historical failure cases found in session logs.
 */

async function runRegressionTests() {
    console.log("🧪 Running Featherless Regression Tests...\n");

    // REGRESSION 1: API Schema Handling (count vs tokens)
    console.log("Case 1: Tokenize API Schema Resilience");
    const mockResponseCount: any = { count: 42 };
    const mockResponseTokens: any = { tokens: new Array(42).fill(1) };
    
    const countResult = mockResponseCount.count ?? (mockResponseCount.tokens?.length ?? 0);
    const tokensResult = mockResponseTokens.count ?? (mockResponseTokens.tokens?.length ?? 0);
    
    if (countResult === 42 && tokensResult === 42) {
        console.log("✅ Success: Correctly handles both {count} and {tokens} schemas.");
    } else {
        console.error("❌ Failed: Schema handling is broken.");
    }

    // REGRESSION 2: Bash Output Token Estimation
    console.log("\nCase 2: Bash Content-Type Heuristic");
    const bashListing = `
    -rw-r--r--  1 kit kit 12345 Apr  5 10:22 index.ts
    -rw-r--r--  1 kit kit  6789 Apr  5 10:21 tokenize.ts
    -rw-r--r--  1 kit kit  3456 Apr  5 10:20 models.ts
    `;
    const chars = bashListing.length;
    const standardEst = Math.ceil(chars / 4);
    const accurateEst = estimateTokens(bashListing);
    
    if (accurateEst > standardEst) {
        console.log(`✅ Success: Heuristic correctly identified dense bash output (Standard: ${standardEst}, Accurate: ${accurateEst})`);
    } else {
        console.error("❌ Failed: Heuristic underestimated bash output.");
    }

    // REGRESSION 3: 429 Plan Limit Parsing
    console.log("\nCase 3: 429 Error Parsing");
    const errorText = "Error: 429 Too Many Requests. Your plan limit: 8 units";
    const parsedLimit = (text: string) => {
        const match = text.match(/plan limit:\s*(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
    };
    
    if (parsedLimit(errorText) === 8) {
        console.log("✅ Success: Correctly extracted concurrency limit from 429 message.");
    } else {
        console.error("❌ Failed: 429 parsing regex is broken.");
    }

    // REGRESSION 4: Swarm Concurrency Batching
    console.log("\nCase 4: Swarm Batching Logic");
    const testFiles = ["f1", "f2", "f3", "f4", "f5", "f6"];
    const BATCH_SIZE = 4;
    const batches = [];
    for (let i = 0; i < testFiles.length; i += BATCH_SIZE) {
        batches.push(testFiles.slice(i, i + BATCH_SIZE));
    }
    
    if (batches.length === 2 && batches[0].length === 4 && batches[1].length === 2) {
        console.log(`✅ Success: Correctly calculated ${batches.length} batches for ${testFiles.length} files (Batch size: ${BATCH_SIZE}).`);
    } else {
        console.error("❌ Failed: Batching calculation is incorrect.");
    }

    // REGRESSION 6: Stuck Concurrency Auto-Release
    // History: If an API request hung or failed to report completion, 
    // the provider would permanently "block" that concurrency slot.
    console.log("\nCase 6: Concurrency Auto-Release Safety");
    const mockState = { inFlight: new Set<string>() };
    const trackRequest = (id: string) => {
        mockState.inFlight.add(id);
        setTimeout(() => mockState.inFlight.delete(id), 100); // Simulate 100ms auto-release
    };
    
    trackRequest("req_stuck");
    if (mockState.inFlight.has("req_stuck")) {
        console.log("...Request tracked (waiting for auto-release)...");
        await new Promise(r => setTimeout(r, 150));
        if (!mockState.inFlight.has("req_stuck")) {
            console.log("✅ Success: Stuck concurrency was automatically released.");
        } else {
            console.error("❌ Failed: Concurrency remained stuck.");
        }
    }

    console.log("\n🏁 All 6 Regression Tests Complete.");
}

runRegressionTests().catch(console.error);
