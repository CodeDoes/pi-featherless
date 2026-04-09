#!/usr/bin/env npx tsx
/**
 * Terminal-Bench Runner for Pi VariantAgent
 * Runs Harbor benchmarks against the Featherless API
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
    // API key from .env or environment
    apiKey: process.env.FEATHERLESS_API_KEY || '',
    
    // Benchmark settings
    dataset: 'terminal-bench@2.0',
    agentModule: 'pi_terminal_bench:VariantAgent',
    
    // Fast mode defaults
    fastMode: {
        maxTasks: 10,
        concurrency: 3,
        retries: 0,
    },
    
    // Full mode defaults  
    fullMode: {
        concurrency: 4,
        retries: 1,
    },
    
    // Output directory
    jobsDir: './variant-results',
};

// Parse CLI args
const args = process.argv.slice(2);
const isFast = args.includes('--fast') || args.includes('-f');
const isQuick = args.includes('--quick') || args.includes('-q');
const modelArg = args.find(a => a.startsWith('--model=') || a.startsWith('-m='))?.split('=')[1];
const model = modelArg || 'featherless-ai/Qwen2.5-Coder-32B-Instruct';
const taskLimit = args.find(a => a.startsWith('--tasks='))?.split('=')[1];
const taskFilter = args.find(a => a.startsWith('--filter='))?.split('=')[1];

// Quick mode: just 3 tasks, no verification
const maxTasks = isQuick ? 3 : (isFast ? CONFIG.fastMode.maxTasks : (taskLimit ? parseInt(taskLimit) : undefined));
const concurrency = isQuick ? 1 : (isFast ? CONFIG.fastMode.concurrency : CONFIG.fullMode.concurrency);
const retries = isQuick ? 0 : (isFast ? CONFIG.fastMode.retries : CONFIG.fullMode.retries);

// Load .env if API key not set
if (!CONFIG.apiKey) {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/FEATHERLESS_API_KEY\s*=\s*['"]?([^'"\n]+)['"]?/);
        if (match) {
            CONFIG.apiKey = match[1];
        }
    }
}

if (!CONFIG.apiKey) {
    console.error('❌ No FEATHERLESS_API_KEY found. Set it in .env or as environment variable.');
    process.exit(1);
}

// Generate job name
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const modeLabel = isQuick ? 'quick' : (isFast ? 'fast' : 'full');
const jobName = `variant-${modeLabel}-${timestamp}`;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║          Terminal-Bench Runner for Pi VariantAgent              ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`📋 Configuration:`);
console.log(`   Mode: ${modeLabel}`);
console.log(`   Model: ${model}`);
console.log(`   Max Tasks: ${maxTasks || 'all'}`);
console.log(`   Concurrency: ${concurrency}`);
console.log(`   Retries: ${retries}`);
console.log(`   Job: ${jobName}`);
console.log('');

// Build harbor command
const jobsDir = path.join(process.cwd(), CONFIG.jobsDir);
const benchmarkSuiteDir = path.join(process.cwd(), 'benchmark-suite');

const harborArgs = [
    'run',
    '-d', CONFIG.dataset,
    '--agent-import-path', CONFIG.agentModule,
    '-m', model,
    '--job-name', jobName,
    '--jobs-dir', jobsDir,
    '-n', String(concurrency),
    '--max-retries', String(retries),
    '-y', // Auto-confirm
];

if (maxTasks) {
    harborArgs.push('--n-tasks', String(maxTasks));
}

if (taskFilter) {
    harborArgs.push('--include-task-name', taskFilter);
}

if (isQuick) {
    // Skip verification for quickest runs
    harborArgs.push('--disable-verification');
}

console.log('🚀 Starting benchmark...\n');

// Set environment and run
const env = {
    ...process.env,
    FEATHERLESS_API_KEY: CONFIG.apiKey,
    PATH: `${benchmarkSuiteDir}/.venv/bin:${process.env.PATH}`,
};

try {
    // Run harbor from benchmark-suite directory
    const result = spawn('harbor', harborArgs, {
        cwd: benchmarkSuiteDir,
        env,
        stdio: 'inherit',
        shell: true,
    });

    result.on('close', (code) => {
        console.log('');
        if (code === 0) {
            console.log('✅ Benchmark completed successfully!');
            console.log(`📊 Results: ${jobsDir}/${jobName}/result.json`);
        } else {
            console.log(`❌ Benchmark exited with code ${code}`);
        }
        process.exit(code || 0);
    });

    result.on('error', (err) => {
        console.error('❌ Failed to start benchmark:', err.message);
        process.exit(1);
    });

} catch (error: any) {
    console.error('❌ Error running benchmark:', error.message);
    process.exit(1);
}