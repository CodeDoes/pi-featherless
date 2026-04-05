/**
 * Quick test to compare chars/4 estimate vs actual Featherless tokenization.
 * 
 * Run with: npx tsx test_tokens.ts
 */

import { tokenize, estimateTokens, extractText } from "./tokenize.js";

// Get API key from environment
const API_KEY = process.env.FEATHERLESS_API_KEY;
const MODEL = "Qwen/Qwen3-32B";

// Sample texts of different types
const samples = [
  // Natural language
  "The quick brown fox jumps over the lazy dog. This is a test of tokenization accuracy.",
  
  // Code-heavy
  `function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

const result = hello("World");
console.log(result);`,

  // Markdown with code blocks
  `## Header
  
Some text here.

\`\`\`typescript
const x: number = 42;
const y = x * 2;
\`\`\`

More text after code.`,

  // JSON-like
  `{"type": "message", "role": "assistant", "content": [{"type": "text", "text": "Hello world"}]}`,

  // File path heavy (typical in tool results)
  `/home/kit/.nvm/versions/node/v25.9.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js`,

  // Realistic bash output (truncated)
  `total 48
drwxr-xr-x  2 kit kit  4096 Apr  5 10:23 .
drwxr-xr-x 42 kit kit 16384 Apr  5 10:22 ..
-rw-r--r--  1 kit kit 12345 Apr  5 10:22 index.ts
-rw-r--r--  1 kit kit  6789 Apr  5 10:21 tokenize.ts
-rw-r--r--  1 kit kit  3456 Apr  5 10:20 models.ts`,

  // Realistic file content (TypeScript)
  `/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
 */
import { completeSimple } from "@mariozechner/pi-ai";
import { convertToLlm, createBranchSummaryMessage } from "../messages.js";

export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      const content = message.content;
      if (typeof content === "string") {
        chars = content.length;
      }
      return Math.ceil(chars / 4);
    }
  }
  return 0;
}`,
];

async function main() {
  if (!API_KEY) {
    console.error("Set FEATHERLESS_API_KEY environment variable");
    process.exit(1);
  }

  console.log("Comparing chars/4 vs new heuristic vs actual Featherless tokenization\n");
  console.log("Model:", MODEL);
  console.log("━".repeat(70));

  let totalChars = 0;
  let totalOldEstimate = 0;
  let totalNewEstimate = 0;
  let totalActual = 0;

  for (let i = 0; i < samples.length; i++) {
    const text = samples[i];
    const chars = text.length;
    const oldEstimate = Math.ceil(chars / 4);  // Old heuristic
    const newEstimate = estimateTokens(text);  // New heuristic
    
    let actual: number;
    try {
      actual = await tokenize(MODEL, text, API_KEY);
    } catch (err) {
      console.error(`Sample ${i + 1}: API error:`, err);
      continue;
    }

    const ratio = chars / actual;
    const oldDiff = actual - oldEstimate;
    const newDiff = actual - newEstimate;
    const oldDiffPct = ((actual / oldEstimate - 1) * 100).toFixed(1);
    const newDiffPct = ((actual / newEstimate - 1) * 100).toFixed(1);

    console.log(`\nSample ${i + 1} (${chars} chars, ${text.split('\n').length} lines):`);
    console.log(`  Old heuristic (chars/4): ${oldEstimate} (${oldDiff > 0 ? '+' : ''}${oldDiff}, ${oldDiffPct}%)`);
    console.log(`  New heuristic:           ${newEstimate} (${newDiff > 0 ? '+' : ''}${newDiff}, ${newDiffPct}%)`);
    console.log(`  Actual tokens:           ${actual}`);
    console.log(`  Chars per token:         ${ratio.toFixed(2)}`);

    totalChars += chars;
    totalOldEstimate += oldEstimate;
    totalNewEstimate += newEstimate;
    totalActual += actual;
  }

  console.log("\n" + "━".repeat(70));
  console.log("\nTotals:");
  console.log(`  Total chars:             ${totalChars}`);
  console.log(`  Old heuristic (chars/4): ${totalOldEstimate} (off by ${totalActual - totalOldEstimate}, ${((totalActual / totalOldEstimate - 1) * 100).toFixed(1)}%)`);
  console.log(`  New heuristic:           ${totalNewEstimate} (off by ${totalActual - totalNewEstimate}, ${((totalActual / totalNewEstimate - 1) * 100).toFixed(1)}%)`);
  console.log(`  Actual tokens:           ${totalActual}`);
  console.log(`\nAverage chars/token: ${(totalChars / totalActual).toFixed(2)}`);
  
  const oldError = Math.abs(totalActual - totalOldEstimate);
  const newError = Math.abs(totalActual - totalNewEstimate);
  console.log(`\nImprovement: ${((1 - newError / oldError) * 100).toFixed(1)}% reduction in error`);
}

main().catch(console.error);