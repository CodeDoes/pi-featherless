#!/usr/bin/env tsx
/**
 * Featherless Model Tool Calling Evaluator
 *
 * Usage:
 *   npx tsx evaluate-models.ts "reposcroll/RWKV-6-14B" "Qwen/QwQ-32B"
 *   npx tsx evaluate-models.ts --file models.json
 *   npx tsx evaluate-models.ts --config custom-config.json
 *
 * Input formats:
 *   - Model ID: "org/model-name"
 *   - URL: "https://featherless.ai/models/org/model-name"
 *
 * Config file (JSON):
 *   {
 *     "models": [
 *       { "id": "org/model", "params": { "temperature": 0.7, "top_p": 0.95 } }
 *     ],
 *     "scenarios": ["hello", "read", "json", "selfcontrol", "pipeline", "calc"],
 *     "output": "results/run-20250101.json"
 *   }
 */

import { config } from 'dotenv';
config();
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) {
  console.error('Missing FEATHERLESS_API_KEY');
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: 'https://api.featherless.ai/v1' });

// ============================================================================
// CONFIGURATION
// ============================================================================

type ModelParams = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  [key: string]: any;
};

interface ModelEntry {
  id: string;
  params?: ModelParams;
  label?: string; // custom display name
}

interface EvaluationConfig {
  models: ModelEntry[];
  scenarios?: string[]; // filter which scenarios to run
  outputDir?: string;
  verbose?: boolean;
}

const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.7,
  top_p: 1.0,
  max_tokens: 500,
};

const SCENARIOS = {
  hello: {
    user: "Run: echo hello",
    expectedTool: "bash",
    check: (tc: any[]) => {
      const call = tc.find(t => t.function.name === 'bash');
      if (!call) return false;
      try { const args = JSON.parse(call.function.arguments); return args.command?.includes('echo hello'); } catch { return false; }
    },
  },
  read: {
    user: "Read /etc/hostname",
    expectedTool: "read_file",
    check: (tc: any[]) => {
      const call = tc.find(t => t.function.name === 'read_file');
      if (!call) return false;
      try { const args = JSON.parse(call.function.arguments); return args.path === '/etc/hostname'; } catch { return false; }
    },
  },
  json: {
    user: 'Write config.json with {"port":3000,"host":"0.0.0.0"}',
    expectedTool: "write_file",
    check: (tc: any[]) => {
      const call = tc.find(t => t.function.name === 'write_file');
      if (!call) return false;
      try { const args = JSON.parse(call.function.arguments); return args.path?.endsWith('config.json'); } catch { return false; }
    },
  },
  selfcontrol: {
    user: "What is 2+2?",
    expectedTool: "calculator",
    check: (tc: any[]) => tc.some(t => t.function.name === 'calculator'),
  },
  pipeline: {
    user: "Count .txt files in /tmp: ls /tmp/*.txt | wc -l",
    expectedTool: "bash",
    check: (tc: any[]) => {
      const call = tc.find(t => t.function.name === 'bash');
      if (!call) return false;
      try { const args = JSON.parse(call.function.arguments); return args.command?.includes('wc -l'); } catch { return false; }
    },
  },
  calc: {
    user: "Calculate 15 * 23",
    expectedTool: "calculator",
    check: (tc: any[]) => tc.some(t => t.function.name === 'calculator'),
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Execute bash command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file content",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate mathematical expression",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
];

// ============================================================================
// LOGIC
// ============================================================================

interface ScenarioResult {
  scenario: ScenarioKey;
  passed: boolean;
  toolCalls: any[];
  content?: string;
  error?: string;
  durationMs: number;
}

interface ModelResult {
  model: string;
  label?: string;
  params: ModelParams;
  scenarios: ScenarioResult[];
  overall: {
    passed: number;
    total: number;
    percentage: number;
    avgDurationMs: number;
  };
  error?: string;
}

function parseModelInput(input: string): ModelEntry {
  // Strip URL prefix if present
  const id = input.replace(/^https?:\/\/featherless\.ai\/models\//, '');
  // Extract short label
  const label = id.split('/').pop()?.replace(/-/g, ' ');
  return { id, label: label || id };
}

async function runScenario(modelId: string, scenario: ScenarioKey, params: ModelParams): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: SCENARIOS[scenario].user }],
      tools: TOOLS,
      max_tokens: params.max_tokens ?? 500,
      temperature: params.temperature ?? 0.7,
      top_p: params.top_p ?? 1.0,
    });

    const msg = res.choices[0].message;
    const toolCalls = msg.tool_calls || [];
    const content = msg.content || "";
    const passed = SCENARIOS[scenario].check(toolCalls);

    return {
      scenario,
      passed,
      toolCalls,
      content: content.slice(0, 200),
      durationMs: Date.now() - start,
    };
  } catch (e: any) {
    return {
      scenario,
      passed: false,
      toolCalls: [],
      error: e.message?.slice(0, 100) || String(e),
      durationMs: Date.now() - start,
    };
  }
}

