/**
 * Unit test for the new token estimation heuristic.
 * Uses known values from Phase 0 validation (see compact_plan.md).
 * 
 * Run with: npx tsx test_heuristic.ts
 */

import { estimateTokens } from "./tokenize.js";

interface TestCase {
    name: string;
    text: string;
    actualTokens: number;  // From Featherless API (Phase 0 validation)
}

const testCases: TestCase[] = [
    {
        name: "Natural language",
        text: "The quick brown fox jumps over the lazy dog. This is a test of tokenization accuracy.",
        actualTokens: 19,
    },
    {
        name: "Code (TypeScript)",
        text: `function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

const result = hello("World");
console.log(result);`,
        actualTokens: 30,
    },
    {
        name: "Markdown + code",
        text: `## Header

Some text here.

\`\`\`typescript
const x: number = 42;
const y = x * 2;
\`\`\`

More text after code.`,
        actualTokens: 34,
    },
    {
        name: "JSON",
        text: `{"type": "message", "role": "assistant", "content": [{"type": "text", "text": "Hello world"}]}`,
        actualTokens: 29,
    },
    {
        name: "File paths",
        text: `/home/kit/.nvm/versions/node/v25.9.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js`,
        actualTokens: 37,
    },
    {
        name: "Bash output (ls)",
        text: `total 48
drwxr-xr-x  2 kit kit  4096 Apr  5 10:23 .
drwxr-xr-x 42 kit kit 16384 Apr  5 10:22 ..
-rw-r--r--  1 kit kit 12345 Apr  5 10:22 index.ts
-rw-r--r--  1 kit kit  6789 Apr  5 10:21 tokenize.ts
-rw-r--r--  1 kit kit  3456 Apr  5 10:20 models.ts`,
        actualTokens: 150,  // Known to be underestimated by chars/4
    },
];

function main() {
    console.log("Testing new heuristic against known actual token counts\n");
    console.log("━".repeat(70));

    let totalOldError = 0;
    let totalNewError = 0;
    let totalActual = 0;

    for (const tc of testCases) {
        const chars = tc.text.length;
        const lines = tc.text.split('\n').length;
        const oldEst = Math.ceil(chars / 4);
        const newEst = estimateTokens(tc.text);
        const actual = tc.actualTokens;

        const oldDiff = actual - oldEst;
        const newDiff = actual - newEst;
        const oldErr = Math.abs(oldDiff);
        const newErr = Math.abs(newDiff);

        totalOldError += oldErr;
        totalNewError += newErr;
        totalActual += actual;

        const improvement = ((oldErr - newErr) / oldErr * 100).toFixed(0);

        console.log(`\n${tc.name} (${chars} chars, ${lines} lines):`);
        console.log(`  Old (chars/4): ${oldEst}  (off by ${oldDiff > 0 ? '+' : ''}${oldDiff})`);
        console.log(`  New heuristic: ${newEst}  (off by ${newDiff > 0 ? '+' : ''}${newDiff})`);
        console.log(`  Actual:        ${actual}`);
        console.log(`  Improvement:   ${improvement}%`);
    }

    console.log("\n" + "━".repeat(70));
    console.log("\nSummary:");
    console.log(`  Total actual tokens:     ${totalActual}`);
    console.log(`  Total old error:         ${totalOldError} tokens`);
    console.log(`  Total new error:         ${totalNewError} tokens`);
    console.log(`  Overall improvement:     ${((1 - totalNewError / totalOldError) * 100).toFixed(1)}%`);
    console.log(`\n  Old average error:       ${(totalOldError / testCases.length).toFixed(1)} tokens/sample`);
    console.log(`  New average error:       ${(totalNewError / testCases.length).toFixed(1)} tokens/sample`);

    if (totalNewError < totalOldError) {
        console.log("\n✅ New heuristic is MORE ACCURATE!");
    } else {
        console.log("\n❌ New heuristic needs refinement");
    }
}

main();