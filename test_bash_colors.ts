/**
 * Test tokenization of real bash output with and without ANSI color codes.
 * 
 * Run with: FEATHERLESS_API_KEY=... npx tsx test_bash_colors.ts
 */

import { tokenize } from "./tokenize.js";
import { execSync } from "child_process";

const API_KEY = process.env.FEATHERLESS_API_KEY;
const MODEL = "Qwen/Qwen3-32B";

async function main() {
    if (!API_KEY) {
        console.error("Set FEATHERLESS_API_KEY environment variable");
        process.exit(1);
    }

    // Get real bash output
    const plainBash = execSync("ls -la", { encoding: "utf-8" });
    const coloredBash = execSync("ls -la --color=always", { encoding: "utf-8" });

    console.log("Comparing token counts: plain vs colored bash output\n");
    
    const plainChars = plainBash.length;
    const coloredChars = coloredBash.length;
    
    console.log(`Plain:    ${plainChars} chars`);
    console.log(`Colored:  ${coloredChars} chars`);
    console.log(`Diff:     ${coloredChars - plainChars} chars\n`);
    
    const plainTokens = await tokenize(MODEL, plainBash, API_KEY);
    const coloredTokens = await tokenize(MODEL, coloredBash, API_KEY);
    
    console.log("Plain bash output:");
    console.log(`  Tokens:     ${plainTokens}`);
    console.log(`  Chars/token: ${(plainChars / plainTokens).toFixed(2)}`);
    
    console.log("\nColored bash output (with ANSI codes):");
    console.log(`  Tokens:     ${coloredTokens}`);
    console.log(`  Chars/token: ${(coloredChars / coloredTokens).toFixed(2)}`);
    
    console.log("\nDifference:");
    console.log(`  Extra chars:  ${coloredChars - plainChars}`);
    console.log(`  Extra tokens: ${coloredTokens - plainTokens}`);
    
    // Check if ANSI codes are tokenized efficiently
    const charsPerTokenPlain = plainChars / plainTokens;
    const charsPerTokenColored = coloredChars / coloredTokens;
    console.log(`\nANSI codes impact: ${((charsPerTokenColored / charsPerTokenPlain - 1) * 100).toFixed(1)}% change in chars/token ratio`);
}

main().catch(console.error);