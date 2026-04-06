import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SwarmProcessor } from "./swarm-processor";
import { SwarmReadParams } from "./swarm-types";
import { SwarmLogger } from "./swarm-logger";

export function registerSwarmRead(pi: ExtensionAPI) {
    const processor = new SwarmProcessor();

    pi.registerTool(
        defineTool({
            name: "swarm_read",
            label: "Swarm Read (PREFERRED)",
            description:
                "🚀 PRIMARY FILE TOOL: Analyze multiple files in parallel using LLM. " +
                "Provide a question and list of files, or specific instructions per file.",
            parameters: SwarmReadParams,
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                try {
                    // Normalize parameters
                    let files: string[];
                    let instructions: string[];

                    if ("question" in params) {
                        files = params.files;
                        instructions = files.map(() => params.question);
                    } else {
                        files = params.instructions.map(
                            (pair: string[]) => pair[0],
                        );
                        instructions = params.instructions.map(
                            (pair: string[]) =>
                                pair.length > 1 ? pair[1] : "Analyze this file",
                        );
                    }

                    // Process files
                    const results = await processor.processFiles(
                        files,
                        instructions,
                        {
                            model: ctx.model,
                            apiKey: await getApiKey(ctx),
                            signal,
                            ctx,
                            onUpdate: onUpdate || (() => {}), // Ensure onUpdate is always a function
                        },
                    );

                    // Format results
                    const successfulResults = results
                        .filter((r) => !r.error)
                        .map((r) => `### ${r.filePath}\n${r.content}`)
                        .join("\n\n---\n\n");

                    const failedResults = results
                        .filter((r) => r.error)
                        .map(
                            (r) =>
                                `### ${r.filePath}\n❌ Error: ${r.error?.message}`,
                        )
                        .join("\n\n");

                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    successfulResults +
                                    (failedResults
                                        ? `\n\n## Errors\n\n${failedResults}`
                                        : "") +
                                    `\n\n## Summary\n- Files: ${files.length}\n- Successful: ${results.filter((r) => !r.error).length}\n- Failed: ${results.filter((r) => r.error).length}`,
                            },
                        ],
                        details: {
                            files,
                            results: results.map((r) => ({
                                file: r.filePath,
                                success: !r.error,
                                error: r.error?.message,
                            })),
                        },
                    };
                } catch (error) {
                    SwarmLogger.log(ctx, "Tool execution failed", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    throw error;
                }
            },
        }),
    );
}

// Helper function (would normally be imported)
async function getApiKey(ctx: any): Promise<string> {
    return ctx.apiKey || "";
}