async function evaluateModel(entry: ModelEntry, scenarioFilter?: ScenarioKey[]): Promise<ModelResult> {
  const scenariosToRun: ScenarioKey[] = scenarioFilter
    ? scenarioFilter
    : (Object.keys(SCENARIOS) as ScenarioKey[]);

  const results: ScenarioResult[] = [];

  for (const scenario of scenariosToRun) {
    const result = await runScenario(entry.id, scenario, entry.params ?? DEFAULT_PARAMS);
    results.push(result);
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / total;

  return {
    model: entry.id,
    label: entry.label,
    params: entry.params ?? DEFAULT_PARAMS,
    scenarios: results,
    overall: { passed, total, percentage: Math.round((passed / total) * 100), avgDurationMs: Math.round(avgDuration) },
  };
}

// ============================================================================
// INPUT HANDLING
// ============================================================================

function loadConfigFromArgs(): EvaluationConfig | null {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;

  // Remove any option flags (starting with --)
  const cleanArgs = args.filter(a => !a.startsWith('--'));

  // Check for config file via --config FILE or --config=FILE
  const configFlagIdx = args.findIndex(a => a === '--config' || a === '--file');
  if (configFlagIdx >= 0) {
    const file = args[configFlagIdx + 1];
    if (!file || !existsSync(file)) {
      console.error(`Config file not found after ${args[configFlagIdx]}`);
      process.exit(1);
    }
    const config = JSON.parse(readFileSync(file, 'utf-8'));
    // Append any additional positional args as models
    if (cleanArgs.length > 0) {
      config.models = config.models || [];
      config.models.push(...cleanArgs.map(parseModelInput));
    }
    return config;
  }

  const configEqual = args.find(a => a.startsWith('--config='))?.split('=')[1] || args.find(a => a.startsWith('--file='))?.split('=')[1];
  if (configEqual) {
    if (!existsSync(configEqual)) {
      console.error(`Config file not found: ${configEqual}`);
      process.exit(1);
    }
    return JSON.parse(readFileSync(configEqual, 'utf-8'));
  }

  // Default: all non-flag args are model IDs
  if (cleanArgs.length === 0) {
    console.error('No models specified.');
    process.exit(1);
  }
  return { models: cleanArgs.map(parseModelInput) };
}

// ============================================================================
// OUTPUT
// ============================================================================

function generateMarkdownReport(results: ModelResult[]): string {
  let md = `# Tool Calling Evaluation Report\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `**Models evaluated:** ${results.length}\n\n`;
  md += `## Summary\n\n`;
  md += `| Model | Pass Rate | Avg Time |\n`;
  md += `|-------|-----------|----------|\n`;

  for (const r of results) {
    const label = r.label || r.model.split('/').pop();
    md += `| ${label} | ${r.overall.passed}/${r.overall.total} (${r.overall.percentage}%) | ${(r.overall.avgDurationMs/1000).toFixed(1)}s |\n`;
  }

  md += `\n## Detailed Results\n\n`;
  for (const r of results) {
    md += `### ${r.label || r.model}\n\n`;
    md += `**Parameters:** temp=${r.params.temperature}, top_p=${r.params.top_p}\n\n`;
    md += `| Scenario | Pass | Duration | Details |\n`;
    md += `|----------|------|----------|----------|\n`;
    for (const s of r.scenarios) {
      const status = s.passed ? '✅' : '❌';
      const time = (s.durationMs/1000).toFixed(2);
      let details = '';
      if (s.error) {
        details = `Error: ${s.error}`;
      } else if (s.toolCalls.length > 0) {
        const toolName = s.toolCalls[0].function.name;
        const args = typeof s.toolCalls[0].function.arguments === 'string'
          ? s.toolCalls[0].function.arguments
          : JSON.stringify(s.toolCalls[0].function.arguments);
        details = s.passed ? `✅ ${toolName}` : `❌ ${toolName} - ${args.slice(0, 40)}`;
      } else if (s.content) {
        details = `"${s.content.trim().replace(/|/g, '').slice(0, 50)}..."`;
      }
      md += `| ${s.scenario} | ${status} | ${time}s | ${details} |\n`;
    }
    md += `\n`;
  }

  return md;
}

function saveResults(results: ModelResult[], config: EvaluationConfig) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = config.outputDir || 'results';
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, `bench-${timestamp}.json`);
  const mdPath = join(outputDir, `bench-${timestamp}.md`);

  const reportData = {
    timestamp: new Date().toISOString(),
    config: config,
    results,
  };

  writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));
  writeFileSync(mdPath, generateMarkdownReport(results));

  console.log(`\n💾 Results saved:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Markdown: ${mdPath}`);
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  console.log("\n" + "=".repeat(80));
  console.log(" FEATHERLESS MODEL EVALUATOR");
  console.log("=".repeat(80) + "\n");

  const config = loadConfigFromArgs();
  if (!config || config.models.length === 0) {
    console.error("No models specified. Provide model IDs as arguments or use --file/--config.");
    console.error("\nExamples:");
    console.error("  npx tsx evaluate-models.ts \"org/model\" \"another/model\"");
    console.error("  npx tsx evaluate-models.ts --file models.json");
    console.error("  npx tsx evaluate-models.ts --config custom.json --scenarios hello,read");
    process.exit(1);
  }

  console.log(`Evaluating ${config.models.length} model(s)...`);
  console.log(`Scenarios: ${config.scenarios?.join(', ') || 'all (6)'}\n`);

  const results: ModelResult[] = [];
  let completed = 0;

  for (const entry of config.models) {
    console.log(`[${completed + 1}/${config.models.length}] Evaluating: ${entry.label || entry.id}`);
    if (entry.params) {
      console.log(`   ⚙️  Params: temp=${entry.params.temperature}, top_p=${entry.params.top_p}`);
    }

    const result = await evaluateModel(entry, config.scenarios as ScenarioKey[]);
    results.push(result);

    const score = `${result.overall.passed}/${result.overall.total} (${result.overall.percentage}%)`;
    console.log(`   ✅ Score: ${score.padEnd(12)} Avg: ${(result.overall.avgDurationMs/1000).toFixed(1)}s`);

    if (result.error) {
      console.log(`   ⚠️  Error: ${result.error}`);
    }

    completed++;
  }

  console.log("\n" + "-".repeat(80));
  console.log(" FINAL SCORES");
  console.log("-".repeat(80));

  const sorted = results.sort((a, b) => b.overall.percentage - a.overall.percentage);
  for (const r of sorted) {
    const label = r.label || r.model;
    console.log(`${r.overall.percentage.toString().padStart(3)}%  ${label.padEnd(40)}  ${r.overall.passed}/${r.overall.total}  ${(r.overall.avgDurationMs/1000).toFixed(1)}s`);
  }

  saveResults(results, config);
  console.log("\n🎉 Done.\n");
})().catch((e) => {
  console.error("\nFatal error:", e);
  process.exit(1);
});
