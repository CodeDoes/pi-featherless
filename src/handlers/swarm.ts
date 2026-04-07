import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { completeSimple, type Model, type Context } from "@mariozechner/pi-ai";
import { PROVIDER, getApiKey } from "./shared";

/**
 * Swarm Tool for Featherless AI.
 *
 * Provides high-speed parallel analysis of multiple files by spawning
 * independent "worker" calls to a fast model (Qwen2.5-Coder-7B).
 *
 * This implements the "Summarize-and-Forget" pattern to keep main
 * context lean while performing deep architectural analysis.
 */

const WORKER_MODEL_ID = "Qwen/Qwen2.5-Coder-7B-Instruct";

const WORKER_PROMPT = `
Analyze the provided file content.
Focus on:
1. High-level purpose and architectural role.
2. Key exported functions/classes.
3. Important dependencies or side effects.

Keep the summary technical, concise, and focused on implementation details.

FILE: \${path}
CONTENT:
\${content}
`;

async function analyzeFile(
    path: string,
    content: string,
    model: Model<any>,
    apiKey: string,
    signal?: AbortSignal
): Promise<string> {
    const prompt = WORKER_PROMPT
        .replace("${path}", path)
        .replace("${content}", content);

    const ctx: Context = {
        messages: [
            {
                role: "user",
                content: [{ type: "text", text: prompt }],
                timestamp: Date.now(),
            },
        ],
    };

    try {
        const response = await completeSimple(model, ctx, {
            apiKey,
            maxTokens: 1024,
            signal,
        });

        return response.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n");
    } catch (e: any) {
        return `[Analysis failed for ${path}: ${e.message}]`;
    }
}

export function registerSwarm(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm",
            label: "🐝 Swarm Analysis",
            description: "Analyzes multiple files in parallel to provide high-level architectural insights and summaries.",
            parameters: Type.Object({
                files: Type.Array(Type.String(), {
                    description: "List of file paths to analyze in parallel.",
                }),
                focus: Type.Optional(Type.String({
                    description: "Optional specific focus for the analysis (e.g. 'security', 'performance').",
                })),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const { files, focus } = params;
                const apiKey = await getApiKey(ctx);

                if (!apiKey) {
                    throw new Error("FEATHERLESS_API_KEY not found.");
                }

                if (files.length === 0) {
                    return {
                        content: [{ type: "text", text: "No files provided for swarm analysis." }],
                    };
                }

                const workerModel: Model<any> = {
                    ...ctx.model!,
                    id: WORKER_MODEL_ID,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                };

                onUpdate?.({
                    content: [{ type: "text", text: `🐝 Initializing swarm for ${files.length} files...` }],
                    details: { total: files.length, focus },
                });

                // 1. Read all files
                const fileContents: { path: string; content: string }[] = [];
                for (const path of files) {
                    try {
                        const content = await pi.fs.read(path);
                        fileContents.push({ path, content });
                    } catch (e) {
                        fileContents.push({ path, content: `[Error reading file: ${path}]` });
                    }
                }

                // 2. Parallel Analysis (independent sub-requests)
                const analysisPromises = fileContents.map(async (file, idx) => {
                    onUpdate?.({
                        content: [{ type: "text", text: `🧠 Analyzing ${file.path}...` }],
                        details: { current: file.path, index: idx + 1, total: files.length },
                    });

                    const analysis = await analyzeFile(
                        file.path,
                        file.content,
                        workerModel,
                        apiKey,
                        signal
                    );

                    return { path: file.path, analysis };
                });

                const results = await Promise.all(analysisPromises);

                // 3. Format Output
                const formattedResults = results
                    .map((r) => `## ${r.path}\n${r.analysis}`)
                    .join("\n\n---\n\n");

                const summary = focus
                    ? `### Swarm Analysis (Focus: ${focus})\n\n${formattedResults}`
                    : `### Swarm Analysis Results\n\n${formattedResults}`;

                return {
                    content: [{ type: "text", text: summary }],
                    details: {
                        filesAnalyzed: files.length,
                        modelUsed: WORKER_MODEL_ID
                    },
                };
            },
        })
    );
}
